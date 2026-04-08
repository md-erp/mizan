/**
 * Tests Complets Avancés — Clients & Fournisseurs
 * Couvre: balance avec avances, chèques bounced, avoir, multi-scénarios,
 *         edge cases, cohérence frontend/backend
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
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',100,50,5,120)`).run()
  return db
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function createClient(db: Database.Database, opts: { name?: string; credit_limit?: number } = {}) {
  return db.prepare(`INSERT INTO clients (name,credit_limit,created_by) VALUES (?,?,1)`)
    .run(opts.name ?? 'Client Test', opts.credit_limit ?? 0).lastInsertRowid as number
}

function createSupplier(db: Database.Database, name = 'Fournisseur Test') {
  return db.prepare(`INSERT INTO suppliers (name,created_by) VALUES (?,1)`)
    .run(name).lastInsertRowid as number
}

function makeInvoice(db: Database.Database, clientId: number, qty = 10, price = 100) {
  const { id } = createDocument({
    type: 'invoice', date: '2026-01-15', party_id: clientId, party_type: 'client',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }], created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function makePurchaseInvoice(db: Database.Database, supplierId: number, qty = 5, price = 80) {
  const { id } = createDocument({
    type: 'purchase_invoice', date: '2026-01-15', party_id: supplierId, party_type: 'supplier',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }], created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

// Balance = total_invoiced - total_payments (incluant avances, excluant pending cheques et bounced)
function getBalance(db: Database.Database, partyId: number, partyType: 'client' | 'supplier', docTypes: string[]) {
  const inv = (db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM documents
    WHERE party_id=? AND party_type=? AND type IN (${docTypes.map(() => '?').join(',')})
    AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')`
  ).get(partyId, partyType, ...docTypes) as any).t ?? 0
  const pay = (db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM payments
    WHERE party_id=? AND party_type=?
    AND NOT (method IN ('cheque','lcn') AND status='pending')
    AND status != 'bounced'`
  ).get(partyId, partyType) as any).t ?? 0
  return inv - pay
}

const clientBalance = (db: Database.Database, id: number) => getBalance(db, id, 'client', ['invoice'])
const supplierBalance = (db: Database.Database, id: number) => getBalance(db, id, 'supplier', ['purchase_invoice', 'import_invoice'])

function addPayment(db: Database.Database, opts: {
  partyId: number; partyType: string; amount: number
  method?: string; status?: string; docId?: number; dueDate?: string
}) {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,due_date,created_by)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(
    opts.partyId, opts.partyType, opts.amount, opts.method ?? 'cash',
    '2026-01-20', opts.status ?? 'collected', opts.docId ?? null, opts.dueDate ?? null
  )
  const payId = r.lastInsertRowid as number
  if (opts.docId && opts.method !== 'cheque' && opts.method !== 'lcn') {
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, opts.docId, opts.amount)
  }
  return payId
}

// ═══════════════════════════════════════════════════════════════════════════
describe('Balance — Scénarios complets', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('client sans aucune transaction → balance = 0', () => {
    const cId = createClient(db)
    expect(clientBalance(db, cId)).toBe(0)
  })

  it('facture confirmée → balance = TTC', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(clientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('paiement cash lié → balance réduite', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 500, docId: invId })
    expect(clientBalance(db, cId)).toBeCloseTo(700, 2)
  })

  it('paiement complet → balance = 0', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 1200, docId: invId })
    expect(clientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('avance (sans facture) → réduit la balance', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    addPayment(db, { partyId: cId, partyType: 'client', amount: 300 }) // avance
    expect(clientBalance(db, cId)).toBeCloseTo(900, 2)
  })

  it('chèque pending → ne réduit PAS la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 1200, method: 'cheque', status: 'pending', docId: invId })
    expect(clientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('chèque cleared → réduit la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 1200, method: 'cheque', status: 'cleared', docId: invId })
    expect(clientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('chèque bounced → ne réduit PAS la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 1200, method: 'cheque', status: 'bounced', docId: invId })
    expect(clientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('LCN pending → ne réduit PAS la balance', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 600, method: 'lcn', status: 'pending' })
    expect(clientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('LCN cleared → réduit la balance', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 600, method: 'lcn', status: 'cleared' })
    expect(clientBalance(db, cId)).toBeCloseTo(600, 2)
  })

  it('avoir commercial → réduit la balance via payment record', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100) // TTC=1200
    const { id: avoirId } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: cId, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Test' }, created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, avoirId, 'invoice_to_avoir')
    confirmDocument(avoirId, 1)
    // Avoir crée un payment record avec method='avoir'
    expect(clientBalance(db, cId)).toBeLessThan(1200)
  })

  it('facture annulée → exclue de la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(clientBalance(db, cId)).toBe(0)
  })

  it('facture draft → exclue de la balance', () => {
    const cId = createClient(db)
    createDocument({
      type: 'invoice', date: '2026-01-15', party_id: cId, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    expect(clientBalance(db, cId)).toBe(0)
  })

  it('facture delivered → incluse dans la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    db.prepare(`UPDATE documents SET status='delivered' WHERE id=?`).run(invId)
    expect(clientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('mix: facture + avance + chèque pending → balance correcte', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    addPayment(db, { partyId: cId, partyType: 'client', amount: 200 }) // avance cash
    addPayment(db, { partyId: cId, partyType: 'client', amount: 500, method: 'cheque', status: 'pending' }) // pending → ignoré
    // balance = 1200 - 200 = 1000
    expect(clientBalance(db, cId)).toBeCloseTo(1000, 2)
  })

  it('mix: facture + avance + chèque cleared → balance correcte', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    addPayment(db, { partyId: cId, partyType: 'client', amount: 200 }) // avance cash
    addPayment(db, { partyId: cId, partyType: 'client', amount: 500, method: 'cheque', status: 'cleared' }) // cleared → compte
    // balance = 1200 - 200 - 500 = 500
    expect(clientBalance(db, cId)).toBeCloseTo(500, 2)
  })

  it('balance négative possible (trop payé)', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    addPayment(db, { partyId: cId, partyType: 'client', amount: 1500 }) // surpayé
    expect(clientBalance(db, cId)).toBeCloseTo(-300, 2)
  })

  it('plusieurs factures cumulées', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 5, 100)  // TTC=600
    makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(clientBalance(db, cId)).toBeCloseTo(1800, 2)
  })

  it('isolation: balance client 1 ≠ client 2', () => {
    const c1 = createClient(db, { name: 'C1' })
    const c2 = createClient(db, { name: 'C2' })
    makeInvoice(db, c1, 10, 100)
    expect(clientBalance(db, c2)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Balance Fournisseur — Scénarios', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('fournisseur sans transaction → balance = 0', () => {
    const sId = createSupplier(db)
    expect(supplierBalance(db, sId)).toBe(0)
  })

  it('facture fournisseur → balance = TTC', () => {
    const sId = createSupplier(db)
    makePurchaseInvoice(db, sId, 5, 80) // TTC=480
    expect(supplierBalance(db, sId)).toBeCloseTo(480, 2)
  })

  it('paiement fournisseur → réduit la balance', () => {
    const sId = createSupplier(db)
    makePurchaseInvoice(db, sId, 5, 80)
    addPayment(db, { partyId: sId, partyType: 'supplier', amount: 200 })
    expect(supplierBalance(db, sId)).toBeCloseTo(280, 2)
  })

  it('chèque fournisseur pending → ne réduit pas', () => {
    const sId = createSupplier(db)
    makePurchaseInvoice(db, sId, 5, 80)
    addPayment(db, { partyId: sId, partyType: 'supplier', amount: 480, method: 'cheque', status: 'pending' })
    expect(supplierBalance(db, sId)).toBeCloseTo(480, 2)
  })

  it('facture client exclue de la balance fournisseur', () => {
    const sId = createSupplier(db)
    const cId = db.prepare(`INSERT INTO clients (name,created_by) VALUES ('C',1)`).run().lastInsertRowid as number
    makeInvoice(db, cId, 10, 100)
    expect(supplierBalance(db, sId)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Credit Limit — Scénarios', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('balance < credit_limit → pas de dépassement', () => {
    const cId = createClient(db, { credit_limit: 5000 })
    makeInvoice(db, cId, 2, 100) // TTC=240
    expect(clientBalance(db, cId)).toBeLessThan(5000)
  })

  it('balance > credit_limit → dépassement', () => {
    const cId = createClient(db, { credit_limit: 500 })
    makeInvoice(db, cId, 10, 100) // TTC=1200
    const bal = clientBalance(db, cId)
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(cId) as any
    expect(bal).toBeGreaterThan(c.credit_limit)
  })

  it('credit_limit = 0 → aucune limite', () => {
    const cId = createClient(db, { credit_limit: 0 })
    makeInvoice(db, cId, 100, 1000) // TTC=120000
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(cId) as any
    expect(c.credit_limit).toBe(0)
  })

  it('paiement ramène balance sous credit_limit → plus de dépassement', () => {
    const cId = createClient(db, { credit_limit: 1000 })
    const invId = makeInvoice(db, cId, 10, 100) // TTC=1200 > 1000
    addPayment(db, { partyId: cId, partyType: 'client', amount: 300, docId: invId })
    // balance = 900 < 1000 → plus de dépassement
    expect(clientBalance(db, cId)).toBeLessThan(1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('CRUD Avancé', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('mise à jour credit_limit', () => {
    const cId = createClient(db, { credit_limit: 1000 })
    db.prepare('UPDATE clients SET credit_limit=5000 WHERE id=?').run(cId)
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(cId) as any
    expect(c.credit_limit).toBe(5000)
  })

  it('client supprimé → invisible dans getAll', () => {
    const cId = createClient(db, { name: 'À supprimer' })
    db.prepare('UPDATE clients SET is_deleted=1 WHERE id=?').run(cId)
    const rows = db.prepare('SELECT * FROM clients WHERE is_deleted=0').all()
    expect(rows.find((r: any) => r.id === cId)).toBeUndefined()
  })

  it('client supprimé → ses paiements restent en base', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addPayment(db, { partyId: cId, partyType: 'client', amount: 500, docId: invId })
    db.prepare('UPDATE clients SET is_deleted=1 WHERE id=?').run(cId)
    const pays = db.prepare('SELECT * FROM payments WHERE party_id=?').all(cId)
    expect(pays).toHaveLength(1)
  })

  it('recherche partielle par nom', () => {
    db.prepare(`INSERT INTO clients (name,created_by) VALUES ('Société ABC',1)`).run()
    db.prepare(`INSERT INTO clients (name,created_by) VALUES ('Entreprise XYZ',1)`).run()
    const rows = db.prepare(`SELECT * FROM clients WHERE is_deleted=0 AND name LIKE ?`).all('%ABC%')
    expect(rows).toHaveLength(1)
  })

  it('recherche par ICE', () => {
    db.prepare(`INSERT INTO clients (name,ice,created_by) VALUES ('Client A','123456789012345',1)`).run()
    db.prepare(`INSERT INTO clients (name,ice,created_by) VALUES ('Client B','987654321098765',1)`).run()
    const rows = db.prepare(`SELECT * FROM clients WHERE is_deleted=0 AND ice LIKE ?`).all('%12345%')
    expect(rows).toHaveLength(1)
  })

  it('deux clients avec le même nom → autorisé', () => {
    db.prepare(`INSERT INTO clients (name,created_by) VALUES ('Dupont',1)`).run()
    db.prepare(`INSERT INTO clients (name,created_by) VALUES ('Dupont',1)`).run()
    const rows = db.prepare(`SELECT * FROM clients WHERE name='Dupont' AND is_deleted=0`).all()
    expect(rows).toHaveLength(2)
  })
})
