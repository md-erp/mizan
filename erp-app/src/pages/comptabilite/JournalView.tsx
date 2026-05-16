import { fmt } from '../../lib/format'
import NumberInput from '../../components/ui/NumberInput'
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Pagination from '../../components/ui/Pagination'
import Modal from '../../components/ui/Modal'
import { useAuthStore } from '../../store/auth.store'
import type { JournalEntry } from '../../types'

const LIMIT = 50

// ── Formulaire de saisie manuelle ────────────────────────────────────────────
function ManualEntryForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { user } = useAuthStore()
  const [accounts, setAccounts] = useState<any[]>([])
  const [date, setDate]         = useState(new Date().toISOString().split('T')[0])
  const [ref, setRef]           = useState('')
  const [desc, setDesc]         = useState('')
  const [lines, setLines]       = useState([
    { account_id: '', debit: '', credit: '', notes: '' },
    { account_id: '', debit: '', credit: '', notes: '' },
  ])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getAccounts().then((r: any) => setAccounts(r ?? [])).catch(() => {})
  }, [])
  function addLine() {
    setLines(l => [...l, { account_id: '', debit: '', credit: '', notes: '' }])
  }

  function removeLine(i: number) {
    if (lines.length <= 2) return
    setLines(l => l.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: string, value: string) {
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: value } : line))
  }

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01
  // fmt imported from lib/format

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!desc.trim()) { toast('Description obligatoire', 'error'); return }
    if (!isBalanced)  { toast('Le journal doit être équilibré (Débit = Crédit)', 'error'); return }
    const validLines = lines.filter(l => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
    if (validLines.length < 2) { toast('Minimum 2 lignes avec montants', 'error'); return }

    setSaving(true)
    try {
      await api.createManualEntry({
        date, reference: ref || null, description: desc,
        created_by: user?.id ?? 1,
        lines: validLines.map(l => ({
          account_id: Number(l.account_id),
          debit:  parseFloat(l.debit)  || 0,
          credit: parseFloat(l.credit) || 0,
          notes:  l.notes || null,
        })),
      })
      toast('Écriture enregistrée')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={e => { e.stopPropagation(); handleSubmit(e) }} className="space-y-4 p-1">
      {/* En-tête */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Référence</label>
          <input value={ref} onChange={e => setRef(e.target.value)} className="input" placeholder="OD-001" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Description *</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} className="input" placeholder="Ex: Salaires mars" required />
        </div>
      </div>

      {/* Lignes */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50">
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Compte *</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Débit</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Crédit</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Libellé</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">
                  <select value={line.account_id} onChange={e => updateLine(i, 'account_id', e.target.value)}
                    className="input text-xs w-full">
                    <option value="">— Choisir —</option>
                    {accounts.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <NumberInput decimals={2} min="0" value={line.debit}
                    onChange={e => updateLine(i, 'debit', e.target.value)}
                    className="input text-xs text-right w-full"
                    placeholder="0.00" />
                </td>
                <td className="px-2 py-1.5">
                  <NumberInput decimals={2} min="0" value={line.credit}
                    onChange={e => updateLine(i, 'credit', e.target.value)}
                    className="input text-xs text-right w-full"
                    placeholder="0.00" />
                </td>
                <td className="px-2 py-1.5">
                  <input value={line.notes} onChange={e => updateLine(i, 'notes', e.target.value)}
                    className="input text-xs w-full" placeholder="Libellé ligne" />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button type="button" onClick={() => removeLine(i)}
                    className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={`font-semibold text-sm ${isBalanced ? 'text-green-600' : 'text-red-500'}`}>
              <td className="px-3 py-2 text-xs text-gray-500">
                <button type="button" onClick={addLine} className="text-primary hover:underline text-xs">
                  + Ajouter une ligne
                </button>
              </td>
              <td className="px-3 py-2 text-right">{fmt(totalDebit)}</td>
              <td className="px-3 py-2 text-right">{fmt(totalCredit)}</td>
              <td colSpan={2} className="px-3 py-2 text-xs">
                {isBalanced ? '✓ Équilibré' : `Écart: ${fmt(Math.abs(totalDebit - totalCredit))}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={saving || !isBalanced}
          className="btn-primary flex-1 justify-center disabled:opacity-50">
          {saving ? '...' : '✅ Enregistrer'}
        </button>
      </div>
    </form>
  )
}

export default function JournalView() {
  const [entries, setEntries]   = useState<JournalEntry[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'auto' | 'manual'>('all')
  const [accountFilter, setAccountFilter] = useState('')

  // Default: start of current year → today
  const _today = new Date()
  const [startDate, setStartDate] = useState(`${_today.getFullYear()}-01-01`)
  const [endDate, setEndDate]     = useState(_today.toISOString().split('T')[0])
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getJournalEntries({
        start_date: startDate || undefined,
        end_date:   endDate   || undefined,
        page,
        limit: LIMIT,
      }) as any
      if (Array.isArray(result)) {
        setEntries(result)
        setTotal(result.length)
      } else {
        setEntries(result.rows ?? result)
        setTotal(result.total ?? result.length)
      }
    } finally { setLoading(false) }
  }, [startDate, endDate, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  // reset page عند تغيير الفلاتر
  useEffect(() => { setPage(1) }, [startDate, endDate, typeFilter, accountFilter])

  // تطبيق الفلاتر على الـ entries المحملة
  const filteredEntries = entries.filter(e => {
    if (typeFilter === 'auto'   && !e.is_auto) return false
    if (typeFilter === 'manual' &&  e.is_auto) return false
    if (accountFilter) {
      const hasAccount = e.lines?.some((l: any) =>
        l.account_code?.toLowerCase().includes(accountFilter.toLowerCase()) ||
        l.account_name?.toLowerCase().includes(accountFilter.toLowerCase())
      )
      if (!hasAccount) return false
    }
    return true
  })

  // fmt imported from lib/format

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Du</label>
          <input value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" type="date" />
          <label className="text-sm text-gray-500">au</label>
          <input value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" type="date" />
        </div>
        <button onClick={load} className="btn-secondary btn-sm">↻ Actualiser</button>
        {/* فلتر النوع */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
          {([['all','Tous'],['auto','Auto'],['manual','Manuel']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`px-3 py-1.5 transition-all ${typeFilter === v ? 'bg-primary text-white' : 'bg-white dark:bg-gray-800 text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
        {/* فلتر الحساب */}
        <input value={accountFilter} onChange={e => setAccountFilter(e.target.value)}
          className="input text-sm w-40" placeholder="Filtrer par compte..." />
        <span className="text-sm text-gray-500 ml-auto">{filteredEntries.length} écriture(s)</span>
        <button onClick={() => setShowModal(true)} className="btn-primary btn-sm">
          + Saisie manuelle
        </button>
      </div>

      {/* Entries */}
      <div className="space-y-2">
        {loading && (
          [...Array(5)].map((_, i) => (
            <div key={i} className="card px-4 py-3 animate-pulse flex items-center gap-4">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-28"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded flex-1"></div>
            </div>
          ))
        )}
        {!loading && filteredEntries.length === 0 && (
          <div className="card p-12 text-center text-gray-400">
            <div className="text-4xl mb-3">📒</div>
            <div>Aucune écriture comptable</div>
            <div className="text-xs mt-1">Les écritures sont générées automatiquement lors de la confirmation des documents</div>
          </div>
        )}
        {!loading && filteredEntries.map(e => (
          <div key={e.id} className="card overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left">
              <span className="text-xs text-gray-400 w-20 shrink-0">
                {new Date(e.date).toLocaleDateString('fr-FR')}
              </span>
              <span className="font-mono text-xs text-primary w-28 shrink-0">{e.reference}</span>
              <span className="text-sm flex-1">{e.description}</span>
              {e.is_auto && <span className="badge-blue text-xs">Auto</span>}
              <span className="text-gray-400 text-xs">{expanded === e.id ? '▲' : '▼'}</span>
            </button>
            {expanded === e.id && e.lines && (
              <table className="w-full text-xs border-t border-gray-100 dark:border-gray-700 border-collapse" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '80px' }} />
                  <col />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '120px' }} />
                </colgroup>
                <thead className="bg-gray-50 dark:bg-gray-700/50 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-center align-middle font-medium text-gray-500">Compte</th>
                    <th className="px-4 py-2 text-center align-middle font-medium text-gray-500">Intitulé</th>
                    <th className="px-4 py-2 text-center align-middle font-medium text-gray-500">Débit</th>
                    <th className="px-4 py-2 text-center align-middle font-medium text-gray-500">Crédit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
                  {e.lines.map((l, i) => (
                    <tr key={i} className={l.debit > 0 ? 'bg-green-50/30' : 'bg-red-50/30'}>
                      <td className="px-4 py-2 text-center align-middle font-mono font-bold text-primary">{l.account_code}</td>
                      <td className="px-4 py-2 text-center align-middle text-gray-600">{l.account_name}</td>
                      <td className="px-4 py-2 text-center align-middle font-semibold text-green-700">
                        {l.debit > 0 ? fmt(l.debit) : ''}
                      </td>
                      <td className="px-4 py-2 text-center align-middle font-semibold text-red-600">
                        {l.credit > 0 ? fmt(l.credit) : ''}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 dark:bg-gray-700/50 font-bold">
                    <td colSpan={2} className="px-4 py-2 text-center align-middle text-gray-500">Total</td>
                    <td className="px-4 py-2 text-center align-middle text-green-700">
                      {fmt(e.lines.reduce((s, l) => s + l.debit, 0))}
                    </td>
                    <td className="px-4 py-2 text-center align-middle text-red-600">
                      {fmt(e.lines.reduce((s, l) => s + l.credit, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title="Saisie d'écriture manuelle" size="xl">
        <ManualEntryForm
          onSaved={() => { setShowModal(false); load() }}
          onCancel={() => setShowModal(false)}
        />
      </Modal>
    </div>
  )
}
