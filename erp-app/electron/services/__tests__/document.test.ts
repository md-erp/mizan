import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, generateDocumentNumber, confirmDocument } from '../document.service'

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
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (1, 'Fournisseur Test')`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id, sale_price)
    VALUES (1, 'P001', 'Produit A', 'unite', 'finished', 100, 50, 5, 120)`).run()

  return db
}

describe('Document Service', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  describe('generateDocumentNumber', () => {
    it('genere un numero sequentiel correct', () => {
      const year = new Date().getFullYear() % 100
      const n1 = generateDocumentNumber('invoice')
      const n2 = generateDocumentNumber('invoice')
      expect(n1).toBe(`F-${year}-1`)
      expect(n2).toBe(`F-${year}-2`)
    })

    it('genere des prefixes differents par type', () => {
      expect(generateDocumentNumber('invoice')).toMatch(/^F-/)
      expect(generateDocumentNumber('quote')).toMatch(/^D-/)
      expect(generateDocumentNumber('bl')).toMatch(/^BL-/)
      expect(generateDocumentNumber('avoir')).toMatch(/^AV-/)
      expect(generateDocumentNumber('purchase_order')).toMatch(/^BC-/)
      expect(generateDocumentNumber('bl_reception')).toMatch(/^BR-/)
      expect(generateDocumentNumber('purchase_invoice')).toMatch(/^FF-/)
      expect(generateDocumentNumber('import_invoice')).toMatch(/^IMP-/)
    })

    it('sequences independantes par type', () => {
      const year = new Date().getFullYear() % 100
      generateDocumentNumber('invoice')
      generateDocumentNumber('invoice')
      const quote1 = generateDocumentNumber('quote')
      expect(quote1).toBe(`D-${year}-1`)
    })

    it('utilise le prefixe DOC pour un type inconnu', () => {
      const num = generateDocumentNumber('unknown_type')
      expect(num).toMatch(/^DOC-/)
    })
  })

  describe('createDocument - Calculs', () => {
    it('calcule correctement HT, TVA, TTC', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.id) as any
      expect(doc.total_ht).toBeCloseTo(1000, 2)
      expect(doc.total_tva).toBeCloseTo(200, 2)
      expect(doc.total_ttc).toBeCloseTo(1200, 2)
    })

    it('applique la remise correctement', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 10, unit_price: 100, discount: 10, tva_rate: 20 }],
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.id) as any
      expect(doc.total_ht).toBeCloseTo(900, 2)
      expect(doc.total_tva).toBeCloseTo(180, 2)
      expect(doc.total_ttc).toBeCloseTo(1080, 2)
    })

    it('calcule correctement avec plusieurs lignes et TVA differentes', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [
          { product_id: 1, quantity: 5, unit_price: 200, tva_rate: 20 },
          { description: 'Service', quantity: 1, unit_price: 300, tva_rate: 14 },
        ],
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.id) as any
      expect(doc.total_ht).toBeCloseTo(1300, 2)
      expect(doc.total_tva).toBeCloseTo(242, 2)
      expect(doc.total_ttc).toBeCloseTo(1542, 2)
    })

    it('TVA par defaut = 20% si non specifiee', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 100 }],
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.id) as any
      expect(doc.total_tva).toBeCloseTo(20, 2)
    })
  })

  describe('createDocument - Statut et structure', () => {
    it('cree le document en statut draft', () => {
      const result = createDocument({
        type: 'quote', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 500, tva_rate: 20 }],
        created_by: 1,
      })
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.id) as any
      expect(doc.status).toBe('draft')
    })

    it('insere les lignes correctement', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [
          { product_id: 1, quantity: 5, unit_price: 200, tva_rate: 20 },
          { description: 'Service', quantity: 1, unit_price: 300, tva_rate: 0 },
        ],
        created_by: 1,
      })
      const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(result.id)
      expect(lines).toHaveLength(2)
    })

    it('cree la sous-table doc_invoices pour une facture', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      const sub = db.prepare('SELECT * FROM doc_invoices WHERE document_id = ?').get(result.id) as any
      expect(sub).toBeDefined()
      expect(sub.payment_status).toBe('unpaid')
    })

    it('cree la sous-table doc_quotes pour un devis', () => {
      const result = createDocument({
        type: 'quote', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
        extra: { validity_date: '2026-02-15', probability: 70 },
      })
      const sub = db.prepare('SELECT * FROM doc_quotes WHERE document_id = ?').get(result.id) as any
      expect(sub).toBeDefined()
      expect(sub.probability).toBe(70)
    })

    it('retourne l id et le numero du document cree', () => {
      const result = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      expect(result.id).toBeGreaterThan(0)
      expect(result.number).toMatch(/^F-\d{2}-\d+$/)
    })
  })

  describe('confirmDocument', () => {
    it('passe le statut a confirmed', () => {
      const { id } = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(id, 1)
      const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(id) as any
      expect(doc.status).toBe('confirmed')
    })

    it('refuse de confirmer un document deja confirme', () => {
      const { id } = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(id, 1)
      expect(() => confirmDocument(id, 1)).toThrow('confirm')
    })

    it('lance une erreur si document introuvable', () => {
      expect(() => confirmDocument(9999, 1)).toThrow('introuvable')
    })

    it('cree un quid comptable automatique a la confirmation', () => {
      const { id } = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(id, 1)
      const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type = 'invoice' AND source_id = ?`).get(id) as any
      expect(entry).toBeDefined()
      expect(entry.is_auto).toBe(1)
    })

    it('cree des mouvements de stock en attente pour un BL', () => {
      const { id } = createDocument({
        type: 'bl', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(id, 1)
      const movements = db.prepare(`SELECT * FROM stock_movements WHERE document_id = ? AND applied = 0`).all(id)
      expect(movements).toHaveLength(1)
      expect((movements[0] as any).type).toBe('out')
      expect((movements[0] as any).quantity).toBe(5)
    })

    it('cree des mouvements de stock en attente pour un bon de reception', () => {
      const { id } = createDocument({
        type: 'bl_reception', date: '2026-01-15',
        party_id: 1, party_type: 'supplier',
        lines: [{ product_id: 1, quantity: 20, unit_price: 50, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(id, 1)
      const movements = db.prepare(`SELECT * FROM stock_movements WHERE document_id = ? AND applied = 0`).all(id)
      expect(movements).toHaveLength(1)
      expect((movements[0] as any).type).toBe('in')
    })
  })
})
