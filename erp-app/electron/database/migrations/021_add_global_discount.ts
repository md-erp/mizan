import Database from 'better-sqlite3'

/**
 * Migration 021: إضافة حقل global_discount للجداول الفرعية
 * 
 * يضيف حقل global_discount (خصم عام بالنسبة المئوية) للجداول التالية:
 * - doc_invoices (فواتير البيع)
 * - doc_quotes (ديفيس)
 * - doc_bons_livraison (بونات التسليم)
 * - doc_proformas (بروفورما)
 * - doc_avoirs (أفوار)
 * - doc_purchase_invoices (فواتير الشراء)
 * - doc_purchase_orders (طلبات الشراء)
 */
export function migration_021_add_global_discount(db: Database.Database): void {
  console.log('🔄 Migration 021: إضافة حقل global_discount...')

  db.exec(`
    -- إضافة global_discount لجميع الجداول الفرعية
    ALTER TABLE doc_invoices ADD COLUMN global_discount REAL DEFAULT 0;
    ALTER TABLE doc_quotes ADD COLUMN global_discount REAL DEFAULT 0;
    ALTER TABLE doc_bons_livraison ADD COLUMN global_discount REAL DEFAULT 0;
    ALTER TABLE doc_proformas ADD COLUMN global_discount REAL DEFAULT 0;
    ALTER TABLE doc_avoirs ADD COLUMN global_discount REAL DEFAULT 0;
    ALTER TABLE doc_purchase_invoices ADD COLUMN global_discount REAL DEFAULT 0;
    
    -- إضافة للـ purchase_orders إذا كان الجدول موجوداً
    -- (قد يكون تم إنشاؤه في migration لاحق)
  `)

  // التحقق من وجود جدول doc_purchase_orders وإضافة الحقل إذا كان موجوداً
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='doc_purchase_orders'
  `).get()

  if (tableExists) {
    db.exec(`ALTER TABLE doc_purchase_orders ADD COLUMN global_discount REAL DEFAULT 0;`)
  }

  console.log('✅ Migration 021: تم إضافة global_discount بنجاح')
}
