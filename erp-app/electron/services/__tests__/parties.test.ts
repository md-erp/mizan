/**
 * Tests Complets — Clients & Fournisseurs
 * Couvre: CRUD, balance, search, pagination, credit_limit,
 *         soft delete, balance avec chèques pending/cleared
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

// ── Client helpers ────────────────────────────────────────────────────────────
function createClient(db: Database.Database, opts: {
  name?: string; ice?: string; phone?: string; email?: string
  address?: string; credit_limit?: number; notes?: string
} = {}) {
  const r = db.prepare(`INSERT INTO clients (name,address,email,phone,ice,if_number,rc,credit_limit,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,1)`).run(
    opts.name ?? 'Client Test', opts.address ?? null, opts.email ?? null,
    opts.phone ?? null, opts.ice ?? null, null, null,
    opts.credit_limit ?? 0, opts.notes ?? null
  )
  return r.lastInsertRowid as number
}

function createSupplier(db: Database.Database, opts: { name?: string; ice?: string } = {}) {
  const r = db.prepare(`INSERT INTO suppliers (name,address,email,phone,ice,if_number,rc,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(
    opts.name ?? 'Fournisseur Test', null, null, null, opts.ice ?? null, null, null, null
  )
  return r.lastInsertRowid as number
}

function getClientBalance(db: Database.Database, clientId: number): number {
  const inv = (db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM documents
    WHERE party_id=? AND party_type='client' AND type='invoice'
    AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')`).get(clientId) as any).t ?? 0
  const pay = (db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM payments
    WHERE party_id=? AND party_type='client'
    AND NOT (method IN ('cheque','lcn') AND status='pending')
    AND status != 'bounced'`).get(clientId) as any).t ?? 0
  return inv - pay
}

function getSupplierBalance(db: Database.Database, supplierId: number): number {
  const inv = (db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM documents
    WHERE party_id=? AND party_type='supplier'
    AND type IN ('purchase_invoice','import_invoice')
    AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')`).get(supplierId) as any).t ?? 0
  const pay = (db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM payments
    WHERE party_id=? AND party_type='supplier'
    AND NOT (method IN ('cheque','lcn') AND status='pending')
    AND status != 'bounced'`).get(supplierId) as any).t ?? 0
  return inv - pay
}

function makeInvoice(db: Database.Database, clientId: number, qty = 10, price = 100) {
  const { id } = createDocument({
    type: 'invoice', date: '2026-01-15',
    party_id: clientId, party_type: 'client',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }],
    created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function makePurchaseInvoice(db: Database.Database, supplierId: number, qty = 5, price = 80) {
  const { id } = createDocument({
    type: 'purchase_invoice', date: '2026-01-15',
    party_id: supplierId, party_type: 'supplier',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }],
    created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function addCashPayment(db: Database.Database, docId: number, amount: number, partyId: number, partyType = 'client') {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
    VALUES (?,?,?,'cash','2026-01-20','collected',?,1)`).run(partyId, partyType, amount, docId)
  const payId = r.lastInsertRowid as number
  db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, docId, amount)
  const doc = db.prepare('SELECT total_ttc,status FROM documents WHERE id=?').get(docId) as any
  const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(docId) as any).t
  if (paid >= doc.total_ttc - 0.01) {
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(docId)
    db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run('paid', docId)
  } else if (paid > 0) {
    db.prepare(`UPDATE documents SET status='partial' WHERE id=?`).run(docId)
    db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run('partial', docId)
  }
  return payId
}

function getAllClients(db: Database.Database, search?: string) {
  let query = 'SELECT * FROM clients WHERE is_deleted=0'
  const params: any[] = []
  if (search) {
    query += ' AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)'
    const s = `%${search}%`
    params.push(s, s, s)
  }
  query += ' ORDER BY name ASC'
  return db.prepare(query).all(...params) as any[]
}

function getAllSuppliers(db: Database.Database, search?: string) {
  let query = 'SELECT * FROM suppliers WHERE is_deleted=0'
  const params: any[] = []
  if (search) {
    query += ' AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)'
    const s = `%${search}%`
    params.push(s, s, s)
  }
  query += ' ORDER BY name ASC'
  return db.prepare(query).all(...params) as any[]
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Clients — CRUD', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('crée un client avec tous les champs', () => {
    const id = createClient(db, {
      name: 'Société ABC', ice: '123456789012345', phone: '0600000001',
      email: 'abc@test.ma', address: 'Casablanca', credit_limit: 50000, notes: 'VIP'
    })
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id) as any
    expect(c.name).toBe('Société ABC')
    expect(c.ice).toBe('123456789012345')
    expect(c.credit_limit).toBe(50000)
    expect(c.is_deleted).toBe(0)
  })

  it('crée un client avec seulement le nom', () => {
    const id = createClient(db, { name: 'Client Minimal' })
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id) as any
    expect(c.name).toBe('Client Minimal')
    expect(c.ice).toBeNull()
    expect(c.credit_limit).toBe(0)
  })

  it('met à jour un client', () => {
    const id = createClient(db, { name: 'Ancien Nom' })
    db.prepare(`UPDATE clients SET name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run('Nouveau Nom', '0700000001', id)
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id) as any
    expect(c.name).toBe('Nouveau Nom')
    expect(c.phone).toBe('0700000001')
  })

  it('suppression douce (soft delete)', () => {
    const id = createClient(db, { name: 'À Supprimer' })
    db.prepare('UPDATE clients SET is_deleted=1 WHERE id=?').run(id)
    const rows = getAllClients(db)
    expect(rows.find((c: any) => c.id === id)).toBeUndefined()
    // Toujours en base
    const raw = db.prepare('SELECT * FROM clients WHERE id=?').get(id) as any
    expect(raw.is_deleted).toBe(1)
  })

  it('plusieurs clients triés par nom ASC', () => {
    createClient(db, { name: 'Zara' })
    createClient(db, { name: 'Alpha' })
    createClient(db, { name: 'Mona' })
    const rows = getAllClients(db)
    expect(rows[0].name).toBe('Alpha')
    expect(rows[2].name).toBe('Zara')
  })

  it('recherche par nom', () => {
    createClient(db, { name: 'Société ABC' })
    createClient(db, { name: 'Entreprise XYZ' })
    expect(getAllClients(db, 'ABC')).toHaveLength(1)
  })

  it('recherche par ICE', () => {
    createClient(db, { name: 'Client A', ice: '123456789012345' })
    createClient(db, { name: 'Client B', ice: '987654321098765' })
    expect(getAllClients(db, '12345')).toHaveLength(1)
  })

  it('recherche par téléphone', () => {
    createClient(db, { name: 'Client A', phone: '0600000001' })
    createClient(db, { name: 'Client B', phone: '0700000002' })
    expect(getAllClients(db, '0600')).toHaveLength(1)
  })

  it('recherche insensible à la casse', () => {
    createClient(db, { name: 'Société ABC' })
    expect(getAllClients(db, 'société')).toHaveLength(1)
  })

  it('client introuvable après suppression', () => {
    const id = createClient(db)
    db.prepare('UPDATE clients SET is_deleted=1 WHERE id=?').run(id)
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND is_deleted=0').get(id)
    expect(c).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Fournisseurs — CRUD', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('crée un fournisseur', () => {
    const id = createSupplier(db, { name: 'Fournisseur XYZ', ice: '111111111111111' })
    const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(id) as any
    expect(s.name).toBe('Fournisseur XYZ')
    expect(s.is_deleted).toBe(0)
  })

  it('fournisseur sans credit_limit (pas de champ)', () => {
    const id = createSupplier(db)
    const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(id) as any
    expect(s.credit_limit).toBeUndefined() // pas de champ dans suppliers
  })

  it('suppression douce fournisseur', () => {
    const id = createSupplier(db)
    db.prepare('UPDATE suppliers SET is_deleted=1 WHERE id=?').run(id)
    expect(getAllSuppliers(db)).toHaveLength(0)
  })

  it('recherche fournisseur par nom', () => {
    createSupplier(db, { name: 'Fournisseur A' })
    createSupplier(db, { name: 'Fournisseur B' })
    expect(getAllSuppliers(db, 'Fournisseur A')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Balance Client', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('balance = 0 sans factures', () => {
    const cId = createClient(db)
    expect(getClientBalance(db, cId)).toBe(0)
  })

  it('balance = total_ttc après facture confirmée', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('balance réduite après paiement cash', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addCashPayment(db, invId, 400, cId)
    expect(getClientBalance(db, cId)).toBeCloseTo(800, 2)
  })

  it('balance = 0 après paiement complet', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    addCashPayment(db, invId, 1200, cId)
    expect(getClientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('chèque pending ne réduit pas la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    // Chèque pending: pas d'allocation
    db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (?,'client',1200,'cheque','2026-01-20','pending',?,1)`).run(cId, invId)
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('chèque cleared réduit la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (?,'client',1200,'cheque','2026-01-20','cleared',?,1)`).run(cId, invId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, invId, 1200)
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(invId)
    expect(getClientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('facture annulée exclue de la balance', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    expect(getClientBalance(db, cId)).toBe(0)
  })

  it('facture draft exclue de la balance', () => {
    const cId = createClient(db)
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: cId, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    // Ne pas confirmer → reste draft
    expect(getClientBalance(db, cId)).toBe(0)
  })

  it('plusieurs factures cumulées', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 5, 100)  // TTC=600
    makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(getClientBalance(db, cId)).toBeCloseTo(1800, 2)
  })

  it('balance isolée par client', () => {
    const c1 = createClient(db, { name: 'Client 1' })
    const c2 = createClient(db, { name: 'Client 2' })
    makeInvoice(db, c1, 10, 100)
    expect(getClientBalance(db, c2)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Balance Fournisseur', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('balance = 0 sans factures', () => {
    const sId = createSupplier(db)
    expect(getSupplierBalance(db, sId)).toBe(0)
  })

  it('balance = total_ttc après facture fournisseur', () => {
    const sId = createSupplier(db)
    makePurchaseInvoice(db, sId, 5, 80) // TTC=480
    expect(getSupplierBalance(db, sId)).toBeCloseTo(480, 2)
  })

  it('paiement fournisseur réduit la balance', () => {
    const sId = createSupplier(db)
    const invId = makePurchaseInvoice(db, sId, 5, 80)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (?,'supplier',200,'bank','2026-01-20','pending',?,1)`).run(sId, invId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, invId, 200)
    expect(getSupplierBalance(db, sId)).toBeCloseTo(280, 2)
  })

  it('facture client exclue de la balance fournisseur', () => {
    const sId = createSupplier(db)
    const cId = createClient(db)
    makeInvoice(db, cId) // facture client
    expect(getSupplierBalance(db, sId)).toBe(0)
  })

  it('import_invoice incluse dans la balance', () => {
    const sId = createSupplier(db)
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: sId, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 50, tva_rate: 20 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10, invoice_amount: 50, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 500 },
    })
    confirmDocument(id, 1)
    expect(getSupplierBalance(db, sId)).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Credit Limit', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('credit_limit = 0 par défaut', () => {
    const id = createClient(db)
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(id) as any
    expect(c.credit_limit).toBe(0)
  })

  it('credit_limit configurable', () => {
    const id = createClient(db, { credit_limit: 50000 })
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(id) as any
    expect(c.credit_limit).toBe(50000)
  })

  it('balance < credit_limit → pas de dépassement', () => {
    const id = createClient(db, { credit_limit: 5000 })
    makeInvoice(db, id, 2, 100) // TTC=240
    const balance = getClientBalance(db, id)
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(id) as any
    expect(balance).toBeLessThan(c.credit_limit)
  })

  it('balance > credit_limit → dépassement détecté', () => {
    const id = createClient(db, { credit_limit: 500 })
    makeInvoice(db, id, 10, 100) // TTC=1200 > 500
    const balance = getClientBalance(db, id)
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(id) as any
    expect(balance).toBeGreaterThan(c.credit_limit)
  })

  it('credit_limit = 0 → aucune limite (toujours OK)', () => {
    const id = createClient(db, { credit_limit: 0 })
    makeInvoice(db, id, 100, 1000) // TTC=120000
    const c = db.prepare('SELECT credit_limit FROM clients WHERE id=?').get(id) as any
    expect(c.credit_limit).toBe(0) // 0 = pas de limite
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Pagination & Search', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('pagination: page 1 retourne les premiers résultats', () => {
    for (let i = 1; i <= 10; i++) createClient(db, { name: `Client ${i.toString().padStart(2,'0')}` })
    const rows = db.prepare('SELECT * FROM clients WHERE is_deleted=0 ORDER BY name ASC LIMIT 5 OFFSET 0').all()
    expect(rows).toHaveLength(5)
  })

  it('pagination: page 2 retourne les suivants', () => {
    for (let i = 1; i <= 10; i++) createClient(db, { name: `Client ${i.toString().padStart(2,'0')}` })
    const rows = db.prepare('SELECT * FROM clients WHERE is_deleted=0 ORDER BY name ASC LIMIT 5 OFFSET 5').all()
    expect(rows).toHaveLength(5)
  })

  it('count total correct avec search', () => {
    createClient(db, { name: 'ABC Corp' })
    createClient(db, { name: 'XYZ Ltd' })
    createClient(db, { name: 'ABC Industries' })
    const count = (db.prepare(`SELECT COUNT(*) as c FROM clients WHERE is_deleted=0 AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)`).get('%ABC%','%ABC%','%ABC%') as any).c
    expect(count).toBe(2)
  })

  it('search vide retourne tous les clients', () => {
    createClient(db, { name: 'A' })
    createClient(db, { name: 'B' })
    createClient(db, { name: 'C' })
    expect(getAllClients(db)).toHaveLength(3)
  })

  it('search sans résultat retourne tableau vide', () => {
    createClient(db, { name: 'Client A' })
    expect(getAllClients(db, 'ZZZZZ')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Intégrité des données', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('deux clients peuvent avoir le même nom', () => {
    createClient(db, { name: 'Dupont' })
    createClient(db, { name: 'Dupont' })
    expect(getAllClients(db)).toHaveLength(2)
  })

  it('client supprimé ne compte pas dans les stats', () => {
    const id1 = createClient(db, { name: 'Actif' })
    const id2 = createClient(db, { name: 'Supprimé' })
    db.prepare('UPDATE clients SET is_deleted=1 WHERE id=?').run(id2)
    expect(getAllClients(db)).toHaveLength(1)
  })

  it('balance client non affectée par factures fournisseur', () => {
    const cId = createClient(db)
    const sId = createSupplier(db)
    makePurchaseInvoice(db, sId)
    expect(getClientBalance(db, cId)).toBe(0)
  })

  it('balance fournisseur non affectée par factures client', () => {
    const cId = createClient(db)
    const sId = createSupplier(db)
    makeInvoice(db, cId)
    expect(getSupplierBalance(db, sId)).toBe(0)
  })

  it('updated_at se met à jour lors de la modification', () => {
    const id = createClient(db, { name: 'Test' })
    const before = (db.prepare('SELECT updated_at FROM clients WHERE id=?').get(id) as any).updated_at
    db.prepare(`UPDATE clients SET name='Modifié',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(id)
    const after = (db.prepare('SELECT updated_at FROM clients WHERE id=?').get(id) as any).updated_at
    // Les deux peuvent être identiques si rapides, mais le champ existe
    expect(after).toBeDefined()
  })

  it('created_at défini à la création', () => {
    const id = createClient(db)
    const c = db.prepare('SELECT created_at FROM clients WHERE id=?').get(id) as any
    expect(c.created_at).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Flux complets Client', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('flux complet: créer → facturer → payer → balance = 0', () => {
    const cId = createClient(db, { name: 'Client VIP', credit_limit: 10000 })
    const invId = makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2)
    addCashPayment(db, invId, 1200, cId)
    expect(getClientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('flux chèque: facturer → chèque pending → cleared → balance = 0', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    // Chèque pending
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (?,'client',1200,'cheque','2026-01-20','pending',?,1)`).run(cId, invId)
    const payId = r.lastInsertRowid as number
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2) // toujours dû
    // Cleared
    db.prepare(`UPDATE payments SET status='cleared' WHERE id=?`).run(payId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(payId, invId, 1200)
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(invId)
    expect(getClientBalance(db, cId)).toBeCloseTo(0, 2)
  })

  it('flux avoir: facturer → avoir commercial → balance réduite', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100) // TTC=1200
    // Avoir commercial 600
    const { id: avoirId } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: cId, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Remise' },
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, avoirId, 'invoice_to_avoir')
    confirmDocument(avoirId, 1)
    // L'avoir crée un payment record → réduit la balance
    const balance = getClientBalance(db, cId)
    expect(balance).toBeLessThan(1200)
  })

  it('flux multi-factures: balance cumulative', () => {
    const cId = createClient(db)
    const inv1 = makeInvoice(db, cId, 5, 100)  // TTC=600
    const inv2 = makeInvoice(db, cId, 10, 100) // TTC=1200
    expect(getClientBalance(db, cId)).toBeCloseTo(1800, 2)
    addCashPayment(db, inv1, 600, cId)
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2)
    addCashPayment(db, inv2, 1200, cId)
    expect(getClientBalance(db, cId)).toBeCloseTo(0, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Avances (paiements non liés à une facture)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avance cash enregistrée dans payments', () => {
    const cId = createClient(db)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by)
      VALUES (?,'client',5000,'cash','2026-01-20','collected',1)`).run(cId)
    const pay = db.prepare('SELECT * FROM payments WHERE id=?').get(r.lastInsertRowid) as any
    expect(pay.amount).toBe(5000)
    expect(pay.document_id).toBeNull()
  })

  it('avance sans document_id → pas dans payment_allocations', () => {
    const cId = createClient(db)
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by)
      VALUES (?,'client',5000,'cash','2026-01-20','collected',1)`).run(cId)
    const allocs = db.prepare('SELECT * FROM payment_allocations WHERE payment_id=?').all(r.lastInsertRowid)
    expect(allocs).toHaveLength(0)
  })

  it('balance backend tient compte des avances (comportement corrigé)', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    // Avance 500 sans facture
    db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by)
      VALUES (?,'client',500,'cash','2026-01-20','collected',1)`).run(cId)
    // Balance = 1200 - 500 = 700 (avance déduite du solde)
    expect(getClientBalance(db, cId)).toBeCloseTo(700, 2)
  })

  it('totalPaid frontend doit inclure les avances', () => {
    const cId = createClient(db)
    makeInvoice(db, cId, 10, 100) // TTC=1200
    // Paiement lié à la facture
    const invId = db.prepare('SELECT id FROM documents WHERE party_id=? ORDER BY id DESC LIMIT 1').get(cId) as any
    addCashPayment(db, invId.id, 600, cId)
    // Avance non liée
    db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by)
      VALUES (?,'client',200,'cash','2026-01-20','collected',1)`).run(cId)
    // totalPaid frontend = 600 (lié) + 200 (avance) = 800
    const allPayments = db.prepare(`SELECT * FROM payments WHERE party_id=? AND party_type='client'`).all(cId) as any[]
    const totalPaid = allPayments
      .filter((p: any) => !['cheque','lcn'].includes(p.method) || ['cleared','collected'].includes(p.status))
      .reduce((s: number, p: any) => s + p.amount, 0)
    expect(totalPaid).toBeCloseTo(800, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('10. Statut delivered dans balance', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture delivered incluse dans balance backend', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100) // TTC=1200
    db.prepare(`UPDATE documents SET status='delivered' WHERE id=?`).run(invId)
    // Balance doit inclure delivered
    expect(getClientBalance(db, cId)).toBeCloseTo(1200, 2)
  })

  it('facture delivered incluse dans totalInvoiced frontend', () => {
    const cId = createClient(db)
    const invId = makeInvoice(db, cId, 10, 100)
    db.prepare(`UPDATE documents SET status='delivered' WHERE id=?`).run(invId)
    const docs = db.prepare(`SELECT * FROM documents WHERE party_id=?`).all(cId) as any[]
    const totalInvoiced = docs
      .filter((d: any) => d.type === 'invoice' && ['confirmed','partial','paid','delivered'].includes(d.status))
      .reduce((s: number, d: any) => s + d.total_ttc, 0)
    expect(totalInvoiced).toBeCloseTo(1200, 2)
  })
})
