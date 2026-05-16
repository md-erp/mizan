import Database from 'better-sqlite3'

export function migration_018_payment_validation(db: Database.Database): void {
  // إضافة constraint للتحقق من أن المبلغ موجب
  // ملاحظة: SQLite لا يدعم ALTER TABLE ADD CONSTRAINT مباشرة
  // لذلك نحتاج إلى إعادة إنشاء الجدول
  
  db.exec(`
    -- إنشاء جدول مؤقت بالـ constraint الجديد
    CREATE TABLE payment_allocations_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id  INTEGER NOT NULL REFERENCES payments(id),
      document_id INTEGER NOT NULL REFERENCES documents(id),
      amount      REAL NOT NULL CHECK (amount > 0)
    );

    -- نسخ البيانات الموجودة
    INSERT INTO payment_allocations_new (id, payment_id, document_id, amount)
    SELECT id, payment_id, document_id, amount FROM payment_allocations;

    -- حذف الجدول القديم
    DROP TABLE payment_allocations;

    -- إعادة تسمية الجدول الجديد
    ALTER TABLE payment_allocations_new RENAME TO payment_allocations;

    -- إعادة إنشاء الفهارس
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_document ON payment_allocations(document_id);

    -- ✅ إضافة trigger للتحقق من عدم تجاوز المبلغ الإجمالي
    CREATE TRIGGER IF NOT EXISTS check_payment_allocation_amount
    BEFORE INSERT ON payment_allocations
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN (
          SELECT COALESCE(SUM(amount), 0) + NEW.amount
          FROM payment_allocations
          WHERE document_id = NEW.document_id
        ) > (
          SELECT total_ttc + 0.01
          FROM documents
          WHERE id = NEW.document_id
        )
        THEN RAISE(ABORT, 'Le montant total des paiements dépasse le total de la facture')
      END;
    END;
  `)
}
