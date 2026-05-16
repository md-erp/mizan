"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round = round;
exports.roundQty = roundQty;
exports.roundAmt = roundAmt;
exports.createStockMovement = createStockMovement;
exports.applyMovement = applyMovement;
exports.getPendingMovements = getPendingMovements;
// ==========================================
// UTILITAIRES DE PRÉCISION NUMÉRIQUE
// SQLite stocke REAL en IEEE 754 double.
// On arrondit systématiquement pour éviter
// les erreurs de virgule flottante (ex: 1.9999999 au lieu de 2).
// ROUND_HALF_UP conforme au contexte comptable CGNC.
// ==========================================
/** Arrondit à N décimales (ROUND_HALF_UP) */
function round(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
/** Arrondit une quantité à 4 décimales */
function roundQty(value) {
    return round(value, 4);
}
/** Arrondit un montant financier à 2 décimales */
function roundAmt(value) {
    return round(value, 2);
}
/** Epsilon pour comparaisons financières (0.005 MAD) */
const FINANCIAL_EPSILON = 0.005;
// ==========================================
// CREATE STOCK MOVEMENT (معلق أو مطبق)
// ==========================================
function createStockMovement(db, input) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(input.product_id);
    if (!product)
        throw new Error(`Produit ${input.product_id} introuvable`);
    const movId = db.prepare(`
    INSERT INTO stock_movements
      (product_id, type, quantity, unit_cost, cmup_before, cmup_after,
       applied, document_id, production_id, transformation_id, manual_ref,
       date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.product_id, input.type, input.quantity, input.unit_cost ?? 0, product.cmup_price, 0, // cmup_after يُحسب عند التطبيق
    0, // دائماً 0 عند الإنشاء، يُطبق بعدها
    input.document_id ?? null, input.production_id ?? null, input.transformation_id ?? null, input.manual_ref ?? null, input.date, input.notes ?? null, input.created_by).lastInsertRowid;
    if (input.applied) {
        applyMovement(db, movId, input.created_by);
    }
    return movId;
}
// ==========================================
// APPLY MOVEMENT — يُحدِّث المخزون و CMUP
// ==========================================
function applyMovement(db, movementId, userId) {
    const mov = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(movementId);
    if (!mov)
        throw new Error('Mouvement introuvable');
    if (mov.applied === 1)
        throw new Error('Mouvement déjà appliqué');
    if (mov.applied === -1)
        throw new Error('Mouvement annulé, impossible de l\'appliquer');
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(mov.product_id);
    let newQuantity;
    let newCmup;
    if (mov.type === 'in') {
        // CMUP = (stock_actuel × cmup_actuel + quantité × coût_unitaire) / (stock_actuel + quantité)
        const totalValue = roundAmt(roundAmt(product.stock_quantity * product.cmup_price) +
            roundAmt(mov.quantity * mov.unit_cost));
        newQuantity = roundQty(product.stock_quantity + mov.quantity);
        newCmup = newQuantity > 0 ? roundAmt(totalValue / newQuantity) : roundAmt(mov.unit_cost);
    }
    else {
        // Sortie: on vérifie le stock disponible
        if (roundQty(product.stock_quantity) < roundQty(mov.quantity) - 0.0001) {
            throw new Error(`Stock insuffisant pour ${product.name}: disponible ${product.stock_quantity}, demandé ${mov.quantity}`);
        }
        newQuantity = roundQty(product.stock_quantity - mov.quantity);
        newCmup = roundAmt(product.cmup_price); // CMUP ne change pas à la sortie
    }
    const tx = db.transaction(() => {
        // تحديث حركة المخزون
        db.prepare(`
      UPDATE stock_movements
      SET applied = 1, applied_at = CURRENT_TIMESTAMP, applied_by = ?, cmup_after = ?
      WHERE id = ?
    `).run(userId, newCmup, movementId);
        // تحديث المنتج
        db.prepare(`
      UPDATE products
      SET stock_quantity = ?, cmup_price = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newQuantity, newCmup, mov.product_id);
    });
    tx();
}
// ==========================================
// GET PENDING MOVEMENTS FOR DOCUMENT
// ==========================================
function getPendingMovements(db, documentId) {
    return db.prepare(`
    SELECT sm.*, p.name as product_name, p.unit, p.stock_quantity
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.document_id = ? AND sm.applied = 0
  `).all(documentId);
}
