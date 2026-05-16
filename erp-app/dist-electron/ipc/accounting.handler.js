"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAccountingHandlers = registerAccountingHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const accounting_service_1 = require("../services/accounting.service");
function registerAccountingHandlers() {
    (0, index_1.handle)('accounting:getAccounts', (filters) => {
        const db = (0, connection_1.getDb)();
        let query = 'SELECT * FROM accounts WHERE is_active = 1';
        const params = [];
        if (filters?.search) {
            query += ' AND (code LIKE ? OR name LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s);
        }
        if (filters?.class) {
            query += ' AND class = ?';
            params.push(filters.class);
        }
        query += ' ORDER BY code ASC';
        return db.prepare(query).all(...params);
    });
    (0, index_1.handle)('accounting:getEntries', (filters) => {
        const db = (0, connection_1.getDb)();
        const page = filters?.page ?? 1;
        const limit = filters?.limit ?? 50;
        const offset = (page - 1) * limit;
        const params = [];
        let query = 'SELECT je.*, u.name as created_by_name FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by WHERE 1=1';
        if (filters?.period_id) {
            query += ' AND je.period_id = ?';
            params.push(filters.period_id);
        }
        if (filters?.source_type) {
            query += ' AND je.source_type = ?';
            params.push(filters.source_type);
        }
        if (filters?.start_date) {
            query += ' AND je.date >= ?';
            params.push(filters.start_date);
        }
        if (filters?.end_date) {
            query += ' AND je.date <= ?';
            params.push(filters.end_date);
        }
        query += ' ORDER BY je.date DESC, je.id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const rows = db.prepare(query).all(...params);
        // إضافة سطور كل قيد
        return rows.map(entry => ({
            ...entry,
            lines: db.prepare(`
        SELECT jl.*, a.code as account_code, a.name as account_name
        FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
      `).all(entry.id),
        }));
    });
    (0, index_1.handle)('accounting:getGrandLivre', (filters) => {
        const db = (0, connection_1.getDb)();
        const params = [filters.account_id];
        let dateFilter = '';
        if (filters.start_date) {
            dateFilter += ' AND je.date >= ?';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            dateFilter += ' AND je.date <= ?';
            params.push(filters.end_date);
        }
        // عند إخفاء الإلغاءات: نخفي القيود العكسية (ANNUL-) والقيود الأصلية التي لها عكسي
        const annulFilter = filters.hide_annulations
            ? `AND je.reference NOT LIKE 'ANNUL-%'
         AND je.reference NOT IN (
           SELECT REPLACE(je2.reference, 'ANNUL-', '')
           FROM journal_entries je2
           WHERE je2.reference LIKE 'ANNUL-%'
         )`
            : '';
        const lines = db.prepare(`
      SELECT jl.*, je.date, je.reference, je.description
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_id = ? ${dateFilter} ${annulFilter}
      ORDER BY je.date ASC, je.id ASC
    `).all(...params);
        let balance = 0;
        return lines.map(line => {
            balance += line.debit - line.credit;
            return { ...line, balance };
        });
    });
    (0, index_1.handle)('accounting:getBalance', (filters) => {
        const db = (0, connection_1.getDb)();
        const params = [];
        let dateFilter = '';
        if (filters?.start_date) {
            dateFilter += ' AND je.date >= ?';
            params.push(filters.start_date);
        }
        if (filters?.end_date) {
            dateFilter += ' AND je.date <= ?';
            params.push(filters.end_date);
        }
        return db.prepare(`
      SELECT a.code, a.name, a.type, a.class,
        COALESCE(SUM(jl.debit), 0)  as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id
      WHERE a.is_active = 1 ${dateFilter}
      GROUP BY a.id
      ORDER BY a.code ASC
    `).all(...params);
    });
    (0, index_1.handle)('accounting:getTva', (filters) => {
        const db = (0, connection_1.getDb)();
        const collectee = db.prepare(`
      SELECT SUM(jl.credit) - SUM(jl.debit) as amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = '4455'
        AND je.date BETWEEN ? AND ?
        AND je.reference NOT LIKE 'ANNUL-ANNUL-%'
      GROUP BY jl.notes
    `).all(filters.start_date, filters.end_date);
        const recuperable = db.prepare(`
      SELECT SUM(jl.debit) - SUM(jl.credit) as amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = '3455'
        AND je.date BETWEEN ? AND ?
        AND je.reference NOT LIKE 'ANNUL-ANNUL-%'
      GROUP BY jl.notes
    `).all(filters.start_date, filters.end_date);
        const totalCollectee = collectee.reduce((s, r) => s + r.amount, 0);
        const totalRecuperable = recuperable.reduce((s, r) => s + r.amount, 0);
        return {
            collectee,
            recuperable,
            totalCollectee,
            totalRecuperable,
            tvaDue: totalCollectee - totalRecuperable,
        };
    });
    (0, index_1.handle)('accounting:getPeriods', () => {
        const db = (0, connection_1.getDb)();
        return db.prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC').all();
    });
    (0, index_1.handle)('accounting:createPeriod', (data) => {
        const db = (0, connection_1.getDb)();
        const result = db.prepare(`
      INSERT INTO accounting_periods (name, start_date, end_date, fiscal_year, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.name, data.start_date, data.end_date, data.fiscal_year, data.status ?? 'open', data.notes ?? null);
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('accounting:updatePeriod', (data) => {
        const db = (0, connection_1.getDb)();
        const fields = [];
        const values = [];
        if (data.name !== undefined) {
            fields.push('name = ?');
            values.push(data.name);
        }
        if (data.start_date !== undefined) {
            fields.push('start_date = ?');
            values.push(data.start_date);
        }
        if (data.end_date !== undefined) {
            fields.push('end_date = ?');
            values.push(data.end_date);
        }
        if (data.fiscal_year !== undefined) {
            fields.push('fiscal_year = ?');
            values.push(data.fiscal_year);
        }
        if (data.status !== undefined) {
            fields.push('status = ?');
            values.push(data.status);
        }
        if (data.notes !== undefined) {
            fields.push('notes = ?');
            values.push(data.notes);
        }
        if (fields.length === 0)
            throw new Error('Aucune modification fournie');
        values.push(data.id);
        db.prepare(`UPDATE accounting_periods SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return { success: true };
    });
    (0, index_1.handle)('accounting:deletePeriod', (id) => {
        const db = (0, connection_1.getDb)();
        // التحقق من عدم وجود قيود مرتبطة
        const count = db.prepare('SELECT COUNT(*) as c FROM journal_entries WHERE period_id = ?').get(id).c;
        if (count > 0) {
            throw new Error(`Impossible de supprimer cette période — ${count} écriture(s) comptable(s) y sont liées`);
        }
        db.prepare('DELETE FROM accounting_periods WHERE id = ?').run(id);
        return { success: true };
    });
    (0, index_1.handle)('accounting:closePeriod', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare(`UPDATE accounting_periods SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        return { success: true };
    });
    (0, index_1.handle)('accounting:getTvaRates', () => {
        const db = (0, connection_1.getDb)();
        return db.prepare('SELECT * FROM tva_rates ORDER BY rate ASC').all();
    });
    (0, index_1.handle)('accounting:createTvaRate', (data) => {
        const db = (0, connection_1.getDb)();
        if (data.rate < 0 || data.rate > 100)
            throw new Error('Le taux doit être entre 0 et 100');
        const existing = db.prepare('SELECT id FROM tva_rates WHERE rate = ?').get(data.rate);
        if (existing)
            throw new Error(`Le taux ${data.rate}% existe déjà`);
        const result = db.prepare('INSERT INTO tva_rates (rate, label, is_active) VALUES (?, ?, 1)').run(data.rate, data.label || `TVA ${data.rate}%`);
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('accounting:createAccount', (data) => {
        const db = (0, connection_1.getDb)();
        if (!data.code?.trim() || !data.name?.trim())
            throw new Error('Code et intitulé requis');
        // تعديل حساب موجود
        if (data._update && data.id) {
            const acc = db.prepare('SELECT id, is_system FROM accounts WHERE id = ?').get(data.id);
            if (!acc)
                throw new Error('Compte introuvable');
            if (acc.is_system)
                throw new Error('Impossible de modifier un compte système');
            db.prepare('UPDATE accounts SET name = ?, type = ? WHERE id = ?')
                .run(data.name.trim(), data.type, data.id);
            return { id: data.id };
        }
        const existing = db.prepare('SELECT id FROM accounts WHERE code = ?').get(data.code.trim());
        if (existing)
            throw new Error(`Le compte ${data.code} existe déjà`);
        const result = db.prepare(`
      INSERT INTO accounts (code, name, type, class, parent_id, is_active, is_system)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run(data.code.trim(), data.name.trim(), data.type, data.class, data.parent_id ?? null);
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('accounting:createEntry', (data) => {
        const db = (0, connection_1.getDb)();
        const tx = db.transaction(() => {
            // ✅ التحقق من الفترة المحاسبية قبل إنشاء القيد اليدوي
            (0, accounting_service_1.checkPeriodOpen)(db, data.date);
            const entry = db.prepare(`
        INSERT INTO journal_entries (date, reference, description, is_auto, created_by)
        VALUES (?, ?, ?, 0, ?)
      `).run(data.date, data.reference ?? null, data.description, data.created_by ?? 1);
            const entryId = entry.lastInsertRowid;
            for (const line of data.lines) {
                db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)').run(entryId, line.account_id, line.debit ?? 0, line.credit ?? 0, line.notes ?? null);
            }
            return { id: entryId };
        });
        return tx();
    });
}
