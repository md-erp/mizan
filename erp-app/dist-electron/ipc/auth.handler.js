"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const crypto_1 = __importDefault(require("crypto"));
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const audit_service_1 = require("../services/audit.service");
function hashPassword(password) {
    return crypto_1.default.createHash('sha256').update(password).digest('hex');
}
function registerAuthHandlers() {
    (0, index_1.handle)('auth:login', ({ email, password }) => {
        const db = (0, connection_1.getDb)();
        if (!email?.trim() || !password?.trim()) {
            throw new Error('Email et mot de passe requis');
        }
        const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
        if (!user)
            throw new Error('Aucun compte trouvé avec cet email');
        if (user.password_hash !== hashPassword(password))
            throw new Error('Mot de passe incorrect');
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        (0, audit_service_1.logAudit)(db, { user_id: user.id, action: 'LOGIN', table_name: 'users', record_id: user.id });
        const { password_hash, ...safeUser } = user;
        return safeUser;
    });
    (0, index_1.handle)('users:getAll', () => {
        const db = (0, connection_1.getDb)();
        return db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users').all();
    });
    (0, index_1.handle)('users:create', ({ name, email, password, role }) => {
        const db = (0, connection_1.getDb)();
        if (!name?.trim() || !email?.trim() || !password?.trim()) {
            throw new Error('Nom, email et mot de passe sont obligatoires');
        }
        if (password.length < 4) {
            throw new Error('Le mot de passe doit contenir au moins 4 caractères');
        }
        const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role ?? 'sales');
        (0, audit_service_1.logAudit)(db, { user_id: 1, action: 'CREATE', table_name: 'users', record_id: result.lastInsertRowid, new_values: { name, email, role } });
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('users:update', ({ id, name, email, role, is_active, password }) => {
        const db = (0, connection_1.getDb)();
        if (password) {
            db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
                .run(name, email, role, is_active, hashPassword(password), id);
        }
        else {
            db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
                .run(name, email, role, is_active, id);
        }
        return { success: true };
    });
    (0, index_1.handle)('users:delete', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);
        (0, audit_service_1.logAudit)(db, { user_id: 1, action: 'DELETE', table_name: 'users', record_id: id });
        return { success: true };
    });
    (0, index_1.handle)('auth:logout', () => ({ success: true }));
}
