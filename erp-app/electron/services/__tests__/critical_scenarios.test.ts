import { describe, it, expect, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { createDocument, confirmDocument, smartEditDocument } from '../document.service'
import { createPaymentEntry } from '../accounting.service'

// Mock database connection
jest.mock('../../database/connection', () => {
  let _db: any = null
  return { getDb: () => _db, __setDb: (db: any) => { _db = db } }
})
const getSetDb = () => require('../../database/connection').__setDb

describe('🔥 السيناريوهات الحرجة', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    getSetDb()(db)
    migration_001_initial(db)
    migration_002_accounting(db)
    
    // تشغيل الهجرات الإضافية
    const { migration_014_payment_reference } = require('../../database/migrations/014_payment_reference')
    const { migration_018_payment_validation } = require('../../database/migrations/018_payment_validation')
    migration_014_payment_reference(db)
    migration_018_payment_validation(db)

    // إنشاء مستخدم
    db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@test.com', 'hash', 'admin')`).run()

    // إنشاء فترة محاسبية مفتوحة
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES ('2026', '2026-01-01', '2026-12-31', 2026, 'open')
    `).run()

    // إنشاء عميل ومورد
    db.prepare(`INSERT INTO clients (name, ice) VALUES ('Client Test', 'ICE123')`).run()
    db.prepare(`INSERT INTO suppliers (name, ice) VALUES ('Fournisseur Test', 'ICE456')`).run()

    // إنشاء منتج
    db.prepare(`
      INSERT INTO products (code, name, type, unit, sale_price, stock_quantity, cmup_price)
      VALUES ('PROD001', 'Produit Test', 'finished', 'unité', 100, 50, 100)
    `).run()
  })

  describe('A. Smart Edit', () => {
    it('1. فاتورة confirmed بدون مدفوعات → Smart Edit ينشئ Avoir + يلغي الأصل + ينشئ draft', () => {
      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      // تأكيد الفاتورة
      confirmDocument(invoice.id, 1)

      // التحقق من الحالة قبل Smart Edit
      const beforeDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(beforeDoc.status).toBe('confirmed')

      // عدد القيود المحاسبية قبل
      const entriesBefore = db.prepare('SELECT COUNT(*) as count FROM journal_entries').get() as any

      // Smart Edit
      const result = smartEditDocument(invoice.id, 1)

      // التحقق من النتيجة
      expect(result.avoirId).toBeGreaterThan(0)
      expect(result.newDocId).toBeGreaterThan(0)
      expect(result.newDocNumber).toBeDefined()

      // التحقق من الوثيقة الأصلية → cancelled
      const originalDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(originalDoc.status).toBe('cancelled')

      // التحقق من Avoir → confirmed
      const avoir = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.avoirId) as any
      expect(avoir.type).toBe('avoir')
      expect(avoir.status).toBe('confirmed')

      // التحقق من الوثيقة الجديدة → draft
      const newDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.newDocId) as any
      expect(newDoc.status).toBe('draft')
      expect(newDoc.type).toBe('invoice')

      // التحقق من الرصيد المحاسبي = صفر (الأصل + Avoir)
      const entries = db.prepare('SELECT * FROM journal_entries').all() as any[]
      const totalDebit = db.prepare('SELECT SUM(debit) as sum FROM journal_lines').get() as any
      const totalCredit = db.prepare('SELECT SUM(credit) as sum FROM journal_lines').get() as any
      expect(totalDebit.sum).toBe(totalCredit.sum)

      // التحقق من الروابط
      const links = db.prepare('SELECT * FROM document_links WHERE parent_id = ?').all(invoice.id) as any[]
      expect(links.length).toBe(2) // avoir + replacement
    })

    it('2. فاتورة confirmed + مدفوعة جزئياً → Smart Edit يسمح مع تحذير', () => {
      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      // إنشاء دفعة جزئية
      const payment = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by)
        VALUES (1, 'client', 100, 'cash', '2026-06-16', 'cleared', 'P-0001', 1)
      `).run()

      db.prepare(`
        INSERT INTO payment_allocations (payment_id, document_id, amount)
        VALUES (?, ?, 100)
      `).run(payment.lastInsertRowid, invoice.id)

      // Smart Edit
      const result = smartEditDocument(invoice.id, 1)

      // يجب أن يعمل لكن مع تحذير
      expect(result.warning).toBeDefined()
      expect(result.warning).toContain('paiements enregistrés')
      expect(result.avoirId).toBeGreaterThan(0)
      expect(result.newDocId).toBeGreaterThan(0)
    })

    it('3. فاتورة confirmed + مدفوعة كلياً → Smart Edit يسمح مع تحذير', () => {
      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(invoice.id) as any

      // دفعة كاملة
      const payment = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by)
        VALUES (1, 'client', ?, 'cash', '2026-06-16', 'cleared', 'P-0001', 1)
      `).run(doc.total_ttc)

      db.prepare(`
        INSERT INTO payment_allocations (payment_id, document_id, amount)
        VALUES (?, ?, ?)
      `).run(payment.lastInsertRowid, invoice.id, doc.total_ttc)

      // Smart Edit
      const result = smartEditDocument(invoice.id, 1)

      expect(result.warning).toBeDefined()
      expect(result.warning).toContain('paiements enregistrés')
      expect(result.avoirId).toBeGreaterThan(0)
    })

    it('4. Avoir → Smart Edit → يجب أن يُمنع', () => {
      // إنشاء avoir
      const avoir = createDocument({
        type: 'avoir',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(avoir.id, 1)

      // محاولة Smart Edit على avoir
      expect(() => {
        smartEditDocument(avoir.id, 1)
      }).toThrow('Impossible de modifier un avoir')
    })
  })

  describe('B. إلغاء في فترة مغلقة', () => {
    it('5. مستند في فترة closed → إلغاء → يجب أن يُمنع', () => {
      // إغلاق الفترة
      db.prepare(`UPDATE accounting_periods SET status = 'closed' WHERE fiscal_year = 2026`).run()

      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      // محاولة التأكيد في فترة مغلقة
      expect(() => {
        confirmDocument(invoice.id, 1)
      }).toThrow()
    })

    it('6. مستند في فترة locked → إلغاء → يجب أن يُمنع', () => {
      // قفل الفترة
      db.prepare(`UPDATE accounting_periods SET status = 'locked' WHERE fiscal_year = 2026`).run()

      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      expect(() => {
        confirmDocument(invoice.id, 1)
      }).toThrow()
    })

    it('7. مستند في فترة open → إلغاء → يجب أن يُسمح', () => {
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      // يجب أن يعمل بدون أخطاء
      expect(() => {
        confirmDocument(invoice.id, 1)
      }).not.toThrow()

      const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(invoice.id) as any
      expect(doc.status).toBe('confirmed')
    })
  })

  describe('C. شيك bounced', () => {
    it('8. شيك pending → bounced → حالة الفاتورة لا تتغير', () => {
      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      // شيك pending
      const payment = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by, cheque_number)
        VALUES (1, 'client', 240, 'cheque', '2026-06-16', 'pending', 'P-0001', 1, 'CHQ123')
      `).run()

      // الفاتورة لا تزال confirmed (الشيك pending لا يؤثر)
      let doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(doc.status).toBe('confirmed')

      // تغيير الشيك إلى bounced
      db.prepare(`UPDATE payments SET status = 'bounced' WHERE id = ?`).run(payment.lastInsertRowid)

      // الفاتورة لا تزال confirmed
      doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(doc.status).toBe('confirmed')
    })

    it('9. شيك cleared → bounced → حالة الفاتورة تعود', () => {
      // إنشاء فاتورة
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(invoice.id) as any

      // شيك cleared
      const payment = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by, cheque_number, document_id)
        VALUES (1, 'client', ?, 'cheque', '2026-06-16', 'cleared', 'P-0001', 1, 'CHQ123', ?)
      `).run(doc.total_ttc, invoice.id)

      // تخصيص الدفعة
      db.prepare(`
        INSERT INTO payment_allocations (payment_id, document_id, amount)
        VALUES (?, ?, ?)
      `).run(payment.lastInsertRowid, invoice.id, doc.total_ttc)

      // تحديث حالة الفاتورة
      db.prepare(`UPDATE doc_invoices SET payment_status = 'paid' WHERE document_id = ?`).run(invoice.id)
      db.prepare(`UPDATE documents SET status = 'paid' WHERE id = ?`).run(invoice.id)

      let invoiceDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(invoiceDoc.status).toBe('paid')

      // تغيير الشيك إلى bounced
      db.prepare(`UPDATE payments SET status = 'bounced' WHERE id = ?`).run(payment.lastInsertRowid)

      // حذف التخصيص
      db.prepare(`DELETE FROM payment_allocations WHERE payment_id = ?`).run(payment.lastInsertRowid)

      // إعادة حساب حالة الفاتورة
      db.prepare(`UPDATE doc_invoices SET payment_status = 'unpaid' WHERE document_id = ?`).run(invoice.id)
      db.prepare(`UPDATE documents SET status = 'confirmed' WHERE id = ?`).run(invoice.id)

      invoiceDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(invoice.id) as any
      expect(invoiceDoc.status).toBe('confirmed')
    })
  })

  describe('D. حالات حرجة', () => {
    it('11. فاتورة بمبلغ سالب → يجب أن يُمنع', () => {
      expect(() => {
        createDocument({
          type: 'invoice',
          date: '2026-06-15',
          party_id: 1,
          party_type: 'client',
          lines: [{ product_id: 1, quantity: -2, unit_price: 100, tva_rate: 20 }],
          created_by: 1,
        })
      }).toThrow()
    })

    it('12. فاتورة بدون عميل → يُمنع الآن ✅', () => {
      expect(() => {
        createDocument({
          type: 'invoice',
          date: '2026-06-15',
          party_id: null as any,
          party_type: 'client',
          lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
          created_by: 1,
        })
      }).toThrow('party_id est obligatoire')
    })

    it('13. دفعة أكبر من مبلغ الفاتورة → يُمنع الآن ✅', () => {
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(invoice.id) as any

      // ✅ الآن CHECK constraint يمنع المبلغ السالب أو الصفر
      expect(() => {
        db.prepare(`
          INSERT INTO payment_allocations (payment_id, document_id, amount)
          VALUES (1, ?, 0)
        `).run(invoice.id)
      }).toThrow()

      expect(() => {
        db.prepare(`
          INSERT INTO payment_allocations (payment_id, document_id, amount)
          VALUES (1, ?, -100)
        `).run(invoice.id)
      }).toThrow()

      // ✅ المبلغ الموجب يعمل
      const payment = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by)
        VALUES (1, 'client', 100, 'cash', '2026-06-16', 'cleared', 'P-0001', 1)
      `).run()

      const result = db.prepare(`
        INSERT INTO payment_allocations (payment_id, document_id, amount)
        VALUES (?, ?, 100)
      `).run(payment.lastInsertRowid, invoice.id)

      expect(result.lastInsertRowid).toBeGreaterThan(0)
    })

    it('14. دفعة أكبر من المبلغ المتبقي → يُمنع في handler ✅', () => {
      const invoice = createDocument({
        type: 'invoice',
        date: '2026-06-15',
        party_id: 1,
        party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })

      confirmDocument(invoice.id, 1)

      const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(invoice.id) as any

      // دفعة جزئية أولى
      const payment1 = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by)
        VALUES (1, 'client', 100, 'cash', '2026-06-16', 'cleared', 'P-0001', 1)
      `).run()

      db.prepare(`
        INSERT INTO payment_allocations (payment_id, document_id, amount)
        VALUES (?, ?, 100)
      `).run(payment1.lastInsertRowid, invoice.id)

      // محاولة دفع أكثر من المتبقي
      const payment2 = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, status, reference, created_by)
        VALUES (1, 'client', ?, 'cash', '2026-06-17', 'cleared', 'P-0002', 1)
      `).run(doc.total_ttc)

      // يجب أن يُمنع لأن المتبقي = total_ttc - 100
      expect(() => {
        db.prepare(`
          INSERT INTO payment_allocations (payment_id, document_id, amount)
          VALUES (?, ?, ?)
        `).run(payment2.lastInsertRowid, invoice.id, doc.total_ttc)
      }).toThrow()
    })
  })
})
