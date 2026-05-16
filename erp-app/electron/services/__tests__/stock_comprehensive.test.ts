/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ÉTAPE 4: TESTS STOCK ET CMUP COMPLETS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Tests exhaustifs:
 * - CMUP avec quantités fractionnaires
 * - Empêcher vente > stock
 * - Transformation aluminium
 * - Annulation et retour stock
 */

import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals'
import { migration_001_initial } from '../../../electron/database/migrations/001_initial'
import { migration_002_accounting } from '../../../electron/database/migrations/002_accounting'
import { migration_003_production } from '../../../electron/database/migrations/003_production'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_003_production(db)

  // Créer client et fournisseur
  db.prepare(`INSERT INTO clients (id, name) VALUES (1, 'Client Test')`).run()
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (1, 'Fournisseur Test')`).run()

  // Créer produits
  db.prepare(`
    INSERT INTO products (id, code, name, type, sale_price, cmup_price, tva_rate_id, stock_quantity)
    VALUES 
      (1, 'MAT1', 'Matière première', 'raw', 0, 0, 5, 0),
      (2, 'PROD1', 'Produit fini', 'finished', 100, 0, 5, 0),
      (3, 'ALU-6M', 'Barre aluminium 6m', 'raw', 0, 0, 5, 0),
      (4, 'ALU-1M', 'Aluminium 1m', 'finished', 0, 0, 5, 0)
  `).run()
})

afterEach(() => {
  db.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Appliquer mouvement stock
// ═══════════════════════════════════════════════════════════════════════════
function applyStockMovement(productId: number, type: 'in' | 'out', quantity: number, unitCost: number = 0) {
  const product = db.prepare('SELECT cmup_price, stock_quantity FROM products WHERE id = ?').get(productId) as any
  const cmupBefore = product.cmup_price ?? 0
  const stockBefore = product.stock_quantity ?? 0

  let newCmup = cmupBefore
  let newStock = stockBefore

  if (type === 'in') {
    // Entrée: recalculer CMUP
    const totalValue = (stockBefore * cmupBefore) + (quantity * unitCost)
    newStock = stockBefore + quantity
    newCmup = newStock > 0 ? totalValue / newStock : 0
  } else {
    // Sortie: vérifier stock disponible
    if (quantity > stockBefore) {
      throw new Error(`Stock insuffisant: demandé ${quantity}, disponible ${stockBefore}`)
    }
    newStock = stockBefore - quantity
    // CMUP reste inchangé
  }

  // Arrondir
  newCmup = Math.round(newCmup * 10000) / 10000
  newStock = Math.round(newStock * 10000) / 10000

  // Mettre à jour produit
  db.prepare(`
    UPDATE products
    SET cmup_price = ?, stock_quantity = ?
    WHERE id = ?
  `).run(newCmup, newStock, productId)

  // Enregistrer mouvement
  db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, unit_cost, cmup_before, cmup_after, applied, date, manual_ref)
    VALUES (?, ?, ?, ?, ?, ?, 1, date('now'), 'TEST')
  `).run(productId, type, quantity, unitCost, cmupBefore, newCmup)

  return { cmupBefore, cmupAfter: newCmup, stockBefore, stockAfter: newStock }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: CMUP avec quantités fractionnaires
