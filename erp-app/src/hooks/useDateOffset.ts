/**
 * useDateOffset
 * Gère un décalage de jours (ex: +30 j pour l'échéance) avec persistance localStorage.
 *
 * @param storageKey  Clé localStorage unique par type de champ (ex: 'offset_due_date')
 * @param defaultDays Valeur par défaut si rien n'est stocké
 * @param baseDate    Date de référence (YYYY-MM-DD), par défaut aujourd'hui
 */

import { useState, useCallback } from 'react'

/** Limite قصوى للأيام — 3650 يوم = 10 سنوات */
const MAX_DAYS = 3650

function addDaysToDate(base: string, days: number): string {
  // التحقق من صحة التاريخ الأساسي
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    return new Date().toISOString().split('T')[0]
  }
  const d = new Date(base + 'T00:00:00')
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0]
  }
  // تقييد الأيام لمنع تجاوز نطاق التاريخ
  const safeDays = Math.min(Math.max(0, days), MAX_DAYS)
  d.setDate(d.getDate() + safeDays)
  // التحقق من صحة النتيجة
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0]
  }
  return d.toISOString().split('T')[0]
}

function diffDays(base: string, target: string): number {
  if (!base || !target) return 0
  const a = new Date(base + 'T00:00:00')
  const b = new Date(target + 'T00:00:00')
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function useDateOffset(
  storageKey: string,
  defaultDays: number,
  baseDate?: string,
) {
  const today = new Date().toISOString().split('T')[0]
  const base  = baseDate ?? today

  // Lire la valeur sauvegardée ou utiliser la valeur par défaut
  const [days, setDaysState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        const parsed = parseInt(saved, 10)
        // تجاهل القيم غير الصالحة أو المتجاوزة للحد
        if (!isNaN(parsed) && parsed >= 0 && parsed <= MAX_DAYS) return parsed
      }
    } catch {}
    return Math.min(defaultDays, MAX_DAYS)
  })

  // Calculer la date cible à partir du décalage
  const computedDate = addDaysToDate(base, days)

  // Mettre à jour le décalage et le sauvegarder
  const setDays = useCallback((n: number) => {
    // تقييد القيمة بين 0 و MAX_DAYS
    const clamped = Math.min(Math.max(0, Math.round(n)), MAX_DAYS)
    setDaysState(clamped)
    try { localStorage.setItem(storageKey, String(clamped)) } catch {}
  }, [storageKey])

  // Recalculer le décalage quand l'utilisateur change la date manuellement
  const syncFromDate = useCallback((dateStr: string) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return
    const d = diffDays(base, dateStr)
    if (d >= 0 && d <= MAX_DAYS) {
      setDaysState(d)
      try { localStorage.setItem(storageKey, String(d)) } catch {}
    }
  }, [base, storageKey])

  return { days, setDays, computedDate, syncFromDate }
}
