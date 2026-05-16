/**
 * rowBg — خلفية صف الجدول حسب الحالة
 * تُستخدم في كل الجداول بدلاً من الشارات النصية
 */

/** حالات المستندات */
export function docRowBg(status: string, extra?: {
  overdue?: boolean
  pendingStock?: boolean
  selected?: boolean
}): string {
  if (extra?.overdue)
    return 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100/80 dark:hover:bg-red-900/30'
  if (extra?.pendingStock)
    return 'bg-amber-50/60 dark:bg-amber-900/15 hover:bg-amber-100/70 dark:hover:bg-amber-900/25'
  if (extra?.selected)
    return 'bg-primary/5 dark:bg-primary/10 hover:bg-primary/8 dark:hover:bg-primary/15'

  switch (status) {
    case 'draft':
      return 'bg-slate-50/80 dark:bg-slate-800/40 hover:bg-slate-100/80 dark:hover:bg-slate-700/40'
    case 'confirmed':
      return 'bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-100/60 dark:hover:bg-blue-900/20'
    case 'partial':
      return 'bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-100/60 dark:hover:bg-amber-900/20'
    case 'paid':
    case 'received':
    case 'delivered':
      return 'bg-emerald-50/50 dark:bg-emerald-900/10 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/20'
    case 'cancelled':
      return 'bg-gray-50/60 dark:bg-gray-800/30 hover:bg-gray-100/60 dark:hover:bg-gray-700/30 opacity-60'
    default:
      return 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
  }
}

/** حالات حركات المخزون */
export function movementRowBg(applied: number, type: 'in' | 'out'): string {
  if (applied === -1)
    return 'bg-gray-50/60 dark:bg-gray-800/30 hover:bg-gray-100/60 dark:hover:bg-gray-700/30 opacity-50'
  if (applied === 0)
    return 'bg-amber-50/60 dark:bg-amber-900/15 hover:bg-amber-100/70 dark:hover:bg-amber-900/25'
  // applied === 1
  return type === 'in'
    ? 'bg-emerald-50/40 dark:bg-emerald-900/10 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20'
    : 'bg-red-50/30 dark:bg-red-900/10 hover:bg-red-100/40 dark:hover:bg-red-900/15'
}

/** حالات المنتجات (مخزون) */
export function productRowBg(stockQty: number, minStock: number): string {
  if (minStock > 0 && stockQty <= 0)
    return 'bg-red-50/60 dark:bg-red-900/15 hover:bg-red-100/70 dark:hover:bg-red-900/25'
  if (minStock > 0 && stockQty <= minStock)
    return 'bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-100/60 dark:hover:bg-amber-900/20'
  return 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
}
