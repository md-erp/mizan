import type Database from 'better-sqlite3'

/**
 * تحديث أرقام الدفعات القديمة إلى الصيغة الجديدة P-YY-N
 * القديمة: P-1, P-2, P-0001, P-0002, P-0003 ...
 * الجديدة: P-26-1, P-26-2, P-26-3 ...
 */
export function migration_019_normalize_payment_refs(db: Database.Database): void {
  const year = new Date().getFullYear() % 100

  const payments = db.prepare(
    "SELECT id, reference, date FROM payments ORDER BY id ASC"
  ).all() as any[]

  const stmt = db.prepare('UPDATE payments SET reference = ? WHERE id = ?')

  for (const p of payments) {
    const ref: string = p.reference ?? ''

    // تخطي الأرقام التي هي بالفعل بالصيغة الجديدة P-YY-N
    if (/^P-\d{2}-\d+$/.test(ref)) continue

    // استخراج الرقم التسلسلي من الصيغ القديمة: P-1, P-2, P-0001
    const match = ref.match(/^P-0*(\d+)$/)
    if (!match) continue

    const seq = parseInt(match[1], 10)
    if (isNaN(seq) || seq <= 0) continue

    // استخدام سنة الدفعة إذا كانت متوفرة
    const payYear = p.date
      ? new Date(p.date).getFullYear() % 100
      : year

    stmt.run(`P-${payYear}-${seq}`, p.id)
  }
}
