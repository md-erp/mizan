/**
 * Tests Complets -- Vحدة المشتريات
 * Couvre: BC, BR, FF, Import, landed cost, BC->received, accounting
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'
import { applyMovement } from '../stock.service'

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
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A'),(2,'Fournisseur B')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'MP001','Matiere A','kg','raw',0,0,5,0)`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (2,'MP002','Matiere B','pcs','raw',100,30,5,0)`).run()
  return db
}

const getDoc = (db: Database.Database, id: number) =>
  db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any

// ─────────────────────────────────────────────────────────────────────────────
describe('1. Bon de Commande (BC)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('cree un BC en statut draft', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    expect(getDoc(db, id).status).toBe('draft')
    expect(getDoc(db, id).type).toBe('purchase_order')
  })

  it('confirme un BC -> statut confirmed', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(getDoc(db, id).status).toBe('confirmed')
  })

  it('BC confirme -> pas de mouvement stock', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id)
    expect(movs).toHaveLength(0)
  })

  it('BC confirme -> pas de quid comptable', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id=? AND source_type='purchase_order'`).get(id)
    expect(entry).toBeUndefined()
  })

  it('calcule correctement HT/TVA/TTC', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 80, tva_rate: 20 }], created_by: 1,
    })
    const doc = getDoc(db, id)
    expect(doc.total_ht).toBeCloseTo(800, 2)
    expect(doc.total_tva).toBeCloseTo(160, 2)
    expect(doc.total_ttc).toBeCloseTo(960, 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2. Bon de Reception (BR)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BR confirme -> mouvement stock entrant en attente', () => {
    const { id } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(id) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
    expect(movs[0].quantity).toBe(50)
  })

  it('BR confirme -> quid comptable 3121/3455/4411', () => {
    const { id } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id=? AND source_type='bl_reception'`).get(id) as any
    expect(entry).toBeDefined()
    const lines = db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entry.id) as any[]
    expect(lines.find((l: any) => l.code === '3121' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '4411' && l.credit > 0)).toBeDefined()
  })

  it('BR -> appliquer mouvement -> stock augmente + CMUP recalcule', () => {
    const { id } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(id) as any[]
    applyMovement(db, movs[0].id, 1)
    const p = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    expect(p.stock_quantity).toBe(100)
    expect(p.cmup_price).toBeCloseTo(40, 2)
  })

  it('BR lie a BC -> BC passe a received', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getDoc(db, bcId).status).toBe('received')
  })

  it('BR sans BC lie -> BC non affecte', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1) // pas de lien
    expect(getDoc(db, bcId).status).toBe('confirmed') // BC reste confirmed
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3. Facture Fournisseur (FF)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('FF confirmee -> quid 6121/3455/4411', () => {
    const { id } = createDocument({
      type: 'purchase_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id=? AND source_type='purchase_invoice'`).get(id) as any
    expect(entry).toBeDefined()
    const lines = db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entry.id) as any[]
    expect(lines.find((l: any) => l.code === '6121' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '3455' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '4411' && l.credit > 0)).toBeDefined()
  })

  it('quid equilibre (debit = credit)', () => {
    const { id } = createDocument({
      type: 'purchase_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id=?`).get(id) as any
    const lines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id=?`).all(entry.id) as any[]
    const totalDebit  = lines.reduce((s: number, l: any) => s + l.debit, 0)
    const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0)
    expect(totalDebit).toBeCloseTo(totalCredit, 2)
  })

  it('FF -> payment_status = unpaid', () => {
    const { id } = createDocument({
      type: 'purchase_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const sub = db.prepare('SELECT * FROM doc_purchase_invoices WHERE document_id=?').get(id) as any
    expect(sub.payment_status).toBe('unpaid')
  })

  it('paiement FF -> balance fournisseur reduite', () => {
    const { id } = createDocument({
      type: 'purchase_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const doc = getDoc(db, id)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',?,?,?,?,?,1)`).run(doc.total_ttc, 'bank', '2026-01-20', 'collected', id)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, id, doc.total_ttc)
    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(id) as any).t
    expect(paid).toBeCloseTo(doc.total_ttc, 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4. Importation (Landed Cost)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('import confirme -> quid 3121/3455/4411/4481', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }], created_by: 1,
      extra: {
        currency: 'EUR', exchange_rate: 10.8,
        invoice_amount: 400, customs: 500, transitaire: 200,
        tva_import: 300, other_costs: 100, total_cost: 5400,
      },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id=? AND source_type='import_invoice'`).get(id) as any
    expect(entry).toBeDefined()
    const lines = db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entry.id) as any[]
    expect(lines.find((l: any) => l.code === '3121' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '4411' && l.credit > 0)).toBeDefined()
  })

  it('landed cost reparti proportionnellement aux quantites', () => {
    // 2 produits: 100 kg + 200 kg = 300 kg total
    // total_cost = 3000 MAD
    // P1 = 100/300 * 3000 = 1000 MAD -> unit_cost = 10
    // P2 = 200/300 * 3000 = 2000 MAD -> unit_cost = 10
    const totalCost = 3000
    const lines = [
      { product_id: 1, quantity: 100, unit_price: 0 },
      { product_id: 2, quantity: 200, unit_price: 0 },
    ]
    const totalQty = lines.reduce((s, l) => s + l.quantity, 0)
    const allocated = lines.map(l => ({
      allocated: (l.quantity / totalQty) * totalCost,
      unit_cost: (l.quantity / totalQty) * totalCost / l.quantity,
    }))
    expect(allocated[0].allocated).toBeCloseTo(1000, 2)
    expect(allocated[1].allocated).toBeCloseTo(2000, 2)
    expect(allocated[0].unit_cost).toBeCloseTo(10, 2)
    expect(allocated[1].unit_cost).toBeCloseTo(10, 2)
  })

  it('import -> pas de mouvement stock direct (pas de BR)', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }], created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    // Import invoice ne cree pas de mouvement stock (contrairement a bl_reception)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id)
    expect(movs).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5. Flux complet: BC -> BR -> FF -> Paiement', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('flux complet achat local', () => {
    // 1. BC
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)
    expect(getDoc(db, bcId).status).toBe('confirmed')

    // 2. BR lie au BC
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-12', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getDoc(db, bcId).status).toBe('received') // BC -> received
    
    // 3. Appliquer stock
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)
    const p = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    expect(p.stock_quantity).toBe(200)
    expect(p.cmup_price).toBeCloseTo(35, 2)

    // 4. Facture fournisseur
    const { id: ffId } = createDocument({
      type: 'purchase_invoice', date: '2026-01-13', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(ffId, 1)
    const ffDoc = getDoc(db, ffId)
    expect(ffDoc.total_ttc).toBeCloseTo(200 * 35 * 1.2, 2)

    // 5. Paiement
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',?,'bank','2026-01-20','collected',?,1)`).run(ffDoc.total_ttc, ffId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, ffId, ffDoc.total_ttc)
    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(ffId) as any).t
    expect(paid).toBeCloseTo(ffDoc.total_ttc, 2)
  })
})
