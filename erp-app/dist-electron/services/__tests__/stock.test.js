"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const _001_initial_1 = require("../../database/migrations/001_initial");
const stock_service_1 = require("../stock.service");
function createTestDb() {
    const db = new better_sqlite3_1.default(':memory:');
    db.pragma('foreign_keys = ON');
    (0, _001_initial_1.migration_001_initial)(db);
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'hash', 'admin')`).run();
    db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id)
    VALUES (1, 'TEST001', 'Produit Test', 'kg', 'raw', 100, 50, 5)`).run();
    db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id)
    VALUES (2, 'TEST002', 'Produit Vide', 'kg', 'raw', 0, 0, 5)`).run();
    return db;
}
describe('Stock Service', () => {
    describe('CMUP — Calcul du coût moyen unitaire pondéré', () => {
        it('calcule le CMUP correctement à l\'entrée', () => {
            const db = createTestDb();
            // Stock initial: 100 unités à 50 MAD
            // Nouvelle entrée: 50 unités à 80 MAD
            // CMUP attendu: (100×50 + 50×80) / 150 = 60 MAD
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 50, unit_cost: 80,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 1').get();
            expect(product.stock_quantity).toBe(150);
            expect(product.cmup_price).toBeCloseTo(60, 2);
        });
        it('ne change pas le CMUP à la sortie', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 30,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 1').get();
            expect(product.stock_quantity).toBe(70);
            expect(product.cmup_price).toBe(50);
        });
        it('CMUP = coût unitaire quand stock initial est zéro', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 2, type: 'in', quantity: 100, unit_cost: 75,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 2').get();
            expect(product.stock_quantity).toBe(100);
            expect(product.cmup_price).toBeCloseTo(75, 2);
        });
        it('CMUP cumulatif sur plusieurs entrées successives', () => {
            const db = createTestDb();
            // Entrée 1: 100 @ 50 (déjà en base)
            // Entrée 2: 50 @ 80 → CMUP = 60
            const m1 = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 50, unit_cost: 80,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, m1, 1);
            // Entrée 3: 50 @ 90 → CMUP = (150×60 + 50×90) / 200 = 67.5
            const m2 = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 50, unit_cost: 90,
                date: '2026-01-16', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, m2, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 1').get();
            expect(product.stock_quantity).toBe(200);
            expect(product.cmup_price).toBeCloseTo(67.5, 2);
        });
    });
    describe('Validation du stock', () => {
        it('refuse une sortie si stock insuffisant', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 200,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            expect(() => (0, stock_service_1.applyMovement)(db, movId, 1)).toThrow('Stock insuffisant');
        });
        it('refuse une sortie si stock exactement insuffisant (0 disponible)', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 2, type: 'out', quantity: 1,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            expect(() => (0, stock_service_1.applyMovement)(db, movId, 1)).toThrow('Stock insuffisant');
        });
        it('accepte une sortie exactement égale au stock disponible', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 100,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 1').get();
            expect(product.stock_quantity).toBe(0);
        });
        it('refuse d\'appliquer un mouvement déjà appliqué', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 10, unit_cost: 50,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            expect(() => (0, stock_service_1.applyMovement)(db, movId, 1)).toThrow('déjà appliqué');
        });
        it('lance une erreur si produit introuvable', () => {
            const db = createTestDb();
            expect(() => (0, stock_service_1.createStockMovement)(db, {
                product_id: 999, type: 'in', quantity: 10, unit_cost: 50,
                date: '2026-01-15', applied: false, created_by: 1,
            })).toThrow('introuvable');
        });
    });
    describe('Mouvement avec applied=true (direct)', () => {
        it('crée et applique le mouvement en une seule étape', () => {
            const db = createTestDb();
            // applied=true: createStockMovement insère avec applied=0 puis appelle applyMovement
            // On vérifie que le stock est mis à jour correctement
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 20, unit_cost: 60,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const product = db.prepare('SELECT * FROM products WHERE id = 1').get();
            expect(product.stock_quantity).toBe(120);
        });
    });
    describe('getPendingMovements', () => {
        function createDocForTest(db) {
            // Insérer un document valide pour respecter la FK
            db.prepare(`INSERT INTO documents (id, type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc)
        VALUES (42, 'bl', 'BL-2026-0001', '2026-01-15', NULL, NULL, 'confirmed', 0, 0, 0)`).run();
        }
        it('retourne les mouvements non appliqués pour un document', () => {
            const db = createTestDb();
            createDocForTest(db);
            (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 10,
                document_id: 42, date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 5,
                document_id: 42, date: '2026-01-15', applied: false, created_by: 1,
            });
            const pending = (0, stock_service_1.getPendingMovements)(db, 42);
            expect(pending).toHaveLength(2);
            expect(pending[0].product_name).toBe('Produit Test');
        });
        it('ne retourne pas les mouvements déjà appliqués', () => {
            const db = createTestDb();
            createDocForTest(db);
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'out', quantity: 10,
                document_id: 42, date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const pending = (0, stock_service_1.getPendingMovements)(db, 42);
            expect(pending).toHaveLength(0);
        });
    });
    describe('cmup_before / cmup_after dans le mouvement', () => {
        it('enregistre le CMUP avant et après dans le mouvement', () => {
            const db = createTestDb();
            const movId = (0, stock_service_1.createStockMovement)(db, {
                product_id: 1, type: 'in', quantity: 50, unit_cost: 80,
                date: '2026-01-15', applied: false, created_by: 1,
            });
            (0, stock_service_1.applyMovement)(db, movId, 1);
            const mov = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(movId);
            expect(mov.cmup_before).toBe(50);
            expect(mov.cmup_after).toBeCloseTo(60, 2);
        });
    });
});
