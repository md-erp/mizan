import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'

// أنواع المستندات التي تستخدم السنة في الرقم — الكل الآن يستخدم السنة
const WITH_YEAR = new Set([
  'invoice', 'quote', 'bl', 'proforma', 'avoir',
  'purchase_order', 'bl_reception', 'purchase_invoice', 'import_invoice',
  'payment',
])

const DOC_PREFIXES: Record<string, string> = {
  invoice:          'F',
  quote:            'D',
  bl:               'BL',
  proforma:         'PRO',
  avoir:            'AV',
  purchase_order:   'BC',
  bl_reception:     'BR',
  purchase_invoice: 'FF',
  import_invoice:   'IMP',
  payment:          'P',
}

interface Props {
  docType: string
  onSeqChange: (seq: number | undefined) => void
}

function formatNumber(prefix: string, year: number, seq: number, withYear: boolean): string {
  return withYear ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`
}

export default function DocumentNumberField({ docType, onSeqChange }: Props) {
  const [nextSeq, setNextSeq]     = useState<number>(1)
  const [year, setYear]           = useState<number>(new Date().getFullYear() % 100)
  const [prefix, setPrefix]       = useState<string>('')
  const [editing, setEditing]     = useState(false)
  const [inputVal, setInputVal]   = useState('')
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)
  const [checking, setChecking]     = useState(false)
  const [checkError, setCheckError] = useState('')
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [recycledNum, setRecycledNum] = useState<string | null>(null)
  // نستخدم ref لتجنب infinite loop في useEffect
  const onSeqChangeRef = useRef(onSeqChange)
  onSeqChangeRef.current = onSeqChange

  const useYear = WITH_YEAR.has(docType)

  useEffect(() => {
    setLoading(true)
    setError('')
    setCustomSeq(undefined)
    const p = DOC_PREFIXES[docType] ?? 'DOC'
    setPrefix(p)

    api.sequencesGetNext({ doc_type: docType })
      .then((r: any) => {
        setNextSeq(r.next ?? 1)
        setYear(r.year ?? new Date().getFullYear() % 100)
        setInputVal(String(r.next ?? 1))
        onSeqChangeRef.current(undefined)
      })
      .catch(() => {
        setError('Impossible de charger la séquence')
        setNextSeq(1)
        onSeqChangeRef.current(undefined)
      })
      .finally(() => setLoading(false))

    // جلب الرقم المعاد تدويره إن وجد
    ;(api as any).sequencesGetRecycled(docType)
      .then((r: string | null) => setRecycledNum(r))
      .catch(() => setRecycledNum(null))
  }, [docType])

  const displaySeq = customSeq ?? nextSeq
  const displayNum = formatNumber(prefix, year, displaySeq, useYear)

  function handleEdit() {
    setInputVal(String(displaySeq))
    setEditing(true)
  }

  async function handleConfirm() {
    const val = parseInt(inputVal, 10)
    if (isNaN(val) || val < 1) {
      setEditing(false)
      return
    }

    setChecking(true)
    setCheckError('')
    try {
      const result = await api.sequencesCheck({ doc_type: docType, seq: val }) as any
      if (!result.available) {
        setCheckError(
          `Numéro déjà utilisé — prochain disponible: ${
            useYear
              ? `${prefix}-${year}-${result.suggestion}`
              : `${prefix}-${result.suggestion}`
          }`
        )
        return // لا نغلق الـ editing — المستخدم يرى الخطأ
      }
      setCustomSeq(val)
      onSeqChangeRef.current(val)
      setCheckError('')
      setEditing(false)
    } catch {
      // في حالة خطأ في الشبكة نسمح بالمتابعة — الـ Backend سيرفض عند الحفظ
      setCustomSeq(val)
      onSeqChangeRef.current(val)
      setEditing(false)
    } finally {
      setChecking(false)
    }
  }

  function handleReset() {
    setCustomSeq(undefined)
    onSeqChangeRef.current(undefined)
    setEditing(false)
  }

  function handleUseRecycled() {
    if (!recycledNum) return
    // استخراج الرقم من النص مثل F-26-3 → 3
    const parts = recycledNum.split('-')
    const seq = parseInt(parts[parts.length - 1])
    if (isNaN(seq)) return
    setCustomSeq(seq)
    onSeqChangeRef.current(seq)
    setRecycledNum(null)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-36 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
        <div className="h-4 w-16 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
      </div>
    )
  }

  if (error) {
    return <span className="text-xs text-red-500">{error}</span>
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* عرض الرقم */}
      <div className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 font-mono text-sm">
        <span className="text-gray-400 text-xs">
          {useYear ? `${prefix}-${year}-` : `${prefix}-`}
        </span>
        <span className={`font-bold tabular-nums ${customSeq !== undefined ? 'text-primary' : 'text-gray-700 dark:text-gray-200'}`}>
          {displaySeq}
        </span>
        {customSeq !== undefined && (
          <span className="ml-1.5 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-sans">
            modifié
          </span>
        )}
      </div>

      {/* زر التعديل */}
      {!editing && (
        <button
          type="button"
          onClick={handleEdit}
          className="text-xs text-gray-400 hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
          title="Changer le numéro de départ"
        >
          ✏️ Modifier
        </button>
      )}

      {/* زر إعادة التدوير — يظهر فقط إذا كان هناك رقم متاح */}
      {!editing && recycledNum && (
        <button
          type="button"
          onClick={handleUseRecycled}
          className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 whitespace-nowrap border border-amber-200 dark:border-amber-700"
          title={`Réutiliser le numéro supprimé: ${recycledNum}`}
        >
          ♻️ {recycledNum}
        </button>
      )}

      {/* panneau de modification */}
      {editing && (
        <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-primary/40 rounded-lg px-3 py-1.5 shadow-lg">
          <span className="text-xs text-gray-400 font-mono whitespace-nowrap">
            {useYear ? `${prefix}-${year}-` : `${prefix}-`}
          </span>
          <input
            type="number"
            min="1"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            className="w-20 text-sm font-mono border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-primary"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); handleConfirm() }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button type="button" onClick={handleConfirm}
            disabled={checking}
            className="text-xs bg-primary text-white px-2.5 py-1 rounded hover:bg-primary/90 font-medium disabled:opacity-50">
            {checking ? '...' : '✓'}
          </button>
          {customSeq !== undefined && (
            <button type="button" onClick={handleReset}
              className="text-xs text-gray-400 hover:text-amber-500 px-1 transition-colors"
              title="Réinitialiser au numéro automatique">
              ↺
            </button>
          )}
          <button type="button" onClick={() => { setEditing(false); setCheckError('') }}
            className="text-gray-400 hover:text-red-500 transition-colors px-1">
            ✕
          </button>
        </div>
      )}
      {checkError && (
        <span className="text-xs text-red-500 font-medium">{checkError}</span>
      )}

      {/* aperçu du numéro complet */}
      <span className="text-xs text-gray-400 font-mono hidden sm:block">
        → {displayNum}
      </span>
    </div>
  )
}
