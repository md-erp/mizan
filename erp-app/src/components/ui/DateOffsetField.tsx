/**
 * DateOffsetField
 * Champ de date avec un compteur de jours modifiable (+N j).
 * Le décalage est persisté dans localStorage par `storageKey`.
 *
 * Usage:
 *   <DateOffsetField
 *     label="Date d'échéance"
 *     storageKey="offset_due_date"
 *     defaultDays={30}
 *     baseDate={watchedDate}
 *     value={watchedDueDate}
 *     onChange={(iso) => setValue('due_date', iso)}
 *   />
 */

import { useEffect } from 'react'
import { useDateOffset } from '../../hooks/useDateOffset'

interface Props {
  label:       string
  storageKey:  string
  defaultDays: number
  /** Date de référence (YYYY-MM-DD) pour calculer le décalage, ex: date du document */
  baseDate?:   string
  value?:      string
  onChange:    (iso: string) => void
  error?:      string
}

export default function DateOffsetField({
  label, storageKey, defaultDays, baseDate, value, onChange, error,
}: Props) {
  const { days, setDays, computedDate, syncFromDate } = useDateOffset(
    storageKey,
    defaultDays,
    baseDate,
  )

  // Initialiser la valeur du formulaire avec la date calculée au montage
  useEffect(() => {
    if (!value) onChange(computedDate)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculer quand baseDate change (ex: l'utilisateur change la date du document)
  useEffect(() => {
    onChange(computedDate)
  }, [computedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value)
    syncFromDate(e.target.value)
  }

  function handleDaysChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = parseInt(e.target.value, 10)
    if (!isNaN(n) && n >= 0) setDays(Math.min(n, 3650))
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* Champ date principal */}
        <input
          type="date"
          value={value ?? computedDate}
          onChange={handleDateChange}
          className="input flex-1"
        />
        {/* Badge jours modifiable */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">+</span>
          <input
            type="number"
            min="0"
            max="3650"
            value={days}
            onChange={handleDaysChange}
            className="w-14 text-center text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-600
                       bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300
                       focus:outline-none focus:ring-1 focus:ring-blue-400 py-1.5 px-1"
            title="Nombre de jours (max 3650 = 10 ans)"
          />
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">j</span>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
