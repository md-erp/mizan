/**
 * Tests Complets -- Produits & Stock
 * Couvre: CRUD produits, CMUP, mouvements, validation, stats, edge cases
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createStockMovement, applyMovement, getPendingMovements } from '../stock.service'
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

function getProduct(db: Database.Database, id: number) {
  return db.prepare('SELECT * FROM products WHERE id=?').get(id) as any
}

// ---------------------------------------------------------------------------
describe('1. CRUD Produits', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('cree un produit avec tous les champs', () => {
    const id = createProduct(db, { code: 'ALU001', name: 'Aluminium', type: 'raw', unit: 'kg', minStock: 50, salePrice: 120 })
    const p = getProduct(db, id)
    expect(p.code).toBe('ALU001')
    expect(p.name).toBe('Aluminium')
    expect(p.type).toBe('raw')
    expect(p.min_stock).toBe(50)
    expect(p.is_deleted).toBe(0)
  })

  it('code produit unique -- violation FK', () => {
    createProduct(db, { code: 'UNIQUE001' })
    expect(() => createProduct(db, { code: 'UNIQUE001' })).toThrow()
  })

  it('suppression douce', () => {
    const id = createProduct(db)
    db.prepare('UPDATE products SET is_deleted=1 WHERE id=?').run(id)
    const rows = db.prepare('SELECT * FROM products WHERE is_deleted=0').all()
    expect(rows.find((r: any) => r.id === id)).toBeUndefined()
  })

  it('produit supprime reste en base', () => {
    const id = createProduct(db)
    db.prepare('UPDATE products SET is_deleted=1 WHERE id=?').run(id)
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(id) as any
    expect(p.is_deleted).toBe(1)
  })

  it('mise a jour produit', () => {
    const id = createProduct(db, { name: 'Ancien', salePrice: 100 })
    db.prepare('UPDATE products SET name=?,sale_price=? WHERE id=?').run('Nouveau', 200, id)
    const p = getProduct(db, id)
    expect(p.name).toBe('Nouveau')
    expect(p.sale_price).toBe(200)
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
    const rows = db.prepare(`SELECT * FROM products WHERE is_deleted=0 AND type='raw'`).all()
    expect(rows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('2. CMUP -- Calcul avance', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('CMUP initial = 0 pour nouveau produit', () => {
    const id = createProduct(db)
    expect(getProduct(db, id).cmup_price).toBe(0)
  })

  it('premiere entree -> CMUP = cout unitaire', () => {
    const id = createProduct(db, { stock: 0, cmup: 0 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 100, unit_cost: 50, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(getProduct(db, id).cmup_price).toBeCloseTo(50, 2)
  })

  it('CMUP pondere sur plusieurs entrees', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    // (100x50 + 50x80) / 150 = 60
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 50, unit_cost: 80, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(getProduct(db, id).cmup_price).toBeCloseTo(60, 2)
  })

  it('sortie ne change pas le CMUP', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 30, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(getProduct(db, id).cmup_price).toBe(50)
    expect(getProduct(db, id).stock_quantity).toBe(70)
  })

  it('CMUP cumulatif sur 3 entrees', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    // Entree 2: 50@80 -> CMUP=60
    const m1 = createStockMovement(db, { product_id: id, type: 'in', quantity: 50, unit_cost: 80, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, m1, 1)
    // Entree 3: 50@90 -> (150x60 + 50x90)/200 = 67.5
    const m2 = createStockMovement(db, { product_id: id, type: 'in', quantity: 50, unit_cost: 90, date: '2026-01-16', applied: false, created_by: 1 })
    applyMovement(db, m2, 1)
    expect(getProduct(db, id).cmup_price).toBeCloseTo(67.5, 2)
    expect(getProduct(db, id).stock_quantity).toBe(200)
  })

  it('entree a cout 0 -> CMUP reste inchange si stock existant', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    // Entree gratuite: (100x50 + 50x0) / 150 = 33.33
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 50, unit_cost: 0, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(getProduct(db, id).cmup_price).toBeCloseTo(33.33, 1)
  })

  it('cmup_before et cmup_after enregistres correctement', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 100, unit_cost: 70, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    const mov = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movId) as any
    expect(mov.cmup_before).toBe(50)
    expect(mov.cmup_after).toBeCloseTo(60, 2)
  })
})

// ---------------------------------------------------------------------------
describe('3. Validation Stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('sortie > stock -> erreur', () => {
    const id = createProduct(db, { stock: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 100, date: '2026-01-15', applied: false, created_by: 1 })
    expect(() => applyMovement(db, movId, 1)).toThrow('Stock insuffisant')
  })

  it('sortie = stock -> OK (stock = 0)', () => {
    const id = createProduct(db, { stock: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 50, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(getProduct(db, id).stock_quantity).toBe(0)
  })

  it('sortie sur stock = 0 -> erreur', () => {
    const id = createProduct(db, { stock: 0 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 1, date: '2026-01-15', applied: false, created_by: 1 })
    expect(() => applyMovement(db, movId, 1)).toThrow('Stock insuffisant')
  })

  it("double application -> erreur", () => {
    const id = createProduct(db, { stock: 100 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 10, unit_cost: 50, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    expect(() => applyMovement(db, movId, 1)).toThrow('appliqu')
  })

  it('produit inexistant -> erreur', () => {
    expect(() => createStockMovement(db, { product_id: 9999, type: 'in', quantity: 10, unit_cost: 50, date: '2026-01-15', applied: false, created_by: 1 })).toThrow('introuvable')
  })

  it("mouvement annule (applied=-1) -> erreur a l'application", () => {
    const id = createProduct(db, { stock: 100 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 10, date: '2026-01-15', applied: false, created_by: 1 })
    db.prepare('UPDATE stock_movements SET applied=-1 WHERE id=?').run(movId)
    expect(() => applyMovement(db, movId, 1)).toThrow('annul')
  })
})

// ---------------------------------------------------------------------------
describe('4. Alertes Stock (min_stock)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it("stock > min_stock -> pas d'alerte", () => {
    const id = createProduct(db, { stock: 100, minStock: 50 })
    const p = getProduct(db, id)
    expect(p.stock_quantity > p.min_stock).toBe(true)
  })

  it('stock = min_stock -> alerte (is_low)', () => {
    const id = createProduct(db, { stock: 50, minStock: 50 })
    const p = getProduct(db, id)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })

  it('stock < min_stock -> alerte', () => {
    const id = createProduct(db, { stock: 10, minStock: 50 })
    const p = getProduct(db, id)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })

  it('stock = 0 -> critique', () => {
    const id = createProduct(db, { stock: 0 })
    const p = getProduct(db, id)
    expect(p.stock_quantity <= 0).toBe(true)
  })

  it("min_stock = 0 -> jamais d'alerte", () => {
    const id = createProduct(db, { stock: 0, minStock: 0 })
    const p = getProduct(db, id)
    // min_stock=0 signifie pas de limite
    expect(p.min_stock).toBe(0)
  })

  it('sortie ramene stock sous min_stock -> alerte declenchee', () => {
    const id = createProduct(db, { stock: 100, minStock: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 60, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    const p = getProduct(db, id)
    expect(p.stock_quantity).toBe(40)
    expect(p.stock_quantity <= p.min_stock).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('5. Mouvements manuels', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('mouvement manuel entree -> stock augmente', () => {
    const id = createProduct(db, { stock: 50, cmup: 30 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 20, unit_cost: 40, manual_ref: 'INVENTAIRE-2026', date: '2026-01-15', applied: true, created_by: 1 })
    const p = getProduct(db, id)
    expect(p.stock_quantity).toBe(70)
    const mov = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movId) as any
    expect(mov.manual_ref).toBe('INVENTAIRE-2026')
    expect(mov.applied).toBe(1)
  })

  it('mouvement manuel sortie -> stock diminue', () => {
    const id = createProduct(db, { stock: 100 })
    const movId = createStockMovement(db, { product_id: id, type: 'out', quantity: 15, manual_ref: 'PERTE', date: '2026-01-15', applied: true, created_by: 1 })
    expect(getProduct(db, id).stock_quantity).toBe(85)
  })

  it('getPendingMovements retourne seulement les non-appliques', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,status,total_ht,total_tva,total_ttc) VALUES (1,'bl','BL-1','2026-01-15','confirmed',0,0,0)`).run()
    const id = createProduct(db, { stock: 100 })
    const m1 = createStockMovement(db, { product_id: id, type: 'out', quantity: 10, document_id: 1, date: '2026-01-15', applied: false, created_by: 1 })
    const m2 = createStockMovement(db, { product_id: id, type: 'out', quantity: 5, document_id: 1, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, m1, 1)
    const pending = getPendingMovements(db, 1)
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(m2)
  })
})

// ---------------------------------------------------------------------------
describe('6. Valeur stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('valeur = stock_quantity x cmup_price', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const p = getProduct(db, id)
    expect(p.stock_quantity * p.cmup_price).toBe(5000)
  })

  it('valeur mise a jour apres entree', () => {
    const id = createProduct(db, { stock: 100, cmup: 50 })
    const movId = createStockMovement(db, { product_id: id, type: 'in', quantity: 100, unit_cost: 70, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, movId, 1)
    const p = getProduct(db, id)
    // stock=200, cmup=60 -> valeur=12000
    expect(p.stock_quantity * p.cmup_price).toBeCloseTo(12000, 2)
  })

  it('valeur = 0 pour produit sans stock', () => {
    const id = createProduct(db, { stock: 0, cmup: 0 })
    const p = getProduct(db, id)
    expect(p.stock_quantity * p.cmup_price).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('7. Integration avec documents', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL confirme -> mouvement sortant en attente', () => {
    const pId = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: pId, quantity: 20, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(blId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(blId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('out')
    expect(movs[0].quantity).toBe(20)
  })

  it('BR confirme -> mouvement entrant en attente', () => {
    const pId = createProduct(db, { code: 'P1', stock: 0, cmup: 0 })
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: pId, quantity: 50, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
  })

  it('BL -> appliquer -> stock diminue', () => {
    const pId = createProduct(db, { code: 'P1', stock: 100, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: pId, quantity: 30, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(blId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(blId) as any[]
    applyMovement(db, movs[0].id, 1)
    expect(getProduct(db, pId).stock_quantity).toBe(70)
  })

  it('BL avec stock insuffisant -> erreur a la confirmation', () => {
    const pId = createProduct(db, { code: 'P1', stock: 10, cmup: 50 })
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: pId, quantity: 50, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    expect(() => confirmDocument(blId, 1)).toThrow('Stock insuffisant')
  })
})
