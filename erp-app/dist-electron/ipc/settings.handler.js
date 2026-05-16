"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSettingsHandlers = registerSettingsHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const updater_service_1 = require("../services/updater.service");
const electron_1 = require("electron");
function registerSettingsHandlers() {
    (0, index_1.handle)('settings:get', (key) => {
        const db = (0, connection_1.getDb)();
        if (key) {
            const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
            return row?.value ?? null;
        }
        const rows = db.prepare('SELECT key, value FROM app_settings').all();
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
    });
    (0, index_1.handle)('settings:set', ({ key, value }) => {
        const PROTECTED_KEYS = ['api_key'];
        if (PROTECTED_KEYS.includes(key)) {
            throw new Error('Action non autorisée: modification des clés système restreintes.');
        }
        const db = (0, connection_1.getDb)();
        db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `).run(key, value, value);
        return { success: true };
    });
    (0, index_1.handle)('settings:setMany', (settings) => {
        const PROTECTED_KEYS = ['api_key'];
        const db = (0, connection_1.getDb)();
        const tx = db.transaction(() => {
            for (const [key, value] of Object.entries(settings)) {
                if (PROTECTED_KEYS.includes(key))
                    continue; // Ignore silently protected keys
                db.prepare(`
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `).run(key, value, value);
            }
        });
        tx();
        return { success: true };
    });
    // تحديث محلي مباشر
    (0, index_1.handle)('update:selectLocalFile', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: 'Sélectionner le fichier de mise à jour',
            filters: [
                { name: 'Installateurs', extensions: ['exe', 'msi', 'dmg', 'appimage'] }
            ],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Aucun fichier sélectionné' };
        }
        const filePath = result.filePaths[0];
        const checkResult = (0, updater_service_1.checkLocalUpdate)(filePath);
        if (!checkResult.success) {
            return checkResult;
        }
        return { success: true, filePath, version: checkResult.version, fileSize: checkResult.fileSize };
    });
    (0, index_1.handle)('update:installLocal', ({ filePath }) => {
        return (0, updater_service_1.installLocalUpdate)(filePath);
    });
    // ── Document Sequences ──────────────────────────────────────────────────
    (0, index_1.handle)('sequences:getAll', () => {
        const db = (0, connection_1.getDb)();
        const year = new Date().getFullYear() % 100;
        const rows = db.prepare(`
      SELECT doc_type, year, last_seq
      FROM document_sequences
      ORDER BY doc_type, year DESC
    `).all();
        return rows;
    });
    (0, index_1.handle)('sequences:set', ({ doc_type, year, last_seq }) => {
        const db = (0, connection_1.getDb)();
        if (last_seq < 0)
            throw new Error('Le numéro de séquence doit être positif');
        db.prepare(`
      INSERT INTO document_sequences (doc_type, year, last_seq)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_type, year) DO UPDATE SET last_seq = ?
    `).run(doc_type, year, last_seq, last_seq);
        return { success: true };
    });
    (0, index_1.handle)('sequences:check', ({ doc_type, seq }) => {
        const db = (0, connection_1.getDb)();
        if (doc_type === 'payment') {
            const year = new Date().getFullYear() % 100;
            const padded = `P-${year}-${seq}`;
            const plain = `P-${seq}`;
            const oldPadded = `P-${String(seq).padStart(4, '0')}`;
            const exists = db.prepare('SELECT id FROM payments WHERE reference = ? OR reference = ? OR reference = ?').get(padded, plain, oldPadded);
            if (exists) {
                let suggestion = seq + 1;
                const allRefs = db.prepare("SELECT reference FROM payments WHERE reference LIKE 'P-%'").all();
                const usedSet = new Set(allRefs.map((r) => {
                    const parts = r.reference.split('-');
                    return parseInt(parts[parts.length - 1] ?? '0', 10);
                }).filter((n) => !isNaN(n)));
                while (usedSet.has(suggestion))
                    suggestion++;
                return { available: false, suggestion };
            }
            return { available: true };
        }
        // مستندات
        const prefix = {
            invoice: 'F', quote: 'D', bl: 'BL', proforma: 'PRO', avoir: 'AV',
            purchase_order: 'BC', bl_reception: 'BR', purchase_invoice: 'FF', import_invoice: 'IMP',
        };
        const p = prefix[doc_type] ?? 'DOC';
        const year = new Date().getFullYear() % 100;
        const candidate = `${p}-${year}-${seq}`;
        const exists = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(candidate);
        if (exists) {
            let suggestion = seq + 1;
            while (true) {
                const c = `${p}-${year}-${suggestion}`;
                const e = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(c);
                if (!e)
                    break;
                suggestion++;
            }
            return { available: false, suggestion };
        }
        return { available: true };
    });
    (0, index_1.handle)('sequences:getNext', ({ doc_type }) => {
        const db = (0, connection_1.getDb)();
        // المدفوعات — بصيغة P-YY-XXXX
        if (doc_type === 'payment') {
            const allRefs = db.prepare("SELECT reference FROM payments WHERE reference LIKE 'P-%'").all();
            let maxSeq = 0;
            for (const row of allRefs) {
                const parts = row.reference.split('-');
                const num = parseInt(parts[parts.length - 1] ?? '0', 10);
                if (!isNaN(num) && num > maxSeq)
                    maxSeq = num;
            }
            let next = maxSeq + 1;
            const usedSet = new Set(allRefs.map((r) => {
                const parts = r.reference.split('-');
                return parseInt(parts[parts.length - 1] ?? '0', 10);
            }).filter((n) => !isNaN(n)));
            while (usedSet.has(next))
                next++;
            const year = new Date().getFullYear() % 100;
            return { next, year };
        }
        // المستندات — نجد أصغر رقم متاح >= last_seq+1
        const year = new Date().getFullYear() % 100;
        const prefix = {
            invoice: 'F', quote: 'D', bl: 'BL', proforma: 'PRO', avoir: 'AV',
            purchase_order: 'BC', bl_reception: 'BR', purchase_invoice: 'FF', import_invoice: 'IMP',
        };
        const p = prefix[doc_type] ?? 'DOC';
        const row = db.prepare('SELECT last_seq FROM document_sequences WHERE doc_type = ? AND year = ?').get(doc_type, year);
        let next = (row?.last_seq ?? 0) + 1;
        // نتحقق أن الرقم غير مستخدم فعلاً
        while (true) {
            const candidate = `${p}-${year}-${next}`;
            const exists = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(candidate);
            if (!exists)
                break;
            next++;
        }
        return { next, year };
    });
}
