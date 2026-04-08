/**
 * Integration Tests — سير العمل الكامل
 * يختبر التدفق الكامل من إنشاء المستند حتى الدفع والمحاسبة
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_003_production } from '../../database/migrations/003_production'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'
import { createStockMovement, applyMovement } from '../stock.service'
import { logAudit, getAuditLog } from '../audit.service'

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

function createFullDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_003_production(db)
  migration_004_settings(db)

  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'hash', 'admin')`).run()
  db.prepare(`INSERT INTO clients (id, name, credit_limit) VALUES (1, 'Client Atlas', 50000)`).run()
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (1, 'Fournisseur Maroc')`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id, sale_price)
    VALUES (1, 'ALU001', 'Aluminium Brut', 'kg', 'raw', 1000, 30, 5, 0)`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id, sale_price)
    VALUES (2, 'PRO001', 'Profile Aluminium', 'ml', 'finished', 0, 0, 5, 150)`).run()

  return db
}

describe('Integration Tests — Flux complets', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createFullDb()
    getSetDb()(db)
  })

  describe('Flux 1: Achat => Reception => Stock', () => {
    it('bon de commande => bon de reception => stock mis a jour', () => {
      // 1. Creer bon de commande
      const bc = createDocument({
        type: 'purchase_order', date: '2026-01-10',
        party_id: 1, party_type: 'supplier',
        lines: [{ product_id: 1, quantity: 500, unit_price: 32, tva_rate: 20 }],
        created_by: 1,
      })
      expect(bc.number).toMatch(/^BC-/)

      // 2. Creer bon de reception
      const br = createDocument({
        type: 'bl_reception', date: '2026-01-12',
        party_id: 1, party_type: 'supplier',
        lines: [{ product_id: 1, quantity: 500, unit_price: 32, tva_rate: 20 }],
        created_by: 1,
      })

      // 3. Confirmer la reception => cree mouvement stock en attente
      confirmDocument(br.id, 1)

      const movements = db.prepare(`SELECT * FROM stock_movements WHERE document_id = ? AND applied = 0`).all(br.id)
      expect(movements).toHaveLength(1)
      expect((movements[0] as any).type).toBe('in')
      expect((movements[0] as any).quantity).toBe(500)

      // 4. Appliquer le mouvement => stock mis a jour
      applyMovement(db, (movements[0] as any).id, 1)

      const product = db.prepare('SELECT * FROM products WHERE id = 1').get() as any
      // CMUP: (1000×30 + 500×32) / 1500 = 30.67
      expect(product.stock_quantity).toBe(1500)
      expect(product.cmup_price).toBeCloseTo(30.67, 1)
    })
  })

  describe('Flux 2: Vente => BL => Paiement', () => {
    it('devis => facture => BL => paiement complet', () => {
      // 1. Devis
      const devis = createDocument({
        type: 'quote', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 2, quantity: 100, unit_price: 150, tva_rate: 20 }],
        created_by: 1,
        extra: { validity_date: '2026-02-15', probability: 80 },
      })
      expect(devis.number).toMatch(/^D-/)

      // 2. Facture
      const facture = createDocument({
        type: 'invoice', date: '2026-01-20',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 2, quantity: 100, unit_price: 150, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(facture.id, 1)

      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(facture.id) as any
      expect(doc.status).toBe('confirmed')
      expect(doc.total_ttc).toBeCloseTo(18000, 2) // 100 × 150 × 1.2

      // 3. Verifier quid comptable
      const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id = ? AND source_type = 'invoice'`).get(facture.id) as any
      expect(entry).toBeDefined()

      // 4. Paiement partiel
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 9000, 'bank', '2026-01-25', 'pending', ${facture.id}, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (1, ${facture.id}, 9000)`).run()

      let paid = (db.prepare(`SELECT COALESCE(SUM(amount), 0) as t FROM payment_allocations WHERE document_id = ${facture.id}`).get() as any).t
      expect(paid).toBe(9000)

      // 5. Paiement final
      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (2, 1, 'client', 9000, 'cheque', '2026-02-01', 'pending', ${facture.id}, 1)`).run()
      db.prepare(`INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (2, ${facture.id}, 9000)`).run()

      paid = (db.prepare(`SELECT COALESCE(SUM(amount), 0) as t FROM payment_allocations WHERE document_id = ${facture.id}`).get() as any).t
      expect(paid).toBeCloseTo(18000, 2)
    })
  })

  describe('Flux 3: Audit trail complet', () => {
    it('toutes les operations sont tracees dans l audit log', () => {
      // Creer et confirmer une facture
      const facture = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 2, quantity: 10, unit_price: 150, tva_rate: 20 }],
        created_by: 1,
      })

      // Logger les actions manuellement (comme le ferait le handler IPC)
      logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'documents', record_id: facture.id,
        new_values: { type: 'invoice', number: facture.number } })

      confirmDocument(facture.id, 1)
      logAudit(db, { user_id: 1, action: 'CONFIRM', table_name: 'documents', record_id: facture.id })

      db.prepare(`INSERT INTO payments (id, party_id, party_type, amount, method, date, status, document_id, created_by)
        VALUES (1, 1, 'client', 1800, 'bank', '2026-01-20', 'pending', ${facture.id}, 1)`).run()
      logAudit(db, { user_id: 1, action: 'PAYMENT', table_name: 'payments', record_id: 1,
        new_values: { amount: 1800, method: 'bank' } })

      const auditResult = getAuditLog(db, { table_name: 'documents' })
      expect(auditResult.total).toBe(2)

      const allLogs = getAuditLog(db)
      expect(allLogs.total).toBe(3)
    })
  })

  describe('Flux 4: Avoir apres facture', () => {
    it('avoir commercial annule partiellement la facture', () => {
      // Facture originale
      const facture = createDocument({
        type: 'invoice', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 2, quantity: 50, unit_price: 150, tva_rate: 20 }],
        created_by: 1,
      })
      confirmDocument(facture.id, 1)

      // Avoir pour 10 unites
      const avoir = createDocument({
        type: 'avoir', date: '2026-01-20',
        party_id: 1, party_type: 'client',
        lines: [{ product_id: 2, quantity: 10, unit_price: 150, tva_rate: 20 }],
        created_by: 1,
        extra: { avoir_type: 'commercial', affects_stock: false },
      })
      confirmDocument(avoir.id, 1)

      // Verifier le quid de l'avoir: Debit 7111, Debit 4455, Credit 3421
      const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_id = ? AND source_type = 'avoir'`).get(avoir.id) as any
      expect(entry).toBeDefined()

      const lines = db.prepare(`
        SELECT jl.*, a.code FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
      `).all(entry.id) as any[]

      const totalDebit  = lines.reduce((s: number, l: any) => s + l.debit, 0)
      const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0)
      expect(totalDebit).toBeCloseTo(totalCredit, 2)
    })
  })

  describe('Flux 5: Coherence des sequences de numerotation', () => {
    it('les numeros sont uniques et sequentiels meme avec plusieurs types', () => {
      const year = new Date().getFullYear() % 100
      const docs = []

      for (let i = 0; i < 3; i++) {
        docs.push(createDocument({
          type: 'invoice', date: '2026-01-15',
          party_id: 1, party_type: 'client',
          lines: [{ quantity: 1, unit_price: 100, tva_rate: 20 }],
          created_by: 1,
        }))
      }

      expect(docs[0].number).toBe(`F-${year}-1`)
      expect(docs[1].number).toBe(`F-${year}-2`)
      expect(docs[2].number).toBe(`F-${year}-3`)

      // Les devis ont leur propre sequence
      const devis = createDocument({
        type: 'quote', date: '2026-01-15',
        party_id: 1, party_type: 'client',
        lines: [{ quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })
      expect(devis.number).toBe(`D-${year}-1`)
    })
  })
})
