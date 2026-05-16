/**
 * Tests — التحقق من الفترة المحاسبية عند بدء التطبيق
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'

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
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  return db
}

describe('Vérification de la période comptable', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('retourne un tableau vide si aucune période n\'existe', () => {
    const periods = db.prepare('SELECT * FROM accounting_periods').all()
    expect(periods).toHaveLength(0)
  })

  it('crée une période comptable pour l\'année en cours', () => {
    const currentYear = new Date().getFullYear()
    
    const result = db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear}`,
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      currentYear,
      'open',
      'Période créée automatiquement'
    )

    expect(result.lastInsertRowid).toBeDefined()

    const period = db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(result.lastInsertRowid) as any
    expect(period.name).toBe(`Exercice ${currentYear}`)
    expect(period.fiscal_year).toBe(currentYear)
    expect(period.status).toBe('open')
  })

  it('trouve une période ouverte pour l\'année en cours', () => {
    const currentYear = new Date().getFullYear()
    
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear}`,
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      currentYear,
      'open'
    )

    const openPeriod = db.prepare(`
      SELECT * FROM accounting_periods 
      WHERE fiscal_year = ? AND status = 'open'
    `).get(currentYear) as any

    expect(openPeriod).toBeDefined()
    expect(openPeriod.fiscal_year).toBe(currentYear)
    expect(openPeriod.status).toBe('open')
  })

  it('ne trouve pas de période si toutes sont fermées', () => {
    const currentYear = new Date().getFullYear()
    
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear}`,
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      currentYear,
      'closed'
    )

    const openPeriod = db.prepare(`
      SELECT * FROM accounting_periods 
      WHERE fiscal_year = ? AND status = 'open'
    `).get(currentYear) as any

    expect(openPeriod).toBeUndefined()
  })

  it('permet plusieurs périodes pour différentes années', () => {
    const currentYear = new Date().getFullYear()
    
    // Année précédente (fermée)
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear - 1}`,
      `${currentYear - 1}-01-01`,
      `${currentYear - 1}-12-31`,
      currentYear - 1,
      'closed'
    )

    // Année en cours (ouverte)
    db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear}`,
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      currentYear,
      'open'
    )

    const allPeriods = db.prepare('SELECT * FROM accounting_periods ORDER BY fiscal_year').all() as any[]
    expect(allPeriods).toHaveLength(2)
    expect(allPeriods[0].status).toBe('closed')
    expect(allPeriods[1].status).toBe('open')
  })
})
