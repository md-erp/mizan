"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiKey = getApiKey;
exports.startApiServer = startApiServer;
exports.stopApiServer = stopApiServer;
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const connection_1 = require("../database/connection");
let server = null;
// توليد أو استرجاع API key من قاعدة البيانات
function getOrCreateApiKey() {
    const db = (0, connection_1.getDb)();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'api_key'").get();
    if (row?.value)
        return row.value;
    const newKey = crypto_1.default.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('api_key', ?)").run(newKey);
    console.log('[API] Generated new API key:', newKey);
    return newKey;
}
function getApiKey() {
    return getOrCreateApiKey();
}
function startApiServer(port) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Middleware: التحقق من الـ API key
    app.use((req, res, next) => {
        if (req.path === '/health') {
            next();
            return;
        } // health check بدون auth
        const key = req.headers['x-api-key'];
        const validKey = getOrCreateApiKey();
        if (!key || key !== validKey) {
            res.status(401).json({ error: 'Unauthorized — invalid API key' });
            return;
        }
        next();
    });
    // Health check (public)
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    // Sync endpoint — يُرجع آخر التغييرات
    app.get('/sync', (req, res) => {
        const db = (0, connection_1.getDb)();
        const since = req.query.since ?? '1970-01-01';
        const tables = ['clients', 'suppliers', 'products', 'documents', 'payments'];
        const changes = {};
        for (const table of tables) {
            try {
                changes[table] = db.prepare(`SELECT * FROM ${table} WHERE updated_at > ?`).all(since);
            }
            catch {
                changes[table] = [];
            }
        }
        res.json({ changes, timestamp: new Date().toISOString() });
    });
    // Push endpoint — استقبال التغييرات من الـ Client
    app.post('/push', (req, res) => {
        const { table, action, data } = req.body;
        if (!table || !action || !data) {
            res.status(400).json({ error: 'table, action, data requis' });
            return;
        }
        const allowedTables = ['clients', 'suppliers', 'products'];
        if (!allowedTables.includes(table)) {
            res.status(403).json({ error: `Table ${table} non autorisée pour push` });
            return;
        }
        // TODO: implémenter la logique de merge/conflict resolution
        res.json({ success: true, message: 'Push reçu' });
    });
    server = app.listen(port, '0.0.0.0', () => {
        console.log(`[API] Server running on port ${port}`);
    });
}
function stopApiServer() {
    server?.close();
    server = null;
}
