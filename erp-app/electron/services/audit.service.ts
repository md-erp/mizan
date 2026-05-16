import Database from 'better-sqlite3'

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'CONFIRM' | 'CANCEL' | 'RESTORE'
  | 'LOGIN' | 'LOGOUT'
  | 'PAYMENT' | 'APPLY_STOCK'
  | 'DELETE_JOURNAL_ENTRY'
  | 'SMART_EDIT_AVOIR' | 'SMART_EDIT_CANCEL' | 'SMART_EDIT_CREATE'
  | 'UPDATE_SAFE_FIELDS'

export interface AuditEntry {
  user_id: number
  action: AuditAction
  table_name: string
  record_id?: number
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  reason?: string
}

export interface AuditFilters {
  user_id?: number
  action?: AuditAction
  table_name?: string
  start_date?: string
  end_date?: string
  page?: number
  limit?: number
}

export function logAudit(db: Database.Database, entry: AuditEntry): void {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.user_id,
      entry.action,
      entry.table_name,
      entry.record_id ?? null,
      entry.old_values ? JSON.stringify(entry.old_values) : null,
      entry.new_values ? JSON.stringify(entry.new_values) : null,
      entry.reason ?? null
    )
  } catch {
    // Audit ne doit jamais bloquer l'opération principale
  }
}

export function getAuditLog(db: Database.Database, filters: AuditFilters = {}): {
  rows: any[]
  total: number
  page: number
  limit: number
} {
  const page  = filters.page  ?? 1
  const limit = filters.limit ?? 100
  const offset = (page - 1) * limit
  const params: any[] = []

  let where = 'WHERE 1=1'
  if (filters.user_id)    { where += ' AND al.user_id = ?';    params.push(filters.user_id) }
  if (filters.action)     { where += ' AND al.action = ?';     params.push(filters.action) }
  if (filters.table_name) { where += ' AND al.table_name = ?'; params.push(filters.table_name) }
  if (filters.start_date) { where += ' AND al.created_at >= ?'; params.push(filters.start_date) }
  if (filters.end_date)   { where += ' AND al.created_at <= ?'; params.push(filters.end_date + ' 23:59:59') }

  const rows = db.prepare(`
    SELECT
      al.*,
      u.name as user_name,
      CASE al.table_name
        WHEN 'documents' THEN (SELECT number FROM documents WHERE id = al.record_id)
        WHEN 'payments'  THEN (SELECT method || ' - ' || CAST(CAST(amount AS INTEGER) AS TEXT) || ' MAD' FROM payments WHERE id = al.record_id)
        WHEN 'clients'   THEN (SELECT name FROM clients   WHERE id = al.record_id)
        WHEN 'suppliers' THEN (SELECT name FROM suppliers WHERE id = al.record_id)
        WHEN 'products'  THEN (SELECT name FROM products  WHERE id = al.record_id)
        WHEN 'users'     THEN (SELECT name FROM users     WHERE id = al.record_id)
        ELSE NULL
      END as ref_label,
      CASE al.table_name
        WHEN 'documents' THEN (SELECT type FROM documents WHERE id = al.record_id)
        ELSE NULL
      END as doc_type,
      CASE al.table_name
        WHEN 'documents' THEN (
          SELECT COALESCE(
            (SELECT c.name FROM clients c WHERE c.id = d.party_id AND d.party_type = 'client'),
            (SELECT s.name FROM suppliers s WHERE s.id = d.party_id AND d.party_type = 'supplier')
          ) FROM documents d WHERE d.id = al.record_id
        )
        WHEN 'payments' THEN (
          SELECT COALESCE(
            (SELECT c.name FROM clients c WHERE c.id = p.party_id AND p.party_type = 'client'),
            (SELECT s.name FROM suppliers s WHERE s.id = p.party_id AND p.party_type = 'supplier')
          ) FROM payments p WHERE p.id = al.record_id
        )
        ELSE NULL
      END as party_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const total = (db.prepare(`
    SELECT COUNT(*) as c FROM audit_log al ${where}
  `).get(...params) as any).c

  return {
    rows: rows.map(r => {
      const newVals = r.new_values ? (() => { try { return JSON.parse(r.new_values) } catch { return null } })() : null
      const oldVals = r.old_values ? (() => { try { return JSON.parse(r.old_values) } catch { return null } })() : null

      let ref_label = r.ref_label
      let doc_type  = r.doc_type
      if (!ref_label && r.table_name === 'documents' && newVals?.number) {
        ref_label = newVals.number
        doc_type  = doc_type ?? newVals.type ?? null
      }

      return { ...r, ref_label, doc_type, old_values: oldVals, new_values: newVals }
    }),
    total,
    page,
    limit,
  }
}
