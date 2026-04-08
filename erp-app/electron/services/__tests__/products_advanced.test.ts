/**
 * Tests Complets Avances -- Produits & Stock
 * Couvre: CRUD avance, CMUP edge cases, mouvements manuels,
 *         stats produit, integration documents, alertes stock,
 *         valeur stock, isolation produits
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createStockMovement, applyMovement } from '../stock.service'
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
  return db
}

function createProduct(db: Database.Database, opts: {
  code?: string; name?: string; type?: string; unit?: string
  stock?: number; cmup?: number; minStock?: number; salePrice?: number
} = {}) {
  const r = db.prepare(`INSERT INTO products (code,name,unit,type,stock_quantity,cmup_price,min_stock,sale_price,tva_rate_id,created_by)
    VALUES (?,?,?,?,?,?,?,?,5,1)`).run(
    opts.code ?? 'P001', opts.name ?? 'Produit Test',
    opts.unit ?? 'pcs', opts.type ?? 'finished',
    opts.stock ?? 0, opts.cmup ?? 0,
    opts.minStock ?? 0, opts.salePrice ?? 0
  )
  return r.lastInsertRowid as number
}

const getP = (db: Database.Database, id: number) =>
  db.prepare('SELECT * FROM products WHERE id=?').get(id) as any

function mov(db: Database.Database, productId: number, type: 'in'|'out', qty: number, cost = 0) {
  const id = createStockMovement(db, { product_id: productId, type, quantity: qty, unit_cost: cost, date: '2026-01-15', applied: false, created_by: 1 })
  applyMovement(db, id, 1)
  return id
}

// ─────────────────────────────────────────────────────────────────────────────
describe('1. CRUD Produits -- avance', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('code unique -- violation contrainte', () => {
    createProduct(db, { code: 'UNIQUE' })
    expect(() => createProduct(db, { code: 'UNIQUE' })).toThrow()
  })

  it('produit supprime reste en base (soft delete)', () => {
    const id = createProduct(db)
    db.prepare('UPDATE products SET is_deleted=1 WHERE id=?').run(id)
    expect(db.prepare('SELECT * FROM products WHERE id=?').get(id)).toBeDefined()
    expect(db.prepare('SELECT * FROM products WHERE id=? AND is_deleted=0').get(id)).toBeUndefined()
  })

  it('mise a jour sale_price', () => {
    const id = createProduct(db, { salePrice: 100 })
    db.prepare('UPDATE products SET sale_price=200 WHERE id=?').run(id)
    expect(getP(db, id).sale_price).toBe(200)
  })

  it('mise a jour min_stock', () => {
    const id = createProduct(db, { minStock: 10 })
    db.prepare('UPDATE products SET min_stock=50 WHERE id=?').run(id)
    expect(getP(db, id).min_stock).toBe(50)
  })

  it('recherche par code', () => {
    createProduct(db, { code: 'ALU001', name: 'Aluminium' })
    createProduct(db, { code: 'FER001', name: 'Fer' })
    const rows = db.prepare(`SELECT * FROM products WHERE is_deleted=0 AND (name LIKE ? OR code LIKE ?)`).all('%ALU%', '%ALU%')
    expect(rows).toHaveLength(1)
  })

  it('filtre par type', () => {
    createProduct(db, { code: 'R1', type: 'raw' })
    createProduct(db, { code: 'F1', type: 'finished' })
    createProduct(db, { code: 'S1', type: 'semi_finished' })
    expect(db.prepare(`SELECT * FROM products WHERE is_deleted=0 AND type='raw'`).all()).toHaveLength(1)
    expect(db.prepare(`SELECT * FROM products WHERE is_deleted=0 AND type='finished'`).all()).toHaveLength(1)
  })

  it('produit sans stock -- valeur = 0', () => {
    const id = createProduct(db, { stock: 0, cmup: 0 })
    const p = getP(db, id)
    expect(p.stock_quantity * p.cmup_price).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2. CMUP -- tous les cas', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('stock=0, premiere entree -> CMUP = cout unitaire', () => {
    const id = createProduct(db, { stock: 0, cmup: 0 })
    mov(db, id, 'in', 100, 50)
    expect(getP(db, id).cmup_price).toBeCloseTo(50, 2)
    expect(getP(db, id).stock_quantity).toBe(100)
  })

  it('entree sur stock existant -> CMUP pondere', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    // (100x50 + 50x80) / 150 = 60
    mov(db, id, 'in', 50, 80)
    expect(getP(db, id).cmup_price).toBeCloseTo(60, 2)
  })

  it('sortie -> CMUP inchange', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'out', 30)
    expect(getP(db, id).cmup_price).toBe(50)
    expect(getP(db, id).stock_quantity).toBe(70)
  })

  it('3 entrees successives -> CMUP cumule correct', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'in', 50, 80)   // CMUP = 60, stock = 150
    mov(db, id, 'in', 50, 90)   // (150x60 + 50x90) / 200 = 67.5
    expect(getP(db, id).cmup_price).toBeCloseTo(67.5, 2)
    expect(getP(db, id).stock_quantity).toBe(200)
  })

  it('entree a cout 0 -> CMUP diminue', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    // (100x50 + 100x0) / 200 = 25
    mov(db, id, 'in', 100, 0)
    expect(getP(db, id).cmup_price).toBeCloseTo(25, 2)
  })

  it('sortie puis entree -> CMUP recalcule correctement', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'out', 50)      // stock=50, cmup=50
    mov(db, id, 'in', 50, 70)   // (50x50 + 50x70) / 100 = 60
    expect(getP(db, id).cmup_price).toBeCloseTo(60, 2)
    expect(getP(db, id).stock_quantity).toBe(100)
  })

  it('cmup_before et cmup_after enregistres', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 100, unit_cost: 70, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    const m = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movId) as any
    expect(m.cmup_before).toBe(50)
    expect(m.cmup_after).toBeCloseTo(60, 2)
  })

  it('sortie exacte -> stock = 0, CMUP conserve', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'out', 100)
    expect(getP(db, id).stock_quantity).toBe(0)
    expect(getP(db, id).cmup_price).toBe(50)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3. Validation -- edge cases', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('sortie > stock -> erreur Stock insuffisant', () => {
    const id = createProduct(db, { stock: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 100, date: '2026-01-15', applied: false, created_by: 1 })
    expect(() => applyMovement(db, movId, 1)).toThrow('Stock insuffisant')
  })

  it('sortie sur stock=0 -> erreur', () => {
    const id = createProduct(db, { stock: 0 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 1, date: '2026-01-15', applied: false, created_by: 1 })
    expect(() => applyMovement(db, movId, 1)).toThrow('Stock insuffisant')
  })

  it('double application -> erreur', () => {
    const id = createProduct(db, { stock: 100 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 10, unit_cost: 50, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(() => applyMovement(db, movId, 1)).toThrow()
  })

  it('mouvement annule -> erreur a l\'application', () => {
    const id = createProduct(db, { stock: 100 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 10, date: '2026-01-15', applied: false, created_by: 1 })
    db.prepare('UPDATE stock_movements SET applied=-1 WHERE id=?').run(movId)
    expect(() => applyMovement(db, movId, 1)).toThrow()
  })

  it('produit inexistant -> erreur', () => {
    expect(() => createStockMovement(db, { product_id: 9999, type: 'in', quantity: 10, unit_cost: 50, date: '2026-01-15', applied: false, created_by: 1 })).toThrow('introuvable')
  })

  it('quantite fractionnaire -> acceptee', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'out', 0.5)
    expect(getP(db, id).stock_quantity).toBeCloseTo(99.5, 2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4. Alertes stock (min_stock)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('stock > min_stock -> pas d\'alerte', () => {
    const id = createProduct(db, { stock: 100, minStock: 50 })
    const p = getP(db, id)
    expect(p.stock_quantity > p.min_stock).toBe(true)
  })

  it('stock = min_stock -> alerte (is_low)', () => {
    const id = createProduct(db, { stock: 50, minStock: 50 })
    const p = getP(db, id)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })

  it('stock < min_stock -> alerte', () => {
    const id = createProduct(db, { stock: 10, minStock: 50 })
    const p = getP(db, id)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })

  it('stock = 0 -> critique', () => {
    const id = createProduct(db, { stock: 0 })
    expect(getP(db, id).stock_quantity <= 0).toBe(true)
  })

  it('min_stock = 0 -> jamais d\'alerte (pas de limite)', () => {
    const id = createProduct(db, { stock: 0, minStock: 0 })
    expect(getP(db, id).min_stock).toBe(0)
  })

  it('sortie ramene stock sous min_stock -> alerte', () => {
    const id = createProduct(db, { stock: 100, minStock: 50 })
    mov(db, id, 'out', 60)
    const p = getP(db, id)
    expect(p.stock_quantity).toBe(40)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })

  it('entree ramene stock au-dessus min_stock -> plus d\'alerte', () => {
    const id = createProduct(db, { stock: 10, minStock: 50 })
    mov(db, id, 'in', 50, 30)
    const p = getP(db, id)
    expect(p.stock_quantity > p.min_stock).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5. Valeur stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('valeur = stock_quantity x cmup_price', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const p = getP(db, id)
    expect(p.stock_quantity * p.cmup_price).toBe(5000)
  })

  it('valeur augmente apres entree', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'in', 100, 70)
    const p = getP(db, id)
    // stock=200, cmup=60 -> valeur=12000
    expect(p.stock_quantity * p.cmup_price).toBeCloseTo(12000, 2)
  })

  it('valeur diminue apres sortie (CMUP inchange)', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    mov(db, id, 'out', 40)
    const p = getP(db, id)
    // stock=60, cmup=50 -> valeur=3000
    expect(p.stock_quantity * p.cmup_price).toBeCloseTo(3000, 2)
  })

  it('valeur totale multi-produits', () => {
    const id1 = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const id2 = createProduct(db, { code: 'P2', stock: 200, cmup: 30 })
    const rows = db.prepare('SELECT stock_quantity, cmup_price FROM products WHERE is_deleted=0').all() as any[]
    const total = rows.reduce((s, p) => s + p.stock_quantity * p.cmup_price, 0)
    expect(total).toBeCloseTo(11000, 2) // 5000 + 6000
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('6. Stats produit', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  function getStats(db: Database.Database, productId: number) {
    const sales = db.prepare(`
      SELECT COALESCE(SUM(dl.quantity),0) as qty, COALESCE(SUM(dl.total_ttc),0) as revenue,
             COUNT(DISTINCT d.id) as doc_count
      FROM document_lines dl JOIN documents d ON d.id=dl.document_id
      WHERE dl.product_id=? AND d.type='invoice'
        AND d.status IN ('confirmed','partial','paid','delivered') AND d.is_deleted=0
    `).get(productId) as any
    const purchases = db.prepare(`
      SELECT COALESCE(SUM(dl.quantity),0) as qty, COALESCE(SUM(dl.total_ttc),0) as cost,
             COUNT(DISTINCT d.id) as doc_count
      FROM document_lines dl JOIN documents d ON d.id=dl.document_id
      WHERE dl.product_id=? AND d.type IN ('purchase_invoice','import_invoice','bl_reception')
        AND d.status IN ('confirmed','partial','paid') AND d.is_deleted=0
    `).get(productId) as any
    return { sales, purchases }
  }

  it('produit sans ventes -> qty=0, revenue=0', () => {
    const id = createProduct(db)
    const { sales } = getStats(db, id)
    expect(sales.qty).toBe(0)
    expect(sales.revenue).toBe(0)
    expect(sales.doc_count).toBe(0)
  })

  it('facture confirmee -> comptee dans les ventes', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 10, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)
    const { sales } = getStats(db, id)
    expect(sales.qty).toBe(10)
    expect(sales.doc_count).toBe(1)
  })

  it('facture delivered -> comptee dans les ventes', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)
    db.prepare(`UPDATE documents SET status='delivered' WHERE id=?`).run(invId)
    const { sales } = getStats(db, id)
    expect(sales.qty).toBe(5)
  })

  it('facture annulee -> exclue des ventes', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 10, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(invId)
    const { sales } = getStats(db, id)
    expect(sales.qty).toBe(0)
  })

  it('achat confirme -> compte dans les achats', () => {
    const id = createProduct(db, { code: 'P1', stock: 0, cmup: 0 })
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: id, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1)
    const { purchases } = getStats(db, id)
    expect(purchases.qty).toBe(50)
    expect(purchases.doc_count).toBe(1)
  })

  it('isolation: stats produit 1 != produit 2', () => {
    const id1 = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const id2 = createProduct(db, { code: 'P2', stock: 100, cmup: 30 })
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id1, quantity: 10, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)
    const { sales: s2 } = getStats(db, id2)
    expect(s2.qty).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('7. Integration documents -- stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL confirme -> mouvement sortant en attente', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 20, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(blId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(blId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('out')
    expect(movs[0].quantity).toBe(20)
  })

  it('BR confirme -> mouvement entrant en attente', () => {
    const id = createProduct(db, { code: 'P1', stock: 0, cmup: 0 })
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: id, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
  })

  it('BL -> appliquer -> stock diminue + CMUP inchange', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 30, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(blId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(blId) as any[]
    applyMovement(db, movs[0].id, 1)
    expect(getP(db, id).stock_quantity).toBe(70)
    expect(getP(db, id).cmup_price).toBe(50)
  })

  it('BR -> appliquer -> stock augmente + CMUP recalcule', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: id, quantity: 100, unit_price: 70, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)
    // (100x50 + 100x70) / 200 = 60
    expect(getP(db, id).stock_quantity).toBe(200)
    expect(getP(db, id).cmup_price).toBeCloseTo(60, 2)
  })

  it('BL stock insuffisant -> erreur a la confirmation', () => {
    const id = createProduct(db, { code: 'P1', stock: 10, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 50, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    expect(() => confirmDocument(blId, 1)).toThrow('Stock insuffisant')
  })

  it('annulation BL -> mouvements annules (applied=-1)', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 20, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(blId, 1)
    // Annuler le BL
    db.prepare(`UPDATE stock_movements SET applied=-1 WHERE document_id=? AND applied=0`).run(blId)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(blId)
    const pending = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(blId)
    expect(pending).toHaveLength(0)
  })

  it('avoir retour -> mouvement entrant en attente', () => {
    const id = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 10, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)
    const { id: avoirId } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: id, quantity: 5, unit_price: 120, tva_rate: 20 }],
      extra: { avoir_type: 'retour', affects_stock: true, reason: 'Retour' }, created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, avoirId, 'invoice_to_avoir')
    confirmDocument(avoirId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(avoirId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
  })
})
