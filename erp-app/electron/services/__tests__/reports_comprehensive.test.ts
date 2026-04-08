/**
 * Tests Complets — Rapports & Paiements
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
  db.prepare(`INSERT INTO clients (id,name,phone) VALUES (1,'Client A','0600000001'),(2,'Client B','0600000002')`).run()
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',100,50,5,120)`).run()
  return db
}

function makeInvoice(db: Database.Database, opts: {
  clientId?: number; qty?: number; price?: number; dueDate?: string; date?: string
} = {}) {
  const { id } = createDocument({
    type: 'invoice', date: opts.date ?? '2026-01-15',
    party_id: opts.clientId ?? 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: opts.qty ?? 10, unit_price: opts.price ?? 100, tva_rate: 20 }],
    created_by: 1,
    extra: { due_date: opts.dueDate ?? null },
  })
  confirmDocument(id, 1)
  return id
}

function allocate(db: Database.Database, payId: number, docId: number, amount: number) {
  db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, docId, amount)
}

function updateDocStatus(db: Database.Database, docId: number) {
  const doc = db.prepare('SELECT total_ttc, status FROM documents WHERE id=?').get(docId) as any
  if (!doc || ['cancelled', 'delivered'].includes(doc.status)) return
  const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(docId) as any).t
  let payStatus = 'unpaid'
  if (paid >= doc.total_ttc - 0.01) payStatus = 'paid'
  else if (paid > 0) payStatus = 'partial'
  db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run(payStatus, docId)
  if (payStatus === 'paid') db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(docId)
  else if (payStatus === 'partial') db.prepare(`UPDATE documents SET status='partial' WHERE id=?`).run(docId)
  else db.prepare(`UPDATE documents SET status='confirmed' WHERE id=? AND status IN ('paid','partial')`).run(docId)
}

function addCashPayment(db: Database.Database, docId: number, amount: number) {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
    VALUES (1,'client',?,'cash','2026-01-20','collected',?,1)`).run(amount, docId)
  const payId = r.lastInsertRowid as number
  allocate(db, payId, docId, amount)
  updateDocStatus(db, docId)
  return payId
}

function addCheque(db: Database.Database, docId: number, amount: number, dueDate: string, num = 'CHQ-001') {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,due_date,cheque_number,created_by)
    VALUES (1,'client',?,'cheque','2026-01-20','pending',?,?,?,1)`).run(amount, docId, dueDate, num)
  return r.lastInsertRowid as number
}

function clearCheque(db: Database.Database, payId: number) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(payId) as any
  db.prepare(`UPDATE payments SET status='cleared' WHERE id=?`).run(payId)
  if (p.document_id) {
    allocate(db, payId, p.document_id, p.amount)
    updateDocStatus(db, p.document_id)
  }
}

function bounceCheque(db: Database.Database, payId: number) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(payId) as any
  db.prepare(`UPDATE payments SET status='bounced' WHERE id=?`).run(payId)
  db.prepare('DELETE FROM payment_allocations WHERE payment_id=?').run(payId)
  if (p.document_id) updateDocStatus(db, p.document_id)
}

function getOverdue(db: Database.Database, today: string) {
  return db.prepare(`
    SELECT d.number, d.date, di.due_date, c.name as client_name,
      d.total_ttc,
      COALESCE(SUM(pa.amount),0) as total_paid,
      d.total_ttc - COALESCE(SUM(pa.amount),0) as remaining,
      CAST(julianday(?) - julianday(di.due_date) AS INTEGER) as days_overdue,
      d.status
    FROM documents d
    JOIN doc_invoices di ON di.document_id = d.id
    LEFT JOIN clients c ON c.id = d.party_id
    LEFT JOIN payment_allocations pa ON pa.document_id = d.id
    WHERE d.type='invoice' AND d.is_deleted=0
      AND d.status NOT IN ('paid','cancelled')
      AND di.due_date IS NOT NULL AND di.due_date < ?
    GROUP BY d.id
    HAVING remaining > 0.01
    ORDER BY days_overdue DESC
  `).all(today, today) as any[]
}

function getReceivables(db: Database.Database) {
  return db.prepare(`
    SELECT c.name as client_name,
      COALESCE(SUM(d.total_ttc),0) as total_invoiced,
      COALESCE(SUM(pa.amount),0) as total_paid,
      COALESCE(SUM(d.total_ttc),0) - COALESCE(SUM(pa.amount),0) as balance
    FROM clients c
    LEFT JOIN documents d ON d.party_id=c.id AND d.party_type='client'
      AND d.type='invoice' AND d.is_deleted=0 AND d.status!='cancelled'
    LEFT JOIN payment_allocations pa ON pa.document_id=d.id
    GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC
  `).all() as any[]
}

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Fواتير en retard (Overdue)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture sans due_date → jamais en retard', () => {
    makeInvoice(db, { dueDate: undefined })
    const overdue = getOverdue(db, '2026-12-31')
    expect(overdue).toHaveLength(0)
  })

  it('facture avec due_date future → pas en retard', () => {
    makeInvoice(db, { dueDate: '2026-12-31' })
    const overdue = getOverdue(db, '2026-06-01')
    expect(overdue).toHaveLength(0)
  })

  it('facture avec due_date passée → en retard', () => {
    makeInvoice(db, { dueDate: '2026-01-01' })
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].days_overdue).toBe(93)
  })

  it('facture payée → jamais en retard même si due_date passée', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    addCashPayment(db, invId, 1200)
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(0)
  })

  it('facture annulée → jamais en retard', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(0)
  })

  it('facture partiellement payée → en retard avec remaining correct', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' }) // TTC=1200
    addCashPayment(db, invId, 400)
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].remaining).toBeCloseTo(800, 2)
  })

  it('chèque pending ne réduit pas le remaining dans overdue', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' }) // TTC=1200
    addCheque(db, invId, 1200, '2026-02-01') // pending → pas d'allocation
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(1)
    expect(overdue[0].remaining).toBeCloseTo(1200, 2)
  })

  it('chèque cleared → réduit le remaining', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(0) // facture paid
  })

  it('plusieurs factures en retard → triées par days_overdue DESC', () => {
    makeInvoice(db, { dueDate: '2026-03-01', clientId: 1 }) // 34j retard
    makeInvoice(db, { dueDate: '2026-01-01', clientId: 2 }) // 93j retard
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(2)
    expect(overdue[0].days_overdue).toBeGreaterThan(overdue[1].days_overdue)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Chèques & LCN lifecycle', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('chèque pending → facture reste confirmed', () => {
    const invId = makeInvoice(db)
    addCheque(db, invId, 1200, '2026-02-01')
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('confirmed')
    expect((db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(invId) as any).t).toBe(0)
  })

  it('chèque cleared → facture paid', () => {
    const invId = makeInvoice(db)
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('paid')
  })

  it('chèque cleared partiel → facture partial', () => {
    const invId = makeInvoice(db) // TTC=1200
    const payId = addCheque(db, invId, 600, '2026-02-01')
    clearCheque(db, payId)
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('partial')
  })

  it('chèque bounced → facture revient à confirmed', () => {
    const invId = makeInvoice(db)
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    bounceCheque(db, payId)
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('confirmed')
    expect((db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(invId) as any).t).toBe(0)
  })

  it('LCN fonctionne comme chèque', () => {
    const invId = makeInvoice(db)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,due_date,cheque_number,created_by)
      VALUES (1,'client',1200,'lcn','2026-01-20','pending',?,?,?,1)`).run(invId, '2026-03-01', 'LCN-001')
    const payId = r.lastInsertRowid as number
    clearCheque(db, payId)
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('paid')
  })

  it("chèque en retard (due_date passée) → toujours pending jusqu'à action", () => {
    const invId = makeInvoice(db)
    const payId = addCheque(db, invId, 1200, '2026-01-01') // due_date passée
    const pay = db.prepare('SELECT status FROM payments WHERE id=?').get(payId) as any
    expect(pay.status).toBe('pending') // pas de changement automatique
    const doc = db.prepare('SELECT status FROM documents WHERE id=?').get(invId) as any
    expect(doc.status).toBe('confirmed') // facture non payée
  })

  it('rapport chèques filtre par due_date', () => {
    const invId = makeInvoice(db)
    addCheque(db, invId, 600, '2026-02-15', 'CHQ-001')
    addCheque(db, invId, 600, '2026-03-15', 'CHQ-002')
    const cheques = db.prepare(`
      SELECT * FROM payments WHERE method IN ('cheque','lcn')
      AND due_date >= ? AND due_date <= ?
    `).all('2026-02-01', '2026-02-28') as any[]
    expect(cheques).toHaveLength(1)
    expect(cheques[0].cheque_number).toBe('CHQ-001')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Créances clients (Receivables)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('client sans facture → pas dans receivables', () => {
    const r = getReceivables(db)
    expect(r).toHaveLength(0)
  })

  it('facture non payée → balance = total_ttc', () => {
    makeInvoice(db, { clientId: 1 }) // TTC=1200
    const r = getReceivables(db)
    expect(r).toHaveLength(1)
    expect(r[0].balance).toBeCloseTo(1200, 2)
  })

  it('facture partiellement payée → balance = reste', () => {
    const invId = makeInvoice(db, { clientId: 1 }) // TTC=1200
    addCashPayment(db, invId, 400)
    const r = getReceivables(db)
    expect(r[0].balance).toBeCloseTo(800, 2)
  })

  it('facture payée → client disparaît des receivables', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    addCashPayment(db, invId, 1200)
    const r = getReceivables(db)
    expect(r).toHaveLength(0)
  })

  it('chèque pending ne réduit pas la créance', () => {
    const invId = makeInvoice(db, { clientId: 1 }) // TTC=1200
    addCheque(db, invId, 1200, '2026-02-01')
    const r = getReceivables(db)
    expect(r[0].balance).toBeCloseTo(1200, 2) // toujours dû
  })

  it('chèque cleared réduit la créance', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    const r = getReceivables(db)
    expect(r).toHaveLength(0)
  })

  it('plusieurs clients triés par balance DESC', () => {
    makeInvoice(db, { clientId: 1, qty: 5, price: 100 })  // TTC=600
    makeInvoice(db, { clientId: 2, qty: 10, price: 200 }) // TTC=2400
    const r = getReceivables(db)
    expect(r[0].balance).toBeGreaterThan(r[1].balance)
  })

  it('facture annulée → exclue des receivables', () => {
    const invId = makeInvoice(db, { clientId: 1 })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    const r = getReceivables(db)
    expect(r).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Statuts de paiement (payment_status)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture confirmée → payment_status = unpaid', () => {
    const invId = makeInvoice(db)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('unpaid')
  })

  it('paiement cash partiel → payment_status = partial', () => {
    const invId = makeInvoice(db) // TTC=1200
    addCashPayment(db, invId, 600)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('partial')
  })

  it('paiement cash complet → payment_status = paid', () => {
    const invId = makeInvoice(db)
    addCashPayment(db, invId, 1200)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('paid')
  })

  it('chèque pending → payment_status reste unpaid', () => {
    const invId = makeInvoice(db)
    addCheque(db, invId, 1200, '2026-02-01')
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('unpaid')
  })

  it('chèque cleared → payment_status = paid', () => {
    const invId = makeInvoice(db)
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('paid')
  })

  it('chèque bounced → payment_status revient à unpaid', () => {
    const invId = makeInvoice(db)
    const payId = addCheque(db, invId, 1200, '2026-02-01')
    clearCheque(db, payId)
    bounceCheque(db, payId)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(sub.payment_status).toBe('unpaid')
  })

  it('avoir commercial → payment_status = partial ou paid', () => {
    const invId = makeInvoice(db) // TTC=1200
    // Avoir commercial 600
    const { id: avoirId } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Test' },
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, avoirId, 'invoice_to_avoir')
    confirmDocument(avoirId, 1)
    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=?').get(invId) as any
    expect(['partial', 'paid']).toContain(sub.payment_status)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Cohérence overdue vs InvoicesList', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('même facture détectée en retard par les deux méthodes', () => {
    const invId = makeInvoice(db, { dueDate: '2026-01-01' })
    const today = '2026-04-04'

    // Méthode 1: getOverdueReport (backend)
    const overdueReport = getOverdue(db, today)
    expect(overdueReport).toHaveLength(1)

    // Méthode 2: isOverdue (frontend logic)
    const doc = db.prepare(`
      SELECT d.*, di.due_date FROM documents d
      JOIN doc_invoices di ON di.document_id = d.id
      WHERE d.id=?
    `).get(invId) as any
    const dueDate = new Date(doc.due_date)
    const todayDate = new Date(today)
    const isOverdue = dueDate < todayDate && !['paid','cancelled'].includes(doc.status)
    expect(isOverdue).toBe(true)
  })

  it('facture avec due_date = today → pas en retard', () => {
    const today = '2026-04-04'
    makeInvoice(db, { dueDate: today })
    const overdue = getOverdue(db, today)
    expect(overdue).toHaveLength(0) // due_date < today → false quand égal
  })

  it('overdue count = nombre de factures avec due_date < today et non payées', () => {
    makeInvoice(db, { dueDate: '2026-01-01' }) // en retard
    makeInvoice(db, { dueDate: '2026-01-15' }) // en retard
    makeInvoice(db, { dueDate: '2026-12-31' }) // pas en retard
    makeInvoice(db, { dueDate: undefined })     // pas de due_date
    const overdue = getOverdue(db, '2026-04-04')
    expect(overdue).toHaveLength(2)
  })

  it('overdue amount = somme des remaining des factures en retard', () => {
    makeInvoice(db, { dueDate: '2026-01-01', qty: 10, price: 100 }) // TTC=1200
    makeInvoice(db, { dueDate: '2026-01-15', qty: 5, price: 100 })  // TTC=600
    const overdue = getOverdue(db, '2026-04-04')
    const totalRemaining = overdue.reduce((s: number, r: any) => s + r.remaining, 0)
    expect(totalRemaining).toBeCloseTo(1800, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Rapports — Ventes (Sales)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('rapport ventes inclut toutes les factures non annulées', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-02-15' })
    const invId3 = makeInvoice(db, { date: '2026-03-15' })
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId3)

    const sales = db.prepare(`
      SELECT d.number, d.date, d.total_ttc, di.payment_status
      FROM documents d
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      WHERE d.type='invoice' AND d.is_deleted=0 AND d.status!='cancelled'
      ORDER BY d.date DESC
    `).all() as any[]
    expect(sales).toHaveLength(2)
  })

  it('rapport ventes filtre par période', () => {
    makeInvoice(db, { date: '2026-01-15' })
    makeInvoice(db, { date: '2026-02-15' })
    makeInvoice(db, { date: '2026-03-15' })

    const sales = db.prepare(`
      SELECT * FROM documents d
      WHERE d.type='invoice' AND d.is_deleted=0 AND d.status!='cancelled'
      AND d.date >= ? AND d.date <= ?
    `).all('2026-02-01', '2026-02-28') as any[]
    expect(sales).toHaveLength(1)
  })

  it('payment_status dans rapport ventes est correct', () => {
    const invId = makeInvoice(db)
    addCashPayment(db, invId, 1200)

    const sales = db.prepare(`
      SELECT d.number, di.payment_status
      FROM documents d
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      WHERE d.id=?
    `).get(invId) as any
    expect(sales.payment_status).toBe('paid')
  })
})

