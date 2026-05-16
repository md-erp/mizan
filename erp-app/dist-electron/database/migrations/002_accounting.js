"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migration_002_accounting = migration_002_accounting;
function migration_002_accounting(db) {
    db.exec(`
    -- ==========================================
    -- ACCOUNTING PERIODS
    -- ==========================================
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      status     TEXT DEFAULT 'open', -- 'open'|'closed'|'locked'
      closed_by  INTEGER REFERENCES users(id),
      closed_at  DATETIME,
      notes      TEXT
    );

    -- ==========================================
    -- CHART OF ACCOUNTS (Plan Comptable CGNC)
    -- ==========================================
    CREATE TABLE IF NOT EXISTS accounts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      code      TEXT NOT NULL UNIQUE,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL, -- 'asset'|'liability'|'equity'|'revenue'|'expense'
      class     INTEGER NOT NULL, -- 1-7
      parent_id INTEGER REFERENCES accounts(id),
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0 -- حسابات النظام لا تُحذف
    );

    -- ==========================================
    -- JOURNAL ENTRIES
    -- ==========================================
    CREATE TABLE IF NOT EXISTS journal_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      period_id   INTEGER REFERENCES accounting_periods(id),
      reference   TEXT,
      description TEXT NOT NULL,
      is_auto     INTEGER DEFAULT 0, -- 1 = قيد تلقائي
      source_type TEXT, -- 'invoice'|'payment'|'reception'|'production'|...
      source_id   INTEGER,
      created_by  INTEGER REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id  INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      debit     REAL DEFAULT 0,
      credit    REAL DEFAULT 0,
      notes     TEXT
    );

    -- ==========================================
    -- INDEXES
    -- ==========================================
    CREATE INDEX IF NOT EXISTS idx_journal_entries_period  ON journal_entries(period_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_source  ON journal_entries(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_entry     ON journal_lines(entry_id);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_account   ON journal_lines(account_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_code           ON accounts(code);
    CREATE INDEX IF NOT EXISTS idx_accounts_class          ON accounts(class);
  `);
    // Plan Comptable CGNC — الحسابات الأساسية المستخدمة في التطبيق
    db.exec(`
    INSERT OR IGNORE INTO accounts (code, name, type, class, is_system) VALUES
      -- Classe 1
      ('1111', 'Capital social',                    'equity',    1, 1),
      -- Classe 3
      ('3121', 'Matières premières',                'asset',     3, 1),
      ('3151', 'Produits finis',                    'asset',     3, 1),
      ('3421', 'Clients',                           'asset',     3, 1),
      ('3425', 'Effets à recevoir',                 'asset',     3, 1),
      ('3455', 'État — TVA récupérable sur charges','asset',     3, 1),
      ('3456', 'État — Crédit de TVA',              'asset',     3, 1),
      -- Classe 4
      ('4411', 'Fournisseurs',                      'liability', 4, 1),
      ('4415', 'Effets à payer',                    'liability', 4, 1),
      ('4455', 'État — TVA facturée',               'liability', 4, 1),
      ('4456', 'État — TVA due',                    'liability', 4, 1),
      ('4481', 'Dettes sur acquisitions',           'liability', 4, 1),
      -- Classe 5
      ('5141', 'Banques',                           'asset',     5, 1),
      ('5161', 'Caisses',                           'asset',     5, 1),
      -- Classe 6
      ('6111', 'Achats de marchandises',            'expense',   6, 1),
      ('6121', 'Achats de matières premières',      'expense',   6, 1),
      -- Classe 7
      ('7111', 'Ventes de marchandises',            'revenue',   7, 1),
      ('7121', 'Ventes de biens produits',          'revenue',   7, 1),
      ('7131', 'Variation des stocks de produits',  'revenue',   7, 1);
  `);
    // ربط TVA rates بالحسابات
    db.exec(`
    UPDATE tva_rates SET
      account_facturee_id   = (SELECT id FROM accounts WHERE code = '4455'),
      account_recuperable_id = (SELECT id FROM accounts WHERE code = '3455')
    WHERE id IN (1,2,3,4,5);
  `);
}
