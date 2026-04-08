import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'

jest.mock('../../database/connection', () => {
  let _db: any = null
  return {
    getDb: () => _db,
    __setDb: (db: any) => { _db = db },
  }
})

function getSetDb() {
  return require('../../database/connection').__setDb
}

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_004_settings(db)

  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'hash', 'admin')`).run()
  db.prepare(`INSERT INTO clients (id, name) VALUES (1, 'Client Test')`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id, sale_price)
    VALUES (1, 'P001', 'Produit A', 'unite', 'finished', 100, 50, 5, 120)`).run()

  return db
}

// Helper: crée + confirme une facture et retourne son id
function createConfirmedInvoice(db: Database.Database, amount = 1000) {
  const { id } = createDocument({
    type: 'invoice', date: '2026-01-15',
    party_id: 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: 10, unit_price: amount / 10, tva_rate: 20 }],
    created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

// Helper: crée + confirme un avoir lié à une facture
function createConfirmedAvoir(
  db: Database.Database,
  invoiceId: number,
  avoirType: 'retour' | 'commercial' | 'annulation',
  amount = 600
) {
  const { id: avoirId } = createDocument({
    type: 'avoir', date: '2026-01-20',
    party_id: 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: 5, unit_price: amount / 5, tva_rate: 20 }],
    notes: 'Test avoir',
    extra: { avoir_type: avoirType, affects_stock: avoirType === 'retour', reason: 'Test' },
    created_by: 1,
  })
  // lier l'avoir à la facture
  db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(
    invoiceId, avoirId, 'invoice_to_avoir'
  )
  confirmDocument(avoirId, 1)
  return avoirId
}

