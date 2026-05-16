"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBackupHandlers = registerBackupHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
const adm_zip_1 = __importDefault(require("adm-zip"));
const connection_1 = require("../database/connection");
function registerBackupHandlers() {
    (0, index_1.handle)('backup:create', () => {
        const userData = electron_1.app.getPath('userData');
        const backupDir = (0, path_1.join)(userData, 'backups');
        (0, fs_1.mkdirSync)(backupDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = (0, path_1.join)(backupDir, `erp-backup-${timestamp}.db`);
        // استخدام VACUUM INTO لدمج WAL وإنشاء نسخة نظيفة ومكتملة
        (0, connection_1.getDb)().exec(`VACUUM INTO '${backupPath}'`);
        // الاحتفاظ بآخر 30 نسخة فقط
        const backups = (0, fs_1.readdirSync)(backupDir)
            .filter(f => f.endsWith('.db'))
            .map(f => ({ name: f, time: (0, fs_1.statSync)((0, path_1.join)(backupDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);
        if (backups.length > 30) {
            backups.slice(30).forEach(b => (0, fs_1.unlinkSync)((0, path_1.join)(backupDir, b.name)));
        }
        return { path: backupPath, timestamp };
    });
    (0, index_1.handle)('backup:list', () => {
        const backupDir = (0, path_1.join)(electron_1.app.getPath('userData'), 'backups');
        try {
            return (0, fs_1.readdirSync)(backupDir)
                .filter(f => f.endsWith('.db'))
                .map(f => ({
                name: f,
                path: (0, path_1.join)(backupDir, f),
                size: (0, fs_1.statSync)((0, path_1.join)(backupDir, f)).size,
                date: (0, fs_1.statSync)((0, path_1.join)(backupDir, f)).mtime,
            }))
                .sort((a, b) => b.date.getTime() - a.date.getTime());
        }
        catch {
            return [];
        }
    });
    (0, index_1.handle)('backup:restore', (backupPath) => {
        const userData = electron_1.app.getPath('userData');
        const dbPath = (0, path_1.join)(userData, 'erp.db');
        const safetyPath = (0, path_1.join)(userData, `erp-before-restore-${Date.now()}.db`);
        (0, fs_1.copyFileSync)(dbPath, safetyPath);
        (0, fs_1.copyFileSync)(backupPath, dbPath);
        // إغلاق الاتصال القديم وإعادة تهيئة قاعدة البيانات المستعادة
        (0, connection_1.closeDatabase)();
        (0, connection_1.initDatabase)();
        // إعادة تحميل النافذة
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        win?.webContents.reload();
        return { success: true, safetyBackup: safetyPath };
    });
    // ── Export complet (DB + pièces jointes) → ZIP ──────────────────────────
    (0, index_1.handle)('backup:exportFull', async () => {
        const userData = electron_1.app.getPath('userData');
        const { filePath, canceled } = await electron_1.dialog.showSaveDialog({
            title: 'Exporter la sauvegarde complète',
            defaultPath: `erp-export-${new Date().toISOString().slice(0, 10)}.zip`,
            filters: [{ name: 'Archive ERP', extensions: ['zip'] }],
        });
        if (canceled || !filePath)
            return { canceled: true };
        const zip = new adm_zip_1.default();
        // 1. Base de données — استخدام VACUUM INTO لدمج WAL وضمان نسخة مكتملة
        const dbPath = (0, path_1.join)(userData, 'erp.db');
        if ((0, fs_1.existsSync)(dbPath)) {
            const tmpDb = (0, path_1.join)(userData, `erp-export-tmp-${Date.now()}.db`);
            (0, connection_1.getDb)().exec(`VACUUM INTO '${tmpDb}'`);
            zip.addLocalFile(tmpDb, '', 'erp.db');
            (0, fs_1.unlinkSync)(tmpDb);
        }
        // 2. Pièces jointes
        const attachDir = (0, path_1.join)(userData, 'attachments');
        if ((0, fs_1.existsSync)(attachDir))
            zip.addLocalFolder(attachDir, 'attachments');
        // 3. Métadonnées
        const meta = JSON.stringify({
            version: electron_1.app.getVersion(),
            exportedAt: new Date().toISOString(),
            platform: process.platform,
        });
        zip.addFile('meta.json', Buffer.from(meta, 'utf8'));
        zip.writeZip(filePath);
        return { success: true, path: filePath };
    });
    // ── Import complet depuis ZIP ────────────────────────────────────────────
    (0, index_1.handle)('backup:importFull', async () => {
        const userData = electron_1.app.getPath('userData');
        const { filePaths, canceled } = await electron_1.dialog.showOpenDialog({
            title: 'Importer une sauvegarde complète',
            filters: [{ name: 'Archive ERP', extensions: ['zip'] }],
            properties: ['openFile'],
        });
        if (canceled || !filePaths[0])
            return { canceled: true };
        const zip = new adm_zip_1.default(filePaths[0]);
        const entries = zip.getEntries().map(e => e.entryName);
        // Vérifier que c'est bien une archive ERP
        if (!entries.includes('erp.db')) {
            throw new Error('Fichier invalide — ce n\'est pas une archive ERP valide');
        }
        // Sauvegarde de sécurité avant import
        const dbPath = (0, path_1.join)(userData, 'erp.db');
        if ((0, fs_1.existsSync)(dbPath)) {
            const safetyDir = (0, path_1.join)(userData, 'backups');
            (0, fs_1.mkdirSync)(safetyDir, { recursive: true });
            (0, fs_1.copyFileSync)(dbPath, (0, path_1.join)(safetyDir, `erp-before-import-${Date.now()}.db`));
        }
        // Extraire la DB
        zip.extractEntryTo('erp.db', userData, false, true);
        // Extraire les pièces jointes si présentes
        const attachEntries = entries.filter(e => e.startsWith('attachments/'));
        if (attachEntries.length > 0) {
            zip.extractEntryTo('attachments/', userData, false, true);
        }
        // إغلاق الاتصال القديم وإعادة تهيئة قاعدة البيانات الجديدة
        (0, connection_1.closeDatabase)();
        (0, connection_1.initDatabase)();
        // إعادة تحميل النافذة لتطبيق البيانات الجديدة
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        win?.webContents.reload();
        return { success: true };
    });
}
