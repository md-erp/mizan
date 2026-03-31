import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { logAudit, getAuditLog } from '../audit.service'

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_004_settings(db)

  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'hash', 'admin')`).run()
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (2, 'Vendeur', 'vendeur@test.ma', 'hash', 'sales')`).run()

  return db
}

describe('Audit Service', () => {

  describe('logAudit', () => {
    it('enregistre une entree d audit simple', () => {
      const db = createTestDb()
      logAudit(db, {
        user_id: 1,
        action: 'CREATE',
        table_name: 'documents',
        record_id: 42,
      })
      const row = db.prepare('SELECT * FROM audit_log WHERE record_id = 42').get() as any
      expect(row).toBeDefined()
      expect(row.action).toBe('CREATE')
      expect(row.table_name).toBe('documents')
    })

    it('enregistre old_values et new_values en JSON', () => {
      const db = createTestDb()
      logAudit(db, {
        user_id: 1,
        action: 'UPDATE',
        table_name: 'clients',
        record_id: 1,
        old_values: { name: 'Ancien Nom' },
        new_values: { name: 'Nouveau Nom' },
      })
      const row = db.prepare('SELECT * FROM audit_log WHERE table_name = ?').get('clients') as any
      expect(JSON.parse(row.old_values)).toEqual({ name: 'Ancien Nom' })
      expect(JSON.parse(row.new_values)).toEqual({ name: 'Nouveau Nom' })
    })

    it('ne bloque pas si la table audit_log est absente (silencieux)', () => {
      const db = new Database(':memory:')
      // Pas de migration => pas de table audit_log
      expect(() => logAudit(db, {
        user_id: 1, action: 'CREATE', table_name: 'test',
      })).not.toThrow()
    })

    it('enregistre toutes les actions supportees', () => {
      const db = createTestDb()
      const actions = ['CREATE', 'UPDATE', 'DELETE', 'CONFIRM', 'CANCEL', 'LOGIN', 'LOGOUT', 'PAYMENT', 'APPLY_STOCK'] as const
      for (const action of actions) {
        logAudit(db, { user_id: 1, action, table_name: 'test' })
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as any).c
      expect(count).toBe(actions.length)
    })
  })

  describe('getAuditLog', () => {
    function seedLogs(db: Database.Database) {
      logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'documents', record_id: 1 })
      logAudit(db, { user_id: 1, action: 'CONFIRM', table_name: 'documents', record_id: 1 })
      logAudit(db, { user_id: 2, action: 'CREATE', table_name: 'clients', record_id: 5 })
      logAudit(db, { user_id: 2, action: 'LOGIN', table_name: 'users', record_id: 2 })
    }

    it('retourne tous les logs sans filtre', () => {
      const db = createTestDb()
      seedLogs(db)
      const result = getAuditLog(db)
      expect(result.total).toBe(4)
      expect(result.rows).toHaveLength(4)
    })

    it('filtre par user_id', () => {
      const db = createTestDb()
      seedLogs(db)
      const result = getAuditLog(db, { user_id: 2 })
      expect(result.total).toBe(2)
      expect(result.rows.every(r => r.user_id === 2)).toBe(true)
    })

    it('filtre par action', () => {
      const db = createTestDb()
      seedLogs(db)
      const result = getAuditLog(db, { action: 'CREATE' })
      expect(result.total).toBe(2)
    })

    it('filtre par table_name', () => {
      const db = createTestDb()
      seedLogs(db)
      const result = getAuditLog(db, { table_name: 'documents' })
      expect(result.total).toBe(2)
    })

    it('inclut le nom de l utilisateur dans les resultats', () => {
      const db = createTestDb()
      logAudit(db, { user_id: 1, action: 'LOGIN', table_name: 'users' })
      const result = getAuditLog(db)
      expect(result.rows[0].user_name).toBe('Admin')
    })

    it('parse old_values et new_values depuis JSON', () => {
      const db = createTestDb()
      logAudit(db, {
        user_id: 1, action: 'UPDATE', table_name: 'products',
        old_values: { price: 100 }, new_values: { price: 120 },
      })
      const result = getAuditLog(db)
      expect(result.rows[0].old_values).toEqual({ price: 100 })
      expect(result.rows[0].new_values).toEqual({ price: 120 })
    })

    it('gere la pagination correctement', () => {
      const db = createTestDb()
      for (let i = 0; i < 15; i++) {
        logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'test', record_id: i })
      }
      const page1 = getAuditLog(db, { page: 1, limit: 10 })
      const page2 = getAuditLog(db, { page: 2, limit: 10 })

      expect(page1.rows).toHaveLength(10)
      expect(page2.rows).toHaveLength(5)
      expect(page1.total).toBe(15)
      expect(page1.page).toBe(1)
      expect(page2.page).toBe(2)
    })
  })
})
