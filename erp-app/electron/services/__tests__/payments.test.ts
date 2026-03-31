import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'

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

  // Facture client 1200 MAD
  db.prepare(`INSERT INTO documents (id, type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc)
    VALUES (1, 'invoice', 'F-2026-0001', '2026-01-15', 1, 'client', 'confirmed', 1000, 200, 1200)`).run()
  db.prepare(`INSERT INTO doc_invoices (document_id, payment_status) VALUES (1, 'unpaid')`).run()

  // Facture client 600 MAD
  db.prepare(`INSERT INTO documents (id, type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc)
    VALUES (2, 'invoice', 'F-2026-0002', '2026-01-16', 1, 'client', 'confirmed', 500, 100, 600)`).run()
  db.prepare(`INSERT INTO doc_invoices (document_id, payment_status) VALUES (2, 'unpaid')`).run()

  // Facture fournisseur 800 MAD
  db.prepare(`INSERT INTO documents (id, type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc)
    VALUES (3, 'purchase_invoice', 'FF-2026-0001', '2026-01-17', 1, 'supplier', 'confirmed', 666.67, 133.33, 800)`).run()

  return db
}

// Helper: calcule le statut de paiement
function computePaymentStatus(paid: number, total: number): string {
  if (paid >= total - 0.01) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

describe('Payments Logic', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  describe('Statuts de paiement', () => {
    it('statut partial apres paiement partiel', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 600, 'cash', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 600)`).run()

      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(computePaymentStatus(paid, doc.total_ttc)).toBe('partial')
    })

    it('statut paid apres paiement complet', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 1200, 'bank', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 1200)`).run()

      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(computePaymentStatus(paid, doc.total_ttc)).toBe('paid')
    })

    it('statut unpaid sans aucun paiement', () => {
      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(computePaymentStatus(paid, doc.total_ttc)).toBe('unpaid')
    })

    it('tolerance de 1 centime: 1199.99 sur 1200 = paid', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 1199.99, 'bank', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 1199.99)`).run()

      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(computePaymentStatus(paid, doc.total_ttc)).toBe('paid')
    })

    it('paiement en deux tranches => paid', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 700, 'cash', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 700)`).run()

      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (2, 1, 'client', 500, 'bank', '2026-01-25', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (2, 1, 500)`).run()

      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(paid).toBeCloseTo(1200, 2)
      expect(computePaymentStatus(paid, doc.total_ttc)).toBe('paid')
    })
  })

  describe('Isolation des paiements', () => {
    it('paiement sur facture 1 ne touche pas la facture 2', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 1200, 'bank', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 1200)`).run()

      const paid2 = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 2').get() as any).total
      expect(paid2).toBe(0)
    })

    it('allocation multi-factures depuis un seul paiement', () => {
      // Paiement de 1800 MAD couvrant les deux factures
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, created_by)
        VALUES (1, 1, 'client', 1800, 'bank', '2026-01-20', 'pending', 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 1200)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 2, 600)`).run()

      const paid1 = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const paid2 = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 2').get() as any).total
      expect(paid1).toBeCloseTo(1200, 2)
      expect(paid2).toBeCloseTo(600, 2)
    })
  })

  describe('Methodes de paiement', () => {
    it('accepte les methodes: cash, bank, cheque, lcn', () => {
      const methods = ['cash', 'bank', 'cheque', 'lcn']
      methods.forEach((method, i) => {
        db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
          VALUES (${i + 1}, 1, 'client', 100, '${method}', '2026-01-20', 'pending', 1, 1)`).run()
      })
      const count = (db.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c
      expect(count).toBe(4)
    })
  })

  describe('Integrite des donnees', () => {
    it('le montant total des allocations ne depasse pas le total de la facture', () => {
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 1200, 'bank', '2026-01-20', 'pending', 1, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, 1, 1200)`).run()

      const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = 1').get() as any).total
      const doc  = db.prepare('SELECT total_ttc FROM documents WHERE id = 1').get() as any
      expect(paid).toBeLessThanOrEqual(doc.total_ttc + 0.01)
    })

    it('les allocations referent a des paiements existants (FK)', () => {
      expect(() => {
        db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (999, 1, 100)`).run()
      }).toThrow()
    })
  })
})