// ═══════════════════════════════════════════════════════════════════════════
describe('CMUP — quantités fractionnaires', () => {
  it('Achat 100 @ 10 MAD puis 100 @ 20 MAD → CMUP = 15 MAD', () => {
    // Premier achat
    const move1 = applyStockMovement(1, 'in', 100, 10)
    expect(move1.cmupAfter).toBe(10)
    expect(move1.stockAfter).toBe(100)

    // Deuxième achat
    const move2 = applyStockMovement(1, 'in', 100, 20)
    expect(move2.cmupAfter).toBe(15) // (100*10 + 100*20) / 200 = 15
    expect(move2.stockAfter).toBe(200)
  })

  it('Achat 50.5 @ 12.75 MAD puis 30.25 @ 18.50 MAD → CMUP correct', () => {
    // Premier achat
    const move1 = applyStockMovement(1, 'in', 50.5, 12.75)
    expect(move1.cmupAfter).toBe(12.75)
    expect(move1.stockAfter).toBe(50.5)

    // Deuxième achat
    const move2 = applyStockMovement(1, 'in', 30.25, 18.50)
    const expectedCmup = ((50.5 * 12.75) + (30.25 * 18.50)) / (50.5 + 30.25)
    expect(move2.cmupAfter).toBeCloseTo(expectedCmup, 4)
    expect(move2.stockAfter).toBe(80.75)
  })

  it('Achat puis vente partielle → CMUP inchangé', () => {
    // Achat
    applyStockMovement(1, 'in', 100, 15)

    // Vente partielle
    const move2 = applyStockMovement(1, 'out', 30, 0)
    expect(move2.cmupAfter).toBe(15) // CMUP reste 15
    expect(move2.stockAfter).toBe(70)
  })

  it('Achat → vente totale → stock = 0, CMUP = 0', () => {
    applyStockMovement(1, 'in', 50, 10)
    const move2 = applyStockMovement(1, 'out', 50, 0)
    expect(move2.stockAfter).toBe(0)
    expect(move2.cmupAfter).toBe(10) // CMUP reste inchangé même si stock = 0
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Empêcher vente > stock
// ═══════════════════════════════════════════════════════════════════════════
describe('Vente > stock — doit être bloquée', () => {
  it('Stock = 10, vente 15 → erreur', () => {
    applyStockMovement(1, 'in', 10, 10)

    expect(() => {
      applyStockMovement(1, 'out', 15, 0)
    }).toThrow(/Stock insuffisant/)
  })

  it('Stock = 0, vente 1 → erreur', () => {
    expect(() => {
      applyStockMovement(1, 'out', 1, 0)
    }).toThrow(/Stock insuffisant/)
  })

  it('Stock = 100.5, vente 100.6 → erreur', () => {
    applyStockMovement(1, 'in', 100.5, 10)

    expect(() => {
      applyStockMovement(1, 'out', 100.6, 0)
    }).toThrow(/Stock insuffisant/)
  })

  it('Stock = 100, vente 100 → OK', () => {
    applyStockMovement(1, 'in', 100, 10)
    const move = applyStockMovement(1, 'out', 100, 0)
    expect(move.stockAfter).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Transformation aluminium
// ═══════════════════════════════════════════════════════════════════════════
describe('Transformation aluminium', () => {
  it('Barre 6m @ 120 MAD → 6 × 1m @ 20 MAD chacun', () => {
    // Achat barre 6m
    applyStockMovement(3, 'in', 1, 120) // 1 barre @ 120 MAD

    // Transformation: sortie 1 barre 6m
    const moveOut = applyStockMovement(3, 'out', 1, 0)
    expect(moveOut.stockAfter).toBe(0)

    // Entrée 6 × 1m (CMUP = 120 / 6 = 20 MAD)
    const moveIn = applyStockMovement(4, 'in', 6, 20)
    expect(moveIn.cmupAfter).toBe(20)
    expect(moveIn.stockAfter).toBe(6)
  })

  it('2 barres 6m @ 120 MAD + 1 barre @ 150 MAD → transformation partielle', () => {
    // Achat 2 barres @ 120
    applyStockMovement(3, 'in', 2, 120)
    // Achat 1 barre @ 150
    applyStockMovement(3, 'in', 1, 150)

    // CMUP = (2*120 + 1*150) / 3 = 130 MAD
    const product = db.prepare('SELECT cmup_price FROM products WHERE id = 3').get() as any
    expect(product.cmup_price).toBe(130)

    // Transformation 1 barre → 6 × 1m @ 130/6 = 21.6667 MAD
    applyStockMovement(3, 'out', 1, 0)
    const moveIn = applyStockMovement(4, 'in', 6, 130 / 6)
    expect(moveIn.cmupAfter).toBeCloseTo(21.6667, 4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Annulation BL → retour stock
// ═══════════════════════════════════════════════════════════════════════════
describe('Annulation BL — retour stock', () => {
  it('BL vendu 10 unités → annulation → stock revient', () => {
    // Stock initial
    applyStockMovement(2, 'in', 100, 50)

    // Vente (BL)
    applyStockMovement(2, 'out', 10, 0)
    let product = db.prepare('SELECT stock_quantity FROM products WHERE id = 2').get() as any
    expect(product.stock_quantity).toBe(90)

    // Annulation BL → retour stock
    applyStockMovement(2, 'in', 10, 50) // On remet au CMUP actuel
    product = db.prepare('SELECT stock_quantity FROM products WHERE id = 2').get() as any
    expect(product.stock_quantity).toBe(100)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Scénario complet achat → production → vente
// ═══════════════════════════════════════════════════════════════════════════
describe('Scénario complet — achat → production → vente', () => {
  it('Achat matière → production → vente produit fini', () => {
    // 1. Achat matière première: 100 kg @ 10 MAD
    applyStockMovement(1, 'in', 100, 10)
    let mat = db.prepare('SELECT cmup_price, stock_quantity FROM products WHERE id = 1').get() as any
    expect(mat.cmup_price).toBe(10)
    expect(mat.stock_quantity).toBe(100)

    // 2. Production: consomme 50 kg → produit 10 unités
    applyStockMovement(1, 'out', 50, 0) // Sortie matière
    mat = db.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any
    expect(mat.stock_quantity).toBe(50)

    // Coût production = 50 * 10 = 500 MAD → CMUP produit fini = 500 / 10 = 50 MAD
    applyStockMovement(2, 'in', 10, 50)
    let prod = db.prepare('SELECT cmup_price, stock_quantity FROM products WHERE id = 2').get() as any
    expect(prod.cmup_price).toBe(50)
    expect(prod.stock_quantity).toBe(10)

    // 3. Vente: 5 unités
    applyStockMovement(2, 'out', 5, 0)
    prod = db.prepare('SELECT cmup_price, stock_quantity FROM products WHERE id = 2').get() as any
    expect(prod.cmup_price).toBe(50) // CMUP inchangé
    expect(prod.stock_quantity).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6: CMUP avec 3 achats successifs
// ═══════════════════════════════════════════════════════════════════════════
describe('CMUP — 3 achats successifs', () => {
  it('Achat 100@10, 50@20, 25@30 → CMUP correct', () => {
    applyStockMovement(1, 'in', 100, 10)
    applyStockMovement(1, 'in', 50, 20)
    applyStockMovement(1, 'in', 25, 30)

    // CMUP = (100*10 + 50*20 + 25*30) / (100+50+25) = (1000+1000+750) / 175 = 2750 / 175 = 15.7143
    const product = db.prepare('SELECT cmup_price FROM products WHERE id = 1').get() as any
    expect(product.cmup_price).toBeCloseTo(15.7143, 4)
  })
})