describe('Avoir — document.service', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  // ─── Création ────────────────────────────────────────────────────────────

  describe('Création', () => {
    it('crée un avoir en statut draft avec sous-table doc_avoirs', () => {
      const { id } = createDocument({
        type: 'avoir', date: '2026-01-20',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
        extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Remise' },
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
      const sub = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(id) as any

      expect(doc.status).toBe('draft')
      expect(doc.type).toBe('avoir')
      expect(sub).toBeDefined()
      expect(sub.avoir_type).toBe('commercial')
      expect(sub.affects_stock).toBe(0)
    })

    it('calcule correctement les totaux HT/TVA/TTC', () => {
      const { id } = createDocument({
        type: 'avoir', date: '2026-01-20',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
        extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Test' },
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
      expect(doc.total_ht).toBeCloseTo(500, 2)
      expect(doc.total_tva).toBeCloseTo(100, 2)
      expect(doc.total_ttc).toBeCloseTo(600, 2)
    })
  })

  // ─── Avoir Commercial ────────────────────────────────────────────────────

  describe('Avoir commercial', () => {
    it('génère un quid comptable (débit Ventes, crédit Clients)', () => {
      const invoiceId = createConfirmedInvoice(db)
      const avoirId = createConfirmedAvoir(db, invoiceId, 'commercial')

      const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type = 'avoir' AND source_id = ?`).get(avoirId) as any
      expect(entry).toBeDefined()
      expect(entry.is_auto).toBe(1)

      const lines = db.prepare('SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ?').all(entry.id) as any[]
      const debitVentes  = lines.find(l => l.code === '7111' && l.debit > 0)
      const creditClient = lines.find(l => l.code === '3421' && l.credit > 0)
      expect(debitVentes).toBeDefined()
      expect(creditClient).toBeDefined()
    })

    it('impute l\'avoir sur la facture source (réduit le solde dû)', () => {
      const invoiceId = createConfirmedInvoice(db, 1000) // TTC = 1200
      createConfirmedAvoir(db, invoiceId, 'commercial', 500) // TTC = 600

      const alloc = db.prepare('SELECT SUM(amount) as total FROM payment_allocations WHERE document_id = ?').get(invoiceId) as any
      expect(alloc.total).toBeCloseTo(600, 2)
    })

    it('passe la facture en partial si avoir partiel', () => {
      const invoiceId = createConfirmedInvoice(db, 1000) // TTC = 1200
      createConfirmedAvoir(db, invoiceId, 'commercial', 500) // TTC = 600 < 1200

      const inv = db.prepare('SELECT status FROM documents WHERE id = ?').get(invoiceId) as any
      expect(inv.status).toBe('partial')
    })

    it('passe la facture en paid si avoir couvre le total', () => {
      const invoiceId = createConfirmedInvoice(db, 1000) // TTC = 1200
      // avoir pour le montant exact (1000 HT × 1.2 = 1200 TTC)
      createConfirmedAvoir(db, invoiceId, 'commercial', 1000) // TTC = 1200

      const inv = db.prepare('SELECT status FROM documents WHERE id = ?').get(invoiceId) as any
      expect(inv.status).toBe('paid')
    })

    it('ne crée pas de mouvement de stock', () => {
      const invoiceId = createConfirmedInvoice(db)
      const avoirId = createConfirmedAvoir(db, invoiceId, 'commercial')

      const movements = db.prepare('SELECT * FROM stock_movements WHERE document_id = ?').all(avoirId)
      expect(movements).toHaveLength(0)
    })
  })

  // ─── Avoir Retour ────────────────────────────────────────────────────────

  describe('Avoir retour marchandise', () => {
    it('crée un mouvement de stock entrant (retour en stock)', () => {
      const invoiceId = createConfirmedInvoice(db)
      const avoirId = createConfirmedAvoir(db, invoiceId, 'retour')

      const movements = db.prepare('SELECT * FROM stock_movements WHERE document_id = ?').all(avoirId) as any[]
      expect(movements).toHaveLength(1)
      expect(movements[0].type).toBe('in')
      expect(movements[0].quantity).toBe(5)
      expect(movements[0].applied).toBe(0) // en attente
    })

    it('impute aussi sur la facture source', () => {
      const invoiceId = createConfirmedInvoice(db, 1000)
      createConfirmedAvoir(db, invoiceId, 'retour', 500)

      const alloc = db.prepare('SELECT SUM(amount) as total FROM payment_allocations WHERE document_id = ?').get(invoiceId) as any
      expect(alloc.total).toBeGreaterThan(0)
    })
  })

  // ─── Avoir Annulation ────────────────────────────────────────────────────

  describe('Avoir annulation facture', () => {
    it('marque la facture source comme annulée', () => {
      const invoiceId = createConfirmedInvoice(db)
      createConfirmedAvoir(db, invoiceId, 'annulation')

      const inv = db.prepare('SELECT status FROM documents WHERE id = ?').get(invoiceId) as any
      expect(inv.status).toBe('cancelled')
    })

    it('génère quand même un quid comptable', () => {
      const invoiceId = createConfirmedInvoice(db)
      const avoirId = createConfirmedAvoir(db, invoiceId, 'annulation')

      const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type = 'avoir' AND source_id = ?`).get(avoirId) as any
      expect(entry).toBeDefined()
    })

    it('ne crée pas de mouvement de stock', () => {
      const invoiceId = createConfirmedInvoice(db)
      const avoirId = createConfirmedAvoir(db, invoiceId, 'annulation')

      const movements = db.prepare('SELECT * FROM stock_movements WHERE document_id = ?').all(avoirId)
      expect(movements).toHaveLength(0)
    })
  })

  // ─── Avoir sans facture liée ─────────────────────────────────────────────

  describe('Avoir sans facture liée', () => {
    it('se confirme sans erreur', () => {
      const { id } = createDocument({
        type: 'avoir', date: '2026-01-20',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
        extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Sans facture' },
        created_by: 1,
      })
      expect(() => confirmDocument(id, 1)).not.toThrow()
      const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(id) as any
      expect(doc.status).toBe('confirmed')
    })
  })
})
