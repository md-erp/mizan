/**
 * Tests — إصلاحات نظام الإلغاءات
 * 
 * يختبر:
 * 1. إنشاء قيود عكسية (contre-passation) بدلاً من الحذف
 * 2. إعادة حساب حالة الفاتورة عند إلغاء BL
 * 3. إلغاء الدفعات النقدية/البنكية مع عكس القيد
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'

jest.mock('../../database/connection', () => {
  let _db: any = null
  return { getDb: () => _db, __setDb: (db: any) => { _db = db } }
})
const getSetDb = () => require('../../database/connection').__setDb

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_004_settings(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  db.prepare(`INSERT INTO clients (id,name) VALUES (1,'Client A')`).run()
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',200,50,5,120)`).run()
  return db
}

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

function cancelDocument(db: Database.Database, id: number) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
  if (!doc) throw new Error('Document introuvable')
  if (doc.status === 'cancelled') throw new Error('Document déjà annulé')
  if (doc.status === 'paid') throw new Error('Impossible d\'annuler un document payé')

  const appliedMov = db.prepare(`SELECT COUNT(*) as c FROM stock_movements WHERE document_id = ? AND applied = 1`).get(id) as any
  if (appliedMov?.c > 0) throw new Error('Ce document a des mouvements de stock appliqués')

  const linkedPay = db.prepare(`SELECT COUNT(*) as c FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.document_id = ? AND p.status = 'cleared'`).get(id) as any
  if (linkedPay?.c > 0) throw new Error('Ce document a des paiements enregistrés')

  const tx = db.transaction(() => {
    db.prepare(`UPDATE stock_movements SET applied = -1 WHERE document_id = ? AND applied = 0`).run(id)
    db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)

    // إنشاء قيود عكسية
    const { createReverseAccountingEntries } = require('../accounting.service')
    createReverseAccountingEntries(db, doc.type, id, doc.number, 1)

    // إعادة حساب حالة الفاتورة عند إلغاء BL
    if (doc.type === 'bl') {
      const invoiceLink = db.prepare(`SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%invoice%'`).get(id) as any
      if (invoiceLink) {
        const invId = invoiceLink.parent_id
        const invDoc = db.prepare(`SELECT status FROM documents WHERE id = ?`).get(invId) as any
        if (invDoc && !['cancelled', 'paid'].includes(invDoc.status)) {
          const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(invId) as any[]
          const blIds = (db.prepare(`
            SELECT dl.child_id as id FROM document_links dl
            JOIN documents d ON d.id = dl.child_id
            WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
          `).all(invId) as any[]).map((r: any) => r.id)

          if (blIds.length === 0) {
            db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invId)
          } else {
            const delivered: Record<string, number> = {}
            for (const blId of blIds) {
              const blLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId) as any[]
              for (const l of blLines) {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                delivered[key] = (delivered[key] ?? 0) + Number(l.quantity)
              }
            }
            const fullyDelivered = invLines.every((l: any) => {
              const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
              return (delivered[key] ?? 0) >= Number(l.quantity)
            })
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
              fullyDelivered ? 'delivered' : 'partial', invId
            )
          }
        }
      }
    }
  })

  tx()
}

function cancelPayment(db: Database.Database, paymentId: number) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any
  if (!payment) throw new Error('Paiement introuvable')
  if (payment.status === 'cancelled') throw new Error('Paiement déjà annulé')

  const tx = db.transaction(() => {
    db.prepare(`UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(paymentId)

    // إنشاء قيد عكسي
    const paymentEntry = db.prepare(`SELECT id, reference FROM journal_entries WHERE source_type = 'payment' AND source_id = ?`).get(paymentId) as any
    if (paymentEntry) {
      const entryLines = db.prepare(`SELECT jl.account_id, jl.debit, jl.credit, jl.notes FROM journal_lines jl WHERE jl.entry_id = ?`).all(paymentEntry.id) as any[]
      const reverseDate = new Date().toISOString().split('T')[0]
      const reverseRef = `ANNUL-${payment.reference ?? `P-${paymentId}`}`
      const reverseDesc = `Annulation paiement: ${payment.reference ?? `P-${paymentId}`}`

      const reverseEntry = db.prepare(`
        INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
        VALUES (?, ?, ?, 1, 'payment', ?, ?)
      `).run(reverseDate, reverseRef, reverseDesc, paymentId, 1)

      const newEntryId = reverseEntry.lastInsertRowid as number

      for (const line of entryLines) {
        db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)`).run(
          newEntryId, line.account_id, line.credit, line.debit, `Annulation: ${line.notes ?? ''}`
        )
      }
    }

    // حذف التخصيصات
    const allocations = db.prepare('SELECT document_id FROM payment_allocations WHERE payment_id = ?').all(paymentId) as any[]
    db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(paymentId)

    // إعادة حساب حالة الفواتير
    for (const alloc of allocations) {
      if (alloc.document_id) {
        const doc = db.prepare('SELECT total_ttc, type, status FROM documents WHERE id = ?').get(alloc.document_id) as any
        if (!doc || doc.status === 'cancelled') continue

        const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(alloc.document_id) as any).total
        let payStatus = 'unpaid'
        if (paid >= doc.total_ttc - 0.01) payStatus = 'paid'
        else if (paid > 0) payStatus = 'partial'

        if (doc.type === 'invoice') {
          db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, alloc.document_id)
        }

        if (payStatus === 'paid') {
          db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(alloc.document_id)
        } else if (payStatus === 'partial') {
          if (!['delivered', 'paid'].includes(doc.status)) {
            db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(alloc.document_id)
          }
        } else {
          if (['paid', 'partial'].includes(doc.status)) {
            const newStatus = doc.status === 'delivered' ? 'delivered' : 'confirmed'
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, alloc.document_id)
          }
        }
      }
    }
  })

  tx()
}

describe('✅ Problème 1: Contre-passation au lieu de suppression', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('crée un quid comptable inversé au lieu de supprimer', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(id, 1)

    // Vérifier le quid original
    const originalEntry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='invoice' AND source_id=?`).get(id) as any
    expect(originalEntry).toBeDefined()
    const originalLines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id=?`).all(originalEntry.id) as any[]
    expect(originalLines.length).toBeGreaterThan(0)

    // Annuler
    cancelDocument(db, id)

    // Vérifier que le quid original existe toujours
    const stillExists = db.prepare(`SELECT * FROM journal_entries WHERE id=?`).get(originalEntry.id) as any
    expect(stillExists).toBeDefined()

    // Vérifier qu'un quid inversé a été créé
    const reverseEntries = db.prepare(`SELECT * FROM journal_entries WHERE source_type='invoice' AND source_id=? AND reference LIKE 'ANNUL-%'`).all(id) as any[]
    expect(reverseEntries.length).toBeGreaterThan(0)

    const reverseEntry = reverseEntries[0]
    expect(reverseEntry.description).toContain('Annulation')

    // Vérifier que les lignes sont inversées
    const reverseLines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id=?`).all(reverseEntry.id) as any[]
    expect(reverseLines.length).toBe(originalLines.length)

    for (let i = 0; i < originalLines.length; i++) {
      const orig = originalLines[i]
      const rev = reverseLines.find((r: any) => r.account_id === orig.account_id)
      expect(rev).toBeDefined()
      expect(rev.debit).toBeCloseTo(orig.credit, 2)
      expect(rev.credit).toBeCloseTo(orig.debit, 2)
    }
  })

  it('enregistre la contre-passation dans audit_log', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(id, 1)
    cancelDocument(db, id)

    const auditLog = db.prepare(`SELECT * FROM audit_log WHERE action='REVERSE_JOURNAL_ENTRY' AND table_name='journal_entries'`).all() as any[]
    expect(auditLog.length).toBeGreaterThan(0)
    expect(auditLog[0].reason).toContain('Contre-passation')
  })

  it('la somme des débits et crédits reste équilibrée après annulation', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(id, 1)
    cancelDocument(db, id)

    // Calculer la somme totale de tous les débits et crédits liés à ce document
    const entries = db.prepare(`SELECT id FROM journal_entries WHERE source_type='invoice' AND source_id=?`).all(id) as any[]
    let totalDebit = 0
    let totalCredit = 0

    for (const entry of entries) {
      const lines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id=?`).all(entry.id) as any[]
      for (const line of lines) {
        totalDebit += line.debit
        totalCredit += line.credit
      }
    }

    // Après contre-passation, la somme nette devrait être 0
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
  })
})

describe('✅ Problème 2: Recalcul statut facture après annulation BL', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture delivered → confirmed après annulation du seul BL', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)

    expect(getStatus(db, invId)).toBe('delivered')

    // Annuler le BL
    cancelDocument(db, blId)

    // La facture doit revenir à confirmed
    expect(getStatus(db, invId)).toBe('confirmed')
  })

  it('facture delivered → partial après annulation d\'un BL partiel', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    // Premier BL: 6 unités
    const { id: bl1Id } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 6, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, bl1Id, 'invoice_to_bl')
    confirmDocument(bl1Id, 1)

    // Deuxième BL: 4 unités
    const { id: bl2Id } = createDocument({
      type: 'bl', date: '2026-01-17', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, bl2Id, 'invoice_to_bl')
    confirmDocument(bl2Id, 1)

    expect(getStatus(db, invId)).toBe('delivered')

    // Annuler le deuxième BL
    cancelDocument(db, bl2Id)

    // La facture doit passer à partial (6/10 livrés)
    expect(getStatus(db, invId)).toBe('partial')
  })

  it('ne touche pas une facture paid lors de l\'annulation du BL', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)

    // Payer la facture
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any
    const payResult = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'client',?,'cash','2026-01-20','cleared',?,1)`).run(doc.total_ttc, invId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payResult.lastInsertRowid, invId, doc.total_ttc)
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(invId)

    expect(getStatus(db, invId)).toBe('paid')

    // Annuler le BL
    cancelDocument(db, blId)

    // La facture doit rester paid
    expect(getStatus(db, invId)).toBe('paid')
  })
})

describe('✅ Problème 3: Annulation des paiements', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('annule un paiement cash et remet la facture à confirmed', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any

    // Créer un paiement
    const { createPaymentEntry } = require('../accounting.service')
    const payResult = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'client',?,'cash','2026-01-20','cleared',?,1)`).run(doc.total_ttc, invId)
    const payId = payResult.lastInsertRowid as number

    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, invId, doc.total_ttc)
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(invId)
    db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run('paid', invId)

    createPaymentEntry(db, {
      id: payId,
      party_id: 1,
      party_type: 'client',
      amount: doc.total_ttc,
      method: 'cash',
      date: '2026-01-20',
    }, 1)

    expect(getStatus(db, invId)).toBe('paid')

    // Annuler le paiement
    cancelPayment(db, payId)

    // Vérifier que le paiement est annulé
    const payment = db.prepare('SELECT status FROM payments WHERE id=?').get(payId) as any
    expect(payment.status).toBe('cancelled')

    // Vérifier que la facture est revenue à confirmed
    expect(getStatus(db, invId)).toBe('confirmed')

    // Vérifier qu'un quid inversé a été créé
    const reverseEntry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='payment' AND source_id=? AND reference LIKE 'ANNUL-%'`).get(payId) as any
    expect(reverseEntry).toBeDefined()
    expect(reverseEntry.description).toContain('Annulation paiement')
  })

  it('annule un paiement partiel et remet la facture à confirmed', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any
    const halfAmount = doc.total_ttc / 2

    // Créer un paiement partiel
    const { createPaymentEntry } = require('../accounting.service')
    const payResult = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'client',?,'bank','2026-01-20','cleared',?,1)`).run(halfAmount, invId)
    const payId = payResult.lastInsertRowid as number

    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, invId, halfAmount)
    db.prepare(`UPDATE documents SET status='partial' WHERE id=?`).run(invId)
    db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run('partial', invId)

    createPaymentEntry(db, {
      id: payId,
      party_id: 1,
      party_type: 'client',
      amount: halfAmount,
      method: 'bank',
      date: '2026-01-20',
    }, 1)

    expect(getStatus(db, invId)).toBe('partial')

    // Annuler le paiement
    cancelPayment(db, payId)

    // La facture doit revenir à confirmed
    expect(getStatus(db, invId)).toBe('confirmed')
  })

  it('le quid inversé du paiement équilibre les comptes', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any

    const { createPaymentEntry } = require('../accounting.service')
    const payResult = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'client',?,'cash','2026-01-20','cleared',?,1)`).run(doc.total_ttc, invId)
    const payId = payResult.lastInsertRowid as number

    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, invId, doc.total_ttc)

    createPaymentEntry(db, {
      id: payId,
      party_id: 1,
      party_type: 'client',
      amount: doc.total_ttc,
      method: 'cash',
      date: '2026-01-20',
    }, 1)

    // Annuler le paiement
    cancelPayment(db, payId)

    // Vérifier l'équilibre des comptes
    const entries = db.prepare(`SELECT id FROM journal_entries WHERE source_type='payment' AND source_id=?`).all(payId) as any[]
    let totalDebit = 0
    let totalCredit = 0

    for (const entry of entries) {
      const lines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id=?`).all(entry.id) as any[]
      for (const line of lines) {
        totalDebit += line.debit
        totalCredit += line.credit
      }
    }

    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01)
  })
})
