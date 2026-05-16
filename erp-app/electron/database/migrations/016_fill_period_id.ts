/**
 * Migration 016 — Remplir period_id dans journal_entries
 *
 * المشكلة 4: حقل period_id كان موجوداً في الجدول لكن لم يُملأ قط
 * عند إنشاء القيود التلقائية. هذه الهجرة تملأ القيود الموجودة
 * بالفترة المحاسبية الصحيحة بناءً على تاريخ كل قيد.
 *
 * السلوك:
 * - يُحدَّث كل قيد بـ period_id = الفترة التي يقع تاريخه فيها
 * - القيود التي لا تقع في أي فترة → تبقى period_id = NULL (لا خطأ)
 * - العملية كاملة في transaction واحدة
 */
import Database from 'better-sqlite3'

export function migration_016_fill_period_id(db: Database.Database): void {
  const tx = db.transaction(() => {
    // ملء period_id للقيود التي تقع في فترة محاسبية معروفة
    db.exec(`
      UPDATE journal_entries
      SET period_id = (
        SELECT ap.id
        FROM accounting_periods ap
        WHERE ap.start_date <= journal_entries.date
          AND ap.end_date   >= journal_entries.date
        ORDER BY ap.start_date DESC
        LIMIT 1
      )
      WHERE period_id IS NULL
    `)

    const updated = db.prepare(
      `SELECT COUNT(*) as c FROM journal_entries WHERE period_id IS NOT NULL`
    ).get() as any
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM journal_entries`
    ).get() as any
    const noperiod = db.prepare(
      `SELECT COUNT(*) as c FROM journal_entries WHERE period_id IS NULL`
    ).get() as any

    console.log(
      `[Migration 016] period_id renseigné: ${updated.c}/${total.c} écritures` +
      (noperiod.c > 0 ? ` — ${noperiod.c} sans période (aucune période configurée pour ces dates)` : ' ✓')
    )
  })

  tx()
}
