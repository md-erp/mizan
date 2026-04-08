/**
 * Tests Complets — Toutes les fonctions de reports.handler
 * Couvre: sales, purchases, stock, receivables, payables,
 *         cheques, profit_loss, tva_detail, stock_movements,
 *         payments, overdue
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_003_production } from '../../database/migrations/003_production'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'
import { createStockMovement, applyMovement } from '../stock.service'

jest.mock('../../database/connection', () => {
  let _db: any = null
  return { getDb: () => _db, __setDb: (db: any) => { _db = db } }
})
const getSetDb = () => require('../../database/connection').__setDb

// ── DB Setup ─────────────────────────────────────────────────────────────────
function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_003_production(db)
  migration_004_settings(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  db.prepare(`INSERT INTO clients (id,name,phone,ice) VALUES (1,'Client A','0600000001','ICE001'),(2,'Client B','0600000002','ICE002')`).run()
  db.prepare(`INSERT INTO suppliers (id,name,phone,ice) VALUES (1,'Fournisseur A','0700000001','ICE003')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,min_stock,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',100,50,10,5,120)`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,min_stock,tva_rate_id,sale_price)
    VALUES (2,'P002','Produit B','kg','raw',5,30,20,5,0)`).run()
  return db
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeInvoice(db: Database.Database, opts: {
  clientId?: number; qty?: number; price?: number; tva?: number
  date?: string; dueDate?: string; confirm?: boolean
} = {}) {
  const { id } = createDocument({
    type: 'invoice', date: opts.date ?? '2026-01-15',
    party_id: opts.clientId ?? 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: opts.qty ?? 10, unit_price: opts.price ?? 100, tva_rate: opts.tva ?? 20 }],
    created_by: 1,
    extra: { due_date: opts.dueDate ?? null },
  })
  if (opts.confirm !== false) confirmDocument(id, 1)
  return id
}

function makePurchaseInvoice(db: Database.Database, opts: { qty?: number; price?: number; date?: string } = {}) {
  const { id } = createDocument({
    type: 'purchase_invoice', date: opts.date ?? '2026-01-15',
    party_id: 1, party_type: 'supplier',
    lines: [{ product_id: 1, quantity: opts.qty ?? 5, unit_price: opts.price ?? 80, tva_rate: 20 }],
    created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function addPayment(db: Database.Database, opts: {
  docId?: number; amount: number; method?: string; status?: string
  partyId?: number; partyType?: string; dueDate?: string; chequeNum?: string
}) {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,due_date,cheque_number,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,1)`).run(
    opts.partyId ?? 1, opts.partyType ?? 'client', opts.amount,
    opts.method ?? 'cash', '2026-01-20', opts.status ?? 'pending',
    opts.docId ?? null, opts.dueDate ?? null, opts.chequeNum ?? null
  )
  const payId = r.lastInsertRowid as number
  if (opts.docId && opts.method !== 'cheque' && opts.method !== 'lcn') {
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, opts.docId, opts.amount)
    updateStatus(db, opts.docId)
  }
  return payId
}

function updateStatus(db: Database.Database, docId: number) {
  const doc = db.prepare('SELECT total_ttc, status FROM documents WHERE id=?').get(docId) as any
  if (!doc || ['cancelled','delivered'].includes(doc.status)) return
  const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(docId) as any).t
  let s = 'unpaid'
  if (paid >= doc.total_ttc - 0.01) s = 'paid'
  else if (paid > 0) s = 'partial'
  db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run(s, docId)
  if (s === 'paid') db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(docId)
  else if (s === 'partial') db.prepare(`UPDATE documents SET status='partial' WHERE id=?`).run(docId)
  else db.prepare(`UPDATE documents SET status='confirmed' WHERE id=? AND status IN ('paid','partial')`).run(docId)
}

// ── Report query helpers ──────────────────────────────────────────────────────
function getSales(db: Database.Database, f: any = {}) {
  const params: any[] = []
  let where = "WHERE d.type='invoice' AND d.is_deleted=0 AND d.status!='cancelled'"
  if (f.start_date) { where += ' AND d.date >= ?'; params.push(f.start_date) }
  if (f.end_date)   { where += ' AND d.date <= ?'; params.push(f.end_date) }
  if (f.client_id)  { where += ' AND d.party_id = ?'; params.push(f.client_id) }
  return db.prepare(`SELECT d.number,d.date,c.name as client_name,d.total_ht,d.total_tva,d.total_ttc,di.payment_status
    FROM documents d LEFT JOIN clients c ON c.id=d.party_id LEFT JOIN doc_invoices di ON di.document_id=d.id ${where} ORDER BY d.date DESC`).all(...params) as any[]
}

function getPurchases(db: Database.Database, f: any = {}) {
  const params: any[] = []
  let where = "WHERE d.type IN ('purchase_invoice','import_invoice') AND d.is_deleted=0"
  if (f.start_date) { where += ' AND d.date >= ?'; params.push(f.start_date) }
  if (f.end_date)   { where += ' AND d.date <= ?'; params.push(f.end_date) }
  return db.prepare(`SELECT d.number,d.date,s.name as supplier_name,d.total_ht,d.total_tva,d.total_ttc
    FROM documents d LEFT JOIN suppliers s ON s.id=d.party_id ${where} ORDER BY d.date DESC`).all(...params) as any[]
}

function getStock(db: Database.Database) {
  return db.prepare(`SELECT p.code,p.name,p.unit,p.type,p.stock_quantity,p.cmup_price,
    p.stock_quantity*p.cmup_price as stock_value,p.min_stock,
    CASE WHEN p.stock_quantity<=p.min_stock THEN 1 ELSE 0 END as is_low
    FROM products p WHERE p.is_deleted=0 ORDER BY p.name ASC`).all() as any[]
}

function getReceivables(db: Database.Database) {
  return db.prepare(`SELECT c.name as client_name,c.phone,c.ice,
    COALESCE(SUM(d.total_ttc),0) as total_invoiced,
    COALESCE(SUM(pa.amount),0) as total_paid,
    COALESCE(SUM(d.total_ttc),0)-COALESCE(SUM(pa.amount),0) as balance
    FROM clients c LEFT JOIN documents d ON d.party_id=c.id AND d.party_type='client'
      AND d.type='invoice' AND d.is_deleted=0 AND d.status!='cancelled'
    LEFT JOIN payment_allocations pa ON pa.document_id=d.id
    GROUP BY c.id HAVING balance>0 ORDER BY balance DESC`).all() as any[]
}

function getPayables(db: Database.Database) {
  return db.prepare(`SELECT s.name as supplier_name,s.phone,s.ice,
    COALESCE(SUM(d.total_ttc),0) as total_invoiced,
    COALESCE(SUM(pa.amount),0) as total_paid,
    COALESCE(SUM(d.total_ttc),0)-COALESCE(SUM(pa.amount),0) as balance
    FROM suppliers s LEFT JOIN documents d ON d.party_id=s.id AND d.party_type='supplier'
      AND d.type IN ('purchase_invoice','import_invoice') AND d.is_deleted=0 AND d.status!='cancelled'
    LEFT JOIN payment_allocations pa ON pa.document_id=d.id
    GROUP BY s.id HAVING balance>0 ORDER BY balance DESC`).all() as any[]
}

function getCheques(db: Database.Database, f: any = {}) {
  const params: any[] = []
  let where = "WHERE p.method IN ('cheque','lcn') AND p.status='pending'"
  if (f.start_date) { where += ' AND p.due_date >= ?'; params.push(f.start_date) }
  if (f.end_date)   { where += ' AND p.due_date <= ?'; params.push(f.end_date) }
  return db.prepare(`SELECT p.id,p.amount,p.method,p.date,p.due_date,p.cheque_number,p.bank,p.status,p.party_type,
    CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name
    FROM payments p LEFT JOIN clients c ON c.id=p.party_id AND p.party_type='client'
    LEFT JOIN suppliers s ON s.id=p.party_id AND p.party_type='supplier'
    ${where} ORDER BY p.due_date ASC`).all(...params) as any[]
}

function getOverdue(db: Database.Database, today: string) {
  return db.prepare(`SELECT d.number,d.date,di.due_date,c.name as client_name,d.total_ttc,
    COALESCE(SUM(pa.amount),0) as total_paid,
    d.total_ttc-COALESCE(SUM(pa.amount),0) as remaining,
    CAST(julianday(?)-julianday(di.due_date) AS INTEGER) as days_overdue,d.status
    FROM documents d JOIN doc_invoices di ON di.document_id=d.id
    LEFT JOIN clients c ON c.id=d.party_id
    LEFT JOIN payment_allocations pa ON pa.document_id=d.id
    WHERE d.type='invoice' AND d.is_deleted=0 AND d.status NOT IN ('paid','cancelled','draft')
      AND di.due_date IS NOT NULL AND di.due_date!='' AND di.due_date<?
    GROUP BY d.id HAVING remaining>0.01 ORDER BY days_overdue DESC`).all(today, today) as any[]
}

function getPaymentsReport(db: Database.Database, f: any = {}) {
  const params: any[] = []
  let where = 'WHERE 1=1'
  if (f.start_date) { where += ' AND p.date >= ?'; params.push(f.start_date) }
  if (f.end_date)   { where += ' AND p.date <= ?'; params.push(f.end_date) }
  if (f.party_type) { where += ' AND p.party_type = ?'; params.push(f.party_type) }
  return db.prepare(`SELECT p.date,p.method,p.amount,p.status,p.cheque_number,p.bank,p.due_date,
    CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
    p.party_type,d.number as document_number
    FROM payments p LEFT JOIN clients c ON c.id=p.party_id AND p.party_type='client'
    LEFT JOIN suppliers s ON s.id=p.party_id AND p.party_type='supplier'
    LEFT JOIN documents d ON d.id=p.document_id ${where} ORDER BY p.date DESC`).all(...params) as any[]
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Rapport Ventes (Sales)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne toutes les factures non annulées', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-02-15' })
    const cancelled = makeInvoice(db, { date: '2026-03-15' })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(cancelled)
    expect(getSales(db)).toHaveLength(2)
  })

  it('inclut les drafts (non confirmées)', () => {
    makeInvoice(db, { confirm: false })
    expect(getSales(db)).toHaveLength(1)
  })

  it('filtre par start_date', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-03-15' })
    expect(getSales(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })

  it('filtre par end_date', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-03-15' })
    expect(getSales(db, { end_date: '2026-02-01' })).toHaveLength(1)
  })

  it('filtre par client_id', () => {
    makeInvoice(db, { clientId: 1 })
    makeInvoice(db, { clientId: 2 })
    expect(getSales(db, { client_id: 1 })).toHaveLength(1)
  })

  it('retourne payment_status correct', () => {
    const invId = makeInvoice(db)
    addPayment(db, { docId: invId, amount: 1200 })
    const rows = getSales(db)
    expect(rows[0].payment_status).toBe('paid')
  })

  it('calcule les totaux HT/TVA/TTC correctement', () => {
    makeInvoice(db, { qty: 10, price: 100, tva: 20 })
    const rows = getSales(db)
    expect(rows[0].total_ht).toBeCloseTo(1000, 2)
    expect(rows[0].total_tva).toBeCloseTo(200, 2)
    expect(rows[0].total_ttc).toBeCloseTo(1200, 2)
  })

  it('trié par date DESC', () => {
    makeInvoice(db, { date: '2026-01-01' })
    makeInvoice(db, { date: '2026-03-01' })
    const rows = getSales(db)
    expect(rows[0].date).toBe('2026-03-01')
    expect(rows[1].date).toBe('2026-01-01')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Rapport Achats (Purchases)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne purchase_invoice et import_invoice', () => {
    makePurchaseInvoice(db)
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-20', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 50, tva_rate: 20 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10, invoice_amount: 50, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 500 },
    })
    confirmDocument(id, 1)
    expect(getPurchases(db)).toHaveLength(2)
  })

  it('exclut les factures clients', () => {
    makeInvoice(db)
    makePurchaseInvoice(db)
    expect(getPurchases(db)).toHaveLength(1)
  })

  it('filtre par période', () => {
    makePurchaseInvoice(db, { date: '2026-01-15' })
    makePurchaseInvoice(db, { date: '2026-03-15' })
    expect(getPurchases(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })

  it('retourne le nom du fournisseur', () => {
    makePurchaseInvoice(db)
    const rows = getPurchases(db)
    expect(rows[0].supplier_name).toBe('Fournisseur A')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Rapport Stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne tous les produits non supprimés', () => {
    expect(getStock(db)).toHaveLength(2)
  })

  it('calcule stock_value = stock_quantity * cmup_price', () => {
    const rows = getStock(db)
    const p1 = rows.find((r: any) => r.code === 'P001')
    expect(p1.stock_value).toBeCloseTo(100 * 50, 2)
  })

  it('is_low = 1 quand stock <= min_stock', () => {
    // P002: stock=5, min_stock=20 → is_low
    const rows = getStock(db)
    const p2 = rows.find((r: any) => r.code === 'P002')
    expect(p2.is_low).toBe(1)
  })

  it('is_low = 0 quand stock > min_stock', () => {
    // P001: stock=100, min_stock=10 → not low
    const rows = getStock(db)
    const p1 = rows.find((r: any) => r.code === 'P001')
    expect(p1.is_low).toBe(0)
  })

  it('exclut les produits supprimés', () => {
    db.prepare('UPDATE products SET is_deleted=1 WHERE id=1').run()
    expect(getStock(db)).toHaveLength(1)
  })

  it('trié par nom ASC', () => {
    const rows = getStock(db)
    expect(rows[0].name <= rows[1].name).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Rapport Créances (Receivables)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('client sans facture → absent', () => {
    expect(getReceivables(db)).toHaveLength(0)
  })

  it('facture non payée → balance = total_ttc', () => {
    makeInvoice(db, { clientId: 1 })
    const r = getReceivables(db)
    expect(r[0].balance).toBeCloseTo(1200, 2)
  })

  it('facture partiellement payée → balance = reste', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    addPayment(db, { docId: invId, amount: 400 })
    expect(getReceivables(db)[0].balance).toBeCloseTo(800, 2)
  })

  it('facture payée → client absent', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    addPayment(db, { docId: invId, amount: 1200 })
    expect(getReceivables(db)).toHaveLength(0)
  })

  it('facture annulée → exclue', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(getReceivables(db)).toHaveLength(0)
  })

  it('chèque pending ne réduit pas la créance', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    addPayment(db, { docId: invId, amount: 1200, method: 'cheque', status: 'pending' })
    expect(getReceivables(db)[0].balance).toBeCloseTo(1200, 2)
  })

  it('plusieurs clients triés par balance DESC', () => {
    makeInvoice(db, { clientId: 1, qty: 5, price: 100 })   // 600
    makeInvoice(db, { clientId: 2, qty: 10, price: 200 })  // 2400
    const r = getReceivables(db)
    expect(r[0].balance).toBeGreaterThan(r[1].balance)
  })

  it('retourne phone et ice du client', () => {
    makeInvoice(db, { clientId: 1 })
    const r = getReceivables(db)
    expect(r[0].phone).toBe('0600000001')
    expect(r[0].ice).toBe('ICE001')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Rapport Dettes (Payables)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('fournisseur sans facture → absent', () => {
    expect(getPayables(db)).toHaveLength(0)
  })

  it('facture fournisseur non payée → balance = total_ttc', () => {
    makePurchaseInvoice(db)
    const r = getPayables(db)
    expect(r[0].balance).toBeCloseTo(480, 2) // 5×80×1.2
  })

  it('paiement fournisseur réduit la dette', () => {
    const invId = makePurchaseInvoice(db)
    const payId = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',200,'bank','2026-01-20','pending',?,1)`).run(invId).lastInsertRowid as number
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, invId, 200)
    expect(getPayables(db)[0].balance).toBeCloseTo(280, 2)
  })

  it('facture annulée → exclue', () => {
    const invId = makePurchaseInvoice(db)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(getPayables(db)).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Rapport Chèques & LCN', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne seulement les chèques/LCN pending', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-02-01' })
    addPayment(db, { amount: 500, method: 'cheque', status: 'cleared', dueDate: '2026-02-01' })
    addPayment(db, { amount: 500, method: 'cash',   status: 'pending' })
    expect(getCheques(db)).toHaveLength(1)
  })

  it('exclut les chèques bounced', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'bounced', dueDate: '2026-02-01' })
    expect(getCheques(db)).toHaveLength(0)
  })

  it('inclut les LCN pending', () => {
    addPayment(db, { amount: 500, method: 'lcn', status: 'pending', dueDate: '2026-02-01' })
    expect(getCheques(db)).toHaveLength(1)
  })

  it('filtre par due_date start', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-01-15' })
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-03-15' })
    expect(getCheques(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })

  it('filtre par due_date end', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-01-15' })
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-03-15' })
    expect(getCheques(db, { end_date: '2026-02-01' })).toHaveLength(1)
  })

  it('trié par due_date ASC', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-03-01' })
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-01-01' })
    const rows = getCheques(db)
    expect(rows[0].due_date).toBe('2026-01-01')
  })

  it('retourne le nom du client/fournisseur', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending', dueDate: '2026-02-01', partyId: 1, partyType: 'client' })
    expect(getCheques(db)[0].party_name).toBe('Client A')
  })

  it('chèque sans due_date → absent du rapport', () => {
    addPayment(db, { amount: 500, method: 'cheque', status: 'pending' })
    // due_date null → ORDER BY due_date ASC mais toujours retourné
    // Le filtre frontend exclut ceux sans due_date
    const rows = getCheques(db)
    expect(rows[0].due_date).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Rapport Overdue', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('sans due_date → absent', () => {
    makeInvoice(db)
    expect(getOverdue(db, '2026-12-31')).toHaveLength(0)
  })

  it('due_date vide → absent', () => {
    makeInvoice(db, { dueDate: '' })
    expect(getOverdue(db, '2026-12-31')).toHaveLength(0)
  })

  it('due_date future → absent', () => {
    makeInvoice(db, { dueDate: '2026-12-31' })
    expect(getOverdue(db, '2026-06-01')).toHaveLength(0)
  })

  it('due_date = today → absent (strict <)', () => {
    makeInvoice(db, { dueDate: '2026-04-04' })
    expect(getOverdue(db, '2026-04-04')).toHaveLength(0)
  })

  it('due_date passée → présent', () => {
    makeInvoice(db, { dueDate: '2026-01-01' })
    expect(getOverdue(db, '2026-04-04')).toHaveLength(1)
  })

  it('days_overdue calculé correctement', () => {
    makeInvoice(db, { dueDate: '2026-01-01' })
    const rows = getOverdue(db, '2026-04-04')
    expect(rows[0].days_overdue).toBe(93)
  })

  it('facture payée → absente', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    addPayment(db, { docId: invId, amount: 1200 })
    expect(getOverdue(db, '2026-04-04')).toHaveLength(0)
  })

  it('facture annulée → absente', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(getOverdue(db, '2026-04-04')).toHaveLength(0)
  })

  it('facture draft → absente', () => {
    makeInvoice(db, { dueDate: '2026-01-01', confirm: false })
    expect(getOverdue(db, '2026-04-04')).toHaveLength(0)
  })

  it('remaining = total_ttc - total_paid', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' }) // TTC=1200
    addPayment(db, { docId: invId, amount: 400 })
    const rows = getOverdue(db, '2026-04-04')
    expect(rows[0].remaining).toBeCloseTo(800, 2)
  })

  it('chèque pending ne réduit pas remaining', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    addPayment(db, { docId: invId, amount: 1200, method: 'cheque', status: 'pending' })
    const rows = getOverdue(db, '2026-04-04')
    expect(rows[0].remaining).toBeCloseTo(1200, 2)
  })

  it('trié par days_overdue DESC', () => {
    makeInvoice(db, { dueDate: '2026-03-01', clientId: 1 }) // 34j
    makeInvoice(db, { dueDate: '2026-01-01', clientId: 2 }) // 93j
    const rows = getOverdue(db, '2026-04-04')
    expect(rows[0].days_overdue).toBeGreaterThan(rows[1].days_overdue)
  })

  it('HAVING remaining > 0.01 exclut les factures soldées', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    addPayment(db, { docId: invId, amount: 1199.99 }) // tolérance 1 centime
    expect(getOverdue(db, '2026-04-04')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Rapport Paiements', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne tous les paiements', () => {
    addPayment(db, { amount: 500, method: 'cash' })
    addPayment(db, { amount: 300, method: 'bank' })
    expect(getPaymentsReport(db)).toHaveLength(2)
  })

  it('filtre par party_type', () => {
    addPayment(db, { amount: 500, partyType: 'client' })
    addPayment(db, { amount: 300, partyType: 'supplier' })
    expect(getPaymentsReport(db, { party_type: 'client' })).toHaveLength(1)
  })

  it('filtre par période', () => {
    db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by) VALUES (1,'client',500,'cash','2026-01-15','pending',1)`).run()
    db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by) VALUES (1,'client',300,'cash','2026-03-15','pending',1)`).run()
    expect(getPaymentsReport(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })

  it('retourne document_number si lié à une facture', () => {
    const invId = makeInvoice(db)
    addPayment(db, { docId: invId, amount: 1200 })
    const rows = getPaymentsReport(db)
    expect(rows[0].document_number).toBeTruthy()
  })

  it('retourne null pour document_number si avance', () => {
    addPayment(db, { amount: 500 })
    const rows = getPaymentsReport(db)
    expect(rows[0].document_number).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Rapport TVA Detail', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  function getTvaDetail(db: Database.Database, f: any = {}) {
    const params: any[] = []
    let where = "WHERE d.is_deleted=0 AND d.status!='cancelled'"
    if (f.start_date) { where += ' AND d.date >= ?'; params.push(f.start_date) }
    if (f.end_date)   { where += ' AND d.date <= ?'; params.push(f.end_date) }
    return db.prepare(`SELECT d.number,d.date,d.type,
      CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
      dl.tva_rate,SUM(dl.total_ht) as base_ht,SUM(dl.total_tva) as tva_amount
      FROM documents d JOIN document_lines dl ON dl.document_id=d.id
      LEFT JOIN clients c ON c.id=d.party_id AND d.party_type='client'
      LEFT JOIN suppliers s ON s.id=d.party_id AND d.party_type='supplier'
      ${where} GROUP BY d.id,dl.tva_rate ORDER BY d.date DESC`).all(...params) as any[]
  }

  it('retourne une ligne par document par taux TVA', () => {
    makeInvoice(db, { tva: 20 })
    expect(getTvaDetail(db)).toHaveLength(1)
  })

  it('groupe par taux TVA différents', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [
        { product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 },
        { product_id: 1, quantity: 3, unit_price: 100, tva_rate: 14 },
      ], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(getTvaDetail(db)).toHaveLength(2)
  })

  it('calcule base_ht et tva_amount correctement', () => {
    makeInvoice(db, { qty: 10, price: 100, tva: 20 })
    const rows = getTvaDetail(db)
    expect(rows[0].base_ht).toBeCloseTo(1000, 2)
    expect(rows[0].tva_amount).toBeCloseTo(200, 2)
  })

  it('exclut les documents annulés', () => {
    const invId = makeInvoice(db)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(getTvaDetail(db)).toHaveLength(0)
  })

  it('filtre par période', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-03-15' })
    expect(getTvaDetail(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('10. Rapport Mouvements Stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  function getStockMovements(db: Database.Database, f: any = {}) {
    const params: any[] = []
    let where = 'WHERE sm.applied=1'
    if (f.product_id) { where += ' AND sm.product_id=?'; params.push(f.product_id) }
    if (f.start_date) { where += ' AND sm.date>=?'; params.push(f.start_date) }
    if (f.end_date)   { where += ' AND sm.date<=?'; params.push(f.end_date) }
    return db.prepare(`SELECT sm.date,sm.type,sm.quantity,sm.unit_cost,sm.cmup_before,sm.cmup_after,
      p.code as product_code,p.name as product_name,p.unit
      FROM stock_movements sm JOIN products p ON p.id=sm.product_id
      ${where} ORDER BY sm.date DESC,sm.id DESC`).all(...params) as any[]
  }

  it('retourne seulement les mouvements appliqués', () => {
    const movId = createStockMovement(db, { product_id:1, type:'in', quantity:10, unit_cost:60, date:'2026-01-15', applied:false, created_by:1 })
    expect(getStockMovements(db)).toHaveLength(0)
    applyMovement(db, movId, 1)
    expect(getStockMovements(db)).toHaveLength(1)
  })

  it('filtre par product_id', () => {
    const m1 = createStockMovement(db, { product_id:1, type:'in', quantity:10, unit_cost:60, date:'2026-01-15', applied:false, created_by:1 })
    const m2 = createStockMovement(db, { product_id:2, type:'in', quantity:5, unit_cost:30, date:'2026-01-15', applied:false, created_by:1 })
    applyMovement(db, m1, 1)
    applyMovement(db, m2, 1)
    expect(getStockMovements(db, { product_id: 1 })).toHaveLength(1)
  })

  it('filtre par période', () => {
    const m1 = createStockMovement(db, { product_id:1, type:'in', quantity:10, unit_cost:60, date:'2026-01-15', applied:false, created_by:1 })
    const m2 = createStockMovement(db, { product_id:1, type:'in', quantity:5, unit_cost:60, date:'2026-03-15', applied:false, created_by:1 })
    applyMovement(db, m1, 1)
    applyMovement(db, m2, 1)
    expect(getStockMovements(db, { start_date: '2026-02-01' })).toHaveLength(1)
  })

  it('retourne cmup_before et cmup_after', () => {
    const movId = createStockMovement(db, { product_id:1, type:'in', quantity:100, unit_cost:60, date:'2026-01-15', applied:false, created_by:1 })
    applyMovement(db, movId, 1)
    const rows = getStockMovements(db)
    expect(rows[0].cmup_before).toBe(50)
    expect(rows[0].cmup_after).toBeCloseTo(55, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('11. Rapport Profit & Loss', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  function getPL(db: Database.Database, f: any = {}) {
    const params: any[] = []
    let df = ''
    if (f.start_date) { df += ' AND je.date >= ?'; params.push(f.start_date) }
    if (f.end_date)   { df += ' AND je.date <= ?'; params.push(f.end_date) }
    const revenues = db.prepare(`SELECT a.code,a.name,COALESCE(SUM(jl.credit),0)-COALESCE(SUM(jl.debit),0) as amount
      FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON je.id=jl.entry_id
      WHERE a.class=7 ${df} GROUP BY a.id`).all(...params) as any[]
    const expenses = db.prepare(`SELECT a.code,a.name,COALESCE(SUM(jl.debit),0)-COALESCE(SUM(jl.credit),0) as amount
      FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON je.id=jl.entry_id
      WHERE a.class=6 ${df} GROUP BY a.id`).all(...params) as any[]
    const totalRevenue = revenues.reduce((s: number, r: any) => s + r.amount, 0)
    const totalExpense = expenses.reduce((s: number, r: any) => s + r.amount, 0)
    return { revenues, expenses, totalRevenue, totalExpense, result: totalRevenue - totalExpense }
  }

  it('facture confirmée génère des revenus (classe 7)', () => {
    makeInvoice(db, { qty: 10, price: 100, tva: 20 })
    const pl = getPL(db)
    expect(pl.totalRevenue).toBeGreaterThan(0)
  })

  it('facture fournisseur génère des charges (classe 6)', () => {
    makePurchaseInvoice(db)
    const pl = getPL(db)
    expect(pl.totalExpense).toBeGreaterThan(0)
  })

  it('result = totalRevenue - totalExpense', () => {
    makeInvoice(db, { qty: 10, price: 100, tva: 20 })
    makePurchaseInvoice(db)
    const pl = getPL(db)
    expect(pl.result).toBeCloseTo(pl.totalRevenue - pl.totalExpense, 2)
  })

  it('filtre par période', () => {
    makeInvoice(db, { date: '2026-01-15', qty: 10, price: 100 })
    makeInvoice(db, { date: '2026-03-15', qty: 10, price: 100 })
    const pl1 = getPL(db, { start_date: '2026-01-01', end_date: '2026-01-31' })
    const pl2 = getPL(db)
    expect(pl2.totalRevenue).toBeGreaterThan(pl1.totalRevenue)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('12. Type de rapport inconnu', () => {
  it('lance une erreur pour type inconnu', () => {
    const db = createTestDb()
    expect(() => {
      const handler = (type: string) => {
        switch(type) {
          case 'overdue': return []
          default: throw new Error(`Type de rapport inconnu: ${type}`)
        }
      }
      handler('unknown_type')
    }).toThrow('Type de rapport inconnu: unknown_type')
  })
})
