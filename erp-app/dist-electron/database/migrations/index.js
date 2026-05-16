"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const _001_initial_1 = require("./001_initial");
const _002_accounting_1 = require("./002_accounting");
const _003_production_1 = require("./003_production");
const _004_settings_1 = require("./004_settings");
const _005_fix_document_status_1 = require("./005_fix_document_status");
const _006_user_permissions_1 = require("./006_user_permissions");
const _007_user_sessions_1 = require("./007_user_sessions");
const _007_sessions_1 = require("./007_sessions");
const _008_constraints_1 = require("./008_constraints");
const _009_network_sync_1 = require("./009_network_sync");
const _010_change_tracking_1 = require("./010_change_tracking");
const _011_invoice_template_1 = require("./011_invoice_template");
const _012_company_details_1 = require("./012_company_details");
const _013_custom_templates_1 = require("./013_custom_templates");
const _014_payment_reference_1 = require("./014_payment_reference");
const _015_fix_payment_reference_1 = require("./015_fix_payment_reference");
const _016_fill_period_id_1 = require("./016_fill_period_id");
const _017_add_patente_1 = require("./017_add_patente");
const _018_payment_validation_1 = require("./018_payment_validation");
const _019_normalize_payment_refs_1 = require("./019_normalize_payment_refs");
const _020_sequence_recycling_1 = require("./020_sequence_recycling");
const _021_add_global_discount_1 = require("./021_add_global_discount");
const MIGRATIONS = [
    { version: 1, name: 'initial', run: _001_initial_1.migration_001_initial },
    { version: 2, name: 'accounting', run: _002_accounting_1.migration_002_accounting },
    { version: 3, name: 'production', run: _003_production_1.migration_003_production },
    { version: 4, name: 'settings', run: _004_settings_1.migration_004_settings },
    { version: 5, name: 'fix_document_status', run: _005_fix_document_status_1.migration_005_fix_document_status },
    { version: 6, name: 'user_permissions', run: _006_user_permissions_1.migration_006_user_permissions },
    { version: 7, name: 'user_sessions', run: _007_user_sessions_1.migration_007_user_sessions },
    { version: 71, name: 'sessions', run: _007_sessions_1.migration_007_sessions },
    { version: 8, name: 'constraints', run: _008_constraints_1.migration_008_constraints },
    { version: 9, name: 'network_sync', run: _009_network_sync_1.migration_009_network_sync },
    { version: 10, name: 'change_tracking', run: _010_change_tracking_1.migration_010_change_tracking },
    { version: 11, name: 'invoice_template', run: _011_invoice_template_1.migration_011_invoice_template },
    { version: 12, name: 'company_details', run: _012_company_details_1.migration_012_company_details },
    { version: 13, name: 'custom_templates', run: _013_custom_templates_1.migration_013_custom_templates },
    { version: 14, name: 'payment_reference', run: _014_payment_reference_1.migration_014_payment_reference },
    { version: 15, name: 'fix_payment_reference', run: _015_fix_payment_reference_1.migration_015_fix_payment_reference },
    { version: 16, name: 'fill_period_id', run: _016_fill_period_id_1.migration_016_fill_period_id },
    { version: 17, name: 'add_patente', run: _017_add_patente_1.migration_017_add_patente },
    { version: 18, name: 'payment_validation', run: _018_payment_validation_1.migration_018_payment_validation },
    { version: 19, name: 'normalize_payment_refs', run: _019_normalize_payment_refs_1.migration_019_normalize_payment_refs },
    { version: 20, name: 'sequence_recycling', run: _020_sequence_recycling_1.migration_020_sequence_recycling },
    { version: 21, name: 'add_global_discount', run: _021_add_global_discount_1.migration_021_add_global_discount },
];
function runMigrations(db) {
    // جدول تتبع الإصدارات
    db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
    const applied = db
        .prepare('SELECT version FROM _migrations')
        .all()
        .map((r) => r.version);
    for (const migration of MIGRATIONS) {
        if (!applied.includes(migration.version)) {
            console.log(`[Migration] Applying v${migration.version}: ${migration.name}`);
            const tx = db.transaction(() => {
                migration.run(db);
                db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
            });
            tx();
            console.log(`[Migration] v${migration.version} applied ✓`);
        }
    }
}
