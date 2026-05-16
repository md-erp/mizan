import { describe, it, expect, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { createPaymentEntry } from '../accounting.service'

describe('LCN et Chèques - Conformité CGNC', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    migration_001_initial(db)
    migration_002_accounting(db)

    // Créer un utilisateur
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Admin', 'admin@test.com', 'hash', 'admin')
    `).run()

    // Créer une période comptable ouverte
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES ('2024', '2024-01-01', '2024-12-31', 2024, 'open')
    `).run()

    // Créer un client et un fournisseur
    db.prepare(`INSERT INTO clients (name, ice) VALUES ('Client Test', 'ICE123')`).run()
    db.prepare(`INSERT INTO suppliers (name, ice) VALUES ('Fournisseur Test', 'ICE456')`).run()
  })

  describe('🔹 LCN/Chèque Client (Effets à recevoir)', () => {
    it('devrait créer un transfert 3425 ← 3421 lors de la réception (pending)', () => {
      const paymentId = createPaymentEntry(db, {
        id: 1,
        party_id: 1,
        party_type: 'client',
        amount: 10000,
        method: 'lcn',
        date: '2024-06-15',
        reference: 'LCN-001',
        status: 'pending',
      }, 1)

      expect(paymentId).toBeGreaterThan(0)

      // Vérifier le journal
      const entry = db.prepare(`
        SELECT * FROM journal_entries WHERE id = ?
      `).get(paymentId) as any

      expect(entry).toBeDefined()
      expect(entry.description).toContain('Règlement client')

      // Vérifier les lignes
      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 3425 (Effets à recevoir)
      expect(lines[0].code).toBe('3425')
      expect(lines[0].debit).toBe(10000)
      expect(lines[0].credit).toBe(0)

      // Crédit 3421 (Clients)
      expect(lines[1].code).toBe('3421')
      expect(lines[1].debit).toBe(0)
      expect(lines[1].credit).toBe(10000)
    })

    it('devrait créer un transfert 5141 ← 3425 lors de l\'encaissement (cleared)', () => {
      const paymentId = createPaymentEntry(db, {
        id: 2,
        party_id: 1,
        party_type: 'client',
        amount: 10000,
        method: 'cheque',
        date: '2024-06-20',
        reference: 'CHQ-001',
        status: 'cleared',
      }, 1)

      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 5141 (Banque)
      expect(lines[0].code).toBe('5141')
      expect(lines[0].debit).toBe(10000)
      expect(lines[0].credit).toBe(0)

      // Crédit 3425 (Effets à recevoir)
      expect(lines[1].code).toBe('3425')
      expect(lines[1].debit).toBe(0)
      expect(lines[1].credit).toBe(10000)
    })
  })

  describe('🔹 LCN/Chèque Fournisseur (Effets à payer)', () => {
    it('devrait créer un transfert 4411 → 4415 lors de l\'émission (pending)', () => {
      const paymentId = createPaymentEntry(db, {
        id: 3,
        party_id: 1,
        party_type: 'supplier',
        amount: 15000,
        method: 'lcn',
        date: '2024-06-15',
        reference: 'LCN-F-001',
        status: 'pending',
      }, 1)

      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 4411 (Fournisseurs)
      expect(lines[0].code).toBe('4411')
      expect(lines[0].debit).toBe(15000)
      expect(lines[0].credit).toBe(0)

      // Crédit 4415 (Effets à payer)
      expect(lines[1].code).toBe('4415')
      expect(lines[1].debit).toBe(0)
      expect(lines[1].credit).toBe(15000)
    })

    it('devrait créer un transfert 4415 → 5141 lors de l\'échéance (cleared)', () => {
      const paymentId = createPaymentEntry(db, {
        id: 4,
        party_id: 1,
        party_type: 'supplier',
        amount: 15000,
        method: 'cheque',
        date: '2024-06-20',
        reference: 'CHQ-F-001',
        status: 'cleared',
      }, 1)

      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 4415 (Effets à payer)
      expect(lines[0].code).toBe('4415')
      expect(lines[0].debit).toBe(15000)
      expect(lines[0].credit).toBe(0)

      // Crédit 5141 (Banque)
      expect(lines[1].code).toBe('5141')
      expect(lines[1].debit).toBe(0)
      expect(lines[1].credit).toBe(15000)
    })
  })

  describe('🔹 Comparaison Cash/Bank (comportement inchangé)', () => {
    it('devrait utiliser 5141 ← 3421 pour paiement client cash', () => {
      const paymentId = createPaymentEntry(db, {
        id: 5,
        party_id: 1,
        party_type: 'client',
        amount: 5000,
        method: 'cash',
        date: '2024-06-15',
        reference: 'CASH-001',
      }, 1)

      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 5161 (Caisse)
      expect(lines[0].code).toBe('5161')
      expect(lines[0].debit).toBe(5000)

      // Crédit 3421 (Clients)
      expect(lines[1].code).toBe('3421')
      expect(lines[1].credit).toBe(5000)
    })

    it('devrait utiliser 4411 → 5141 pour paiement fournisseur bank', () => {
      const paymentId = createPaymentEntry(db, {
        id: 6,
        party_id: 1,
        party_type: 'supplier',
        amount: 8000,
        method: 'bank',
        date: '2024-06-15',
        reference: 'BANK-001',
      }, 1)

      const lines = db.prepare(`
        SELECT a.code, jl.debit, jl.credit
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
        ORDER BY jl.debit DESC
      `).all(paymentId) as any[]

      expect(lines).toHaveLength(2)

      // Débit 4411 (Fournisseurs)
      expect(lines[0].code).toBe('4411')
      expect(lines[0].debit).toBe(8000)

      // Crédit 5141 (Banque)
      expect(lines[1].code).toBe('5141')
      expect(lines[1].credit).toBe(8000)
    })
  })

  describe('🔹 Équilibre comptable', () => {
    it('devrait respecter la partie double pour tous les types', () => {
      const testCases = [
        { method: 'lcn', status: 'pending', party_type: 'client' },
        { method: 'cheque', status: 'cleared', party_type: 'client' },
        { method: 'lcn', status: 'pending', party_type: 'supplier' },
        { method: 'cheque', status: 'cleared', party_type: 'supplier' },
        { method: 'cash', party_type: 'client' },
        { method: 'bank', party_type: 'supplier' },
      ]

      testCases.forEach((testCase, idx) => {
        const paymentId = createPaymentEntry(db, {
          id: 100 + idx,
          party_id: 1,
          party_type: testCase.party_type as any,
          amount: 1000,
          method: testCase.method,
          date: '2024-06-15',
          reference: `TEST-${idx}`,
          status: testCase.status as any,
        }, 1)

        const balance = db.prepare(`
          SELECT 
            SUM(debit) as total_debit,
            SUM(credit) as total_credit
          FROM journal_lines
          WHERE entry_id = ?
        `).get(paymentId) as any

        expect(balance.total_debit).toBe(balance.total_credit)
        expect(balance.total_debit).toBe(1000)
      })
    })
  })
})
