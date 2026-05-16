/**
 * اختبار: TVA عند إلغاء فاتورة في شهر مختلف
 * 
 * السيناريو:
 * 1. فاتورة يونيو TVA 200 → confirmed
 * 2. إلغاء في يوليو (قيد عكسي بتاريخ يوليو)
 * 3. إقرار يونيو = +200
 * 4. إقرار يوليو = -200
 * 5. الإجمالي السنوي = 0
 */

import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals'
import { migration_001_initial } from '../../../electron/database/migrations/001_initial'
import { migration_002_accounting } from '../../../electron/database/migrations/002_accounting'
import { createAccountingEntry, createReverseAccountingEntries } from '../accounting.service'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  migration_001_initial(db)
  migration_002_accounting(db)

  // فترة محاسبية 2026
  db.prepare(`INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
    VALUES ('2026', '2026-01-01', '2026-12-31', 2026, 'open')`).run()

  // مستخدم
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'x', 'admin')`).run()

  // عميل
  db.prepare(`INSERT INTO clients (id, name) VALUES (1, 'Client Test')`).run()
})

afterEach(() => { db.close() })

// Helper: حساب TVA من journal_entries بين تاريخين
function getTvaCollectee(startDate: string, endDate: string): number {
  const rows = db.prepare(`
    SELECT SUM(jl.credit) - SUM(jl.debit) as amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.code = '4455'
      AND je.date BETWEEN ? AND ?
      AND je.reference NOT LIKE 'ANNUL-ANNUL-%'
  `).get(startDate, endDate) as any
  return rows?.amount ?? 0
}

describe('TVA — Annulation dans un mois différent', () => {
  it('Facture juin +200, annulée en juillet → juin=+200, juillet=-200, annuel=0', () => {

    // ── 1. Créer facture juin ──────────────────────────────────────────────
    const invoice = db.prepare(`
      INSERT INTO documents (type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc)
      VALUES ('invoice', 'F-26-001', '2026-06-15', 1, 'client', 'confirmed', 1000, 200, 1200)
      RETURNING *
    `).get() as any

    const lines = [{
      product_id: null, quantity: 1, unit_price: 1000,
      tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200,
    }]

    // إنشاء القيد المحاسبي (يونيو)
    createAccountingEntry(db, invoice, lines, 1)

    // ── 2. التحقق: إقرار يونيو = +200 ────────────────────────────────────
    const juinTva = getTvaCollectee('2026-06-01', '2026-06-30')
    expect(juinTva).toBe(200)

    // ── 3. إلغاء الفاتورة في يوليو ────────────────────────────────────────
    // نحاكي تغيير تاريخ القيد العكسي ليكون في يوليو
    // (في الواقع createReverseAccountingEntries تستخدم new Date() = اليوم)
    // نُعدّل الدالة لتقبل تاريخاً مخصصاً للاختبار
    db.prepare(`UPDATE documents SET status = 'cancelled' WHERE id = ?`).run(invoice.id)
    createReverseAccountingEntries(db, 'invoice', invoice.id, 'F-26-001', 1)

    // تحديث تاريخ القيد العكسي ليكون في يوليو (للاختبار)
    db.prepare(`
      UPDATE journal_entries SET date = '2026-07-01'
      WHERE reference LIKE 'ANNUL-%' AND source_id = ?
    `).run(invoice.id)

    // ── 4. التحقق: إقرار يونيو لا يزال +200 ──────────────────────────────
    const juinTvaAfter = getTvaCollectee('2026-06-01', '2026-06-30')
    expect(juinTvaAfter).toBe(200) // القيد الأصلي لا يزال في يونيو

    // ── 5. التحقق: إقرار يوليو = -200 ────────────────────────────────────
    const juilletTva = getTvaCollectee('2026-07-01', '2026-07-31')
    expect(juilletTva).toBe(-200) // القيد العكسي: credit سالب (debit=200, credit=0 → SUM(credit)=0 - 200 = -200)

    // ── 6. التحقق: الإجمالي السنوي = 0 ───────────────────────────────────
    const annualTva = getTvaCollectee('2026-01-01', '2026-12-31')
    expect(annualTva).toBe(0)
  })
})
