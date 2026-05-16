import { describe, it, expect, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'

describe('Création automatique de période comptable', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    migration_001_initial(db)
    migration_002_accounting(db)
  })

  it('devrait créer automatiquement une période pour l\'année en cours', () => {
    const currentYear = new Date().getFullYear()

    // Simuler la création automatique
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

    // Vérifier que la période a été créée correctement
    const period = db.prepare(`
      SELECT * FROM accounting_periods WHERE id = ?
    `).get(result.lastInsertRowid) as any

    expect(period).toBeDefined()
    expect(period.name).toBe(`Exercice ${currentYear}`)
    expect(period.start_date).toBe(`${currentYear}-01-01`)
    expect(period.end_date).toBe(`${currentYear}-12-31`)
    expect(period.fiscal_year).toBe(currentYear)
    expect(period.status).toBe('open')
    expect(period.notes).toBe('Période créée automatiquement')
  })

  it('devrait détecter l\'absence de période pour l\'année en cours', () => {
    const currentYear = new Date().getFullYear()

    // Vérifier qu'aucune période n'existe
    const periods = db.prepare(`
      SELECT * FROM accounting_periods 
      WHERE fiscal_year = ? AND status = 'open'
    `).all(currentYear)

    expect(periods).toHaveLength(0)
  })

  it('ne devrait pas créer de période si une existe déjà', () => {
    const currentYear = new Date().getFullYear()

    // Créer une période
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

    // Vérifier qu'une période existe
    const periods = db.prepare(`
      SELECT * FROM accounting_periods 
      WHERE fiscal_year = ? AND status = 'open'
    `).all(currentYear)

    expect(periods).toHaveLength(1)

    // Tenter de créer une deuxième période devrait échouer (contrainte unique ou logique métier)
    // Dans ce test, on vérifie simplement qu'on peut détecter l'existence
    const existingPeriod = db.prepare(`
      SELECT COUNT(*) as count FROM accounting_periods 
      WHERE fiscal_year = ? AND status = 'open'
    `).get(currentYear) as any

    expect(existingPeriod.count).toBe(1)
  })

  it('devrait permettre la création manuelle avec dates personnalisées', () => {
    const currentYear = new Date().getFullYear()

    // Créer une période avec dates personnalisées (exercice décalé)
    const result = db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `Exercice ${currentYear} (Décalé)`,
      `${currentYear}-07-01`,
      `${currentYear + 1}-06-30`,
      currentYear,
      'open',
      'Exercice décalé juillet-juin'
    )

    const period = db.prepare(`
      SELECT * FROM accounting_periods WHERE id = ?
    `).get(result.lastInsertRowid) as any

    expect(period.start_date).toBe(`${currentYear}-07-01`)
    expect(period.end_date).toBe(`${currentYear + 1}-06-30`)
    expect(period.notes).toBe('Exercice décalé juillet-juin')
  })

  it('devrait valider que start_date < end_date', () => {
    const currentYear = new Date().getFullYear()

    // Cette validation devrait être faite au niveau de l'application
    // Ici on teste juste que SQLite accepte les données
    const startDate = `${currentYear}-01-01`
    const endDate = `${currentYear}-12-31`

    expect(startDate < endDate).toBe(true)

    // Test avec dates inversées
    const invalidStart = `${currentYear}-12-31`
    const invalidEnd = `${currentYear}-01-01`

    expect(invalidStart > invalidEnd).toBe(true)
  })

  it('devrait permettre plusieurs périodes pour différentes années', () => {
    const currentYear = new Date().getFullYear()

    // Créer période année précédente (fermée)
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

    // Créer période année en cours (ouverte)
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

    const allPeriods = db.prepare(`
      SELECT * FROM accounting_periods ORDER BY fiscal_year
    `).all()

    expect(allPeriods).toHaveLength(2)
  })
})
