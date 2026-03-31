import { handle } from './index'
import { getDb } from '../database/connection'
import { createPaymentEntry } from '../services/accounting.service'
import { logAudit } from '../services/audit.service'

export function registerPaymentHandlers(): void {
  handle('payments:getAll', (filters?: { party_id?: number; party_type?: string; status?: string; document_id?: number }) => {
    const db = getDb()
    let query = `
      SELECT p.*,
        CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name
      FROM payments p
      LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
      WHERE 1=1
    `
    const params: any[] = []

    if (filters?.party_id)   { query += ' AND p.party_id = ?';   params.push(filters.party_id) }
    if (filters?.party_type) { query += ' AND p.party_type = ?'; params.push(filters.party_type) }
    if (filters?.status)     { query += ' AND p.status = ?';     params.push(filters.status) }
    if (filters?.document_id){ query += ' AND p.document_id = ?'; params.push(filters.document_id) }

    query += ' ORDER BY p.date DESC'
    return db.prepare(query).all(...params)
  })

  handle('payments:create', (data) => {
    const db = getDb()

    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, due_date,
          cheque_number, bank, status, document_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.party_id, data.party_type, data.amount, data.method,
        data.date, data.due_date ?? null, data.cheque_number ?? null,
        data.bank ?? null, data.status ?? 'pending',
        data.document_id ?? null, data.notes ?? null, data.created_by ?? 1
      )

      const paymentId = result.lastInsertRowid as number

      // تخصيص الدفعة على الفاتورة
      if (data.document_id) {
        db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(
          paymentId, data.document_id, data.amount
        )

        // تحديث حالة الفاتورة
        updateInvoicePaymentStatus(db, data.document_id)
      }

      // قيد محاسبي تلقائي
      createPaymentEntry(db, {
        id: paymentId,
        party_id: data.party_id,
        party_type: data.party_type,
        amount: data.amount,
        method: data.method,
        date: data.date,
        reference: `PAY-${paymentId}`,
      }, data.created_by ?? 1)

      logAudit(db, {
        user_id: data.created_by ?? 1,
        action: 'PAYMENT',
        table_name: 'payments',
        record_id: paymentId,
        new_values: { amount: data.amount, method: data.method, party_type: data.party_type },
      })

      return { id: paymentId }
    })

    return tx()
  })

  handle('payments:update', (data) => {
    const db = getDb()
    db.prepare(`UPDATE payments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(data.status, data.id)
    return { success: true }
  })

  handle('payments:getPaidAmount', (documentId: number) => {
    const db = getDb()
    const row = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?'
    ).get(documentId) as any
    return { total: row?.total ?? 0 }
  })
}

function updateInvoicePaymentStatus(db: any, documentId: number): void {
  const doc = db.prepare('SELECT total_ttc, type FROM documents WHERE id = ?').get(documentId) as any
  if (!doc) return

  const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(documentId) as any).total

  let status = 'unpaid'
  if (paid >= doc.total_ttc - 0.01) status = 'paid'  // tolerance 1 centime
  else if (paid > 0) status = 'partial'

  // تحديث الجدول الفرعي المناسب
  if (doc.type === 'invoice') {
    db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run(status, documentId)
  } else if (doc.type === 'purchase_invoice') {
    db.prepare('UPDATE doc_purchase_invoices SET payment_status = ? WHERE document_id = ?').run(status, documentId)
  } else if (doc.type === 'import_invoice') {
    db.prepare('UPDATE doc_import_invoices SET payment_status = ? WHERE document_id = ?').run(status, documentId)
  }

  // تحديث حالة المستند الرئيسي
  if (status === 'paid') {
    db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId)
  } else if (status === 'partial') {
    db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId)
  }
}
