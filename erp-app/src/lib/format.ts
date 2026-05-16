/**
 * format.ts — دوال التنسيق المركزية للنظام
 *
 * القاعدة الموحدة: كل الأرقام المالية والكميات لا تتجاوز رقمين بعد الفاصلة.
 * minimumFractionDigits: 2  → دائماً رقمان (1.00 وليس 1)
 * maximumFractionDigits: 2  → لا يتجاوز رقمين (1.01 وليس 1.001)
 */

const NUMBER_FORMAT = new Intl.NumberFormat('fr-MA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * تنسيق رقم مالي — دائماً رقمان بعد الفاصلة بالضبط
 * مثال: 1234.5 → "1 234,50"
 */
export function fmt(n: number | null | undefined): string {
  return NUMBER_FORMAT.format(n ?? 0)
}

/**
 * تقريب رقم مالي إلى رقمين بعد الفاصلة (ROUND_HALF_UP)
 * يُستخدم في الحسابات قبل العرض
 */
export function roundAmt(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * تنسيق نسبة مئوية — رقم واحد بعد الفاصلة
 * مثال: 12.345 → "12,3%"
 */
export function fmtPct(n: number | null | undefined): string {
  return `${(n ?? 0).toFixed(1)}%`
}

/**
 * تنسيق حجم ملف — رقم واحد بعد الفاصلة (KB/MB)
 * هذا ليس رقماً مالياً لذا يبقى بـ toFixed(1)
 */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
