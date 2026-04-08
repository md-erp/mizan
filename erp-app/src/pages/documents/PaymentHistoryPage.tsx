import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Drawer from '../../components/ui/Drawer'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

const METHOD_LABELS: Record<string, string> = {
  cash: '💵 Espèces', bank: '🏦 Virement', cheque: '📝 Chèque', lcn: '📋 LCN',
}
const STATUS_CLS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  cleared:   'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  collected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  bounced:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente', cleared: 'Encaissé', collected: 'Encaissé',
  bounced: 'Impayé', cancelled: 'Annulé',
}

// ── Payment Detail Drawer ────────────────────────────────────────────────────
function PaymentDetail({ payment, onClose, onClear, onBounce }: {
  payment: any
  onClose: () => void
  onClear: (id: number) => void
  onBounce: (id: number) => void
}) {
  const isCheque = payment.method === 'cheque' || payment.method === 'lcn'
  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-bold text-primary">
            {METHOD_LABELS[payment.method] ?? payment.method}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {new Date(payment.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_CLS[payment.status] ?? STATUS_CLS.pending}`}>
          {STATUS_LABELS[payment.status] ?? payment.status}
        </span>
      </div>

      {/* Partie */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3">
        <div className="text-xs text-gray-400 mb-1">
          {payment.party_type === 'client' ? 'Client' : 'Fournisseur'}
        </div>
        <div className="font-semibold">{payment.party_name ?? '—'}</div>
      </div>

      {/* Montant */}
      <div className="bg-primary/5 rounded-lg px-4 py-4 text-center">
        <div className="text-xs text-gray-400 mb-1">Montant</div>
        <div className="text-2xl font-bold text-primary">{fmt(payment.amount)} MAD</div>
      </div>

      {/* Détails */}
      <div className="space-y-2 text-sm">
        {payment.document_number && (
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">Facture</span>
            <span className="font-mono font-semibold text-primary">{payment.document_number}</span>
          </div>
        )}
        {!payment.document_number && (
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">Imputation</span>
            <span className="text-gray-400 italic">Avance générale</span>
          </div>
        )}
        {isCheque && payment.cheque_number && (
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">
              {payment.method === 'lcn' ? 'N° LCN' : 'N° Chèque'}
            </span>
            <span className="font-mono font-semibold">{payment.cheque_number}</span>
          </div>
        )}
        {payment.bank && (
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">Banque</span>
            <span className="font-medium">{payment.bank}</span>
          </div>
        )}
        {payment.due_date && (
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">Date d'échéance</span>
            <span className="font-medium">
              {new Date(payment.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {payment.notes && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
            {payment.notes}
          </div>
        )}
      </div>

      {/* Actions pour chèques en attente */}
      {isCheque && payment.status === 'pending' && (
        <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => { onBounce(payment.id); onClose() }}
            className="btn-secondary flex-1 justify-center text-red-500 border-red-200 hover:bg-red-50">
            ✗ Marquer impayé
          </button>
          <button
            onClick={() => { onClear(payment.id); onClose() }}
            className="btn-primary flex-1 justify-center">
            ✅ Encaisser
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function PaymentHistoryPage() {
  const [payments, setPayments]     = useState<any[]>([])
  const [loading, setLoading]       = useState(false)
  const [partyType, setPartyType]   = useState<'all' | 'client' | 'supplier'>('client')
  const [method, setMethod]         = useState('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<any | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters: any = {}
      if (partyType !== 'all') filters.party_type = partyType
      const result = await api.getPayments(filters) as any[]
      setPayments(result ?? [])
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [partyType])

  useEffect(() => { load() }, [load])

  async function handleClear(id: number) {
    try {
      await api.updatePayment({ id, status: 'cleared' })
      toast('✅ Chèque encaissé — Facture mise à jour')
      load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  async function handleBounce(id: number) {
    try {
      await api.updatePayment({ id, status: 'bounced' })
      toast('Chèque marqué impayé', 'warning')
      load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const filtered = payments.filter(p => {
    if (method !== 'all' && p.method !== method) return false
    if (dateFrom && p.date < dateFrom) return false
    if (dateTo   && p.date > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !p.party_name?.toLowerCase().includes(q) &&
        !p.document_number?.toLowerCase().includes(q) &&
        !p.cheque_number?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const totalAmount = filtered.reduce((s, p) => s + (p.amount ?? 0), 0)
  const byCash   = filtered.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const byBank   = filtered.filter(p => p.method === 'bank').reduce((s, p) => s + p.amount, 0)
  const byCheque = filtered.filter(p => p.method === 'cheque' || p.method === 'lcn').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="h-full flex flex-col gap-3">

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total encaissé', value: fmt(totalAmount) + ' MAD', sub: `${filtered.length} paiement(s)`, color: 'text-primary',    bg: 'bg-primary/5' },
          { label: '💵 Espèces',     value: fmt(byCash)    + ' MAD',   sub: '',                               color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10' },
          { label: '🏦 Virement',    value: fmt(byBank)    + ' MAD',   sub: '',                               color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/10' },
          { label: '📝 Chèques/LCN', value: fmt(byCheque)  + ' MAD',   sub: '',                               color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10' },
        ].map(c => (
          <div key={c.label} className={`card p-4 ${c.bg}`}>
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            {c.sub && <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs text-sm" placeholder="Rechercher client, facture..." />
        <select value={partyType} onChange={e => setPartyType(e.target.value as any)} className="input w-36 text-sm">
          <option value="all">Tous</option>
          <option value="client">Clients</option>
          <option value="supplier">Fournisseurs</option>
        </select>
        <select value={method} onChange={e => setMethod(e.target.value)} className="input w-36 text-sm">
          <option value="all">Tous modes</option>
          <option value="cash">Espèces</option>
          <option value="bank">Virement</option>
          <option value="cheque">Chèque</option>
          <option value="lcn">LCN</option>
        </select>
        <input value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input w-36 text-sm" type="date" />
        <span className="text-gray-400 text-xs">→</span>
        <input value={dateTo} onChange={e => setDateTo(e.target.value)} className="input w-36 text-sm" type="date" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-red-500">✕</button>
        )}
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: '96px' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '72px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Date</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Client / Fournisseur</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Mode</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Référence</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Échéance</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Montant</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Statut</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(8)].map((_, j) => (
                  <td key={j} className="px-3 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16">
                  <div className="text-4xl mb-3">💳</div>
                  <div className="text-gray-500 font-medium">Aucun paiement</div>
                  <div className="text-gray-400 text-xs mt-1">Ajustez les filtres</div>
                </td>
              </tr>
            )}
            {!loading && filtered.map((p, i) => (
              <tr key={p.id ?? i}
                onClick={() => setSelected(p)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(p.date).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium text-sm truncate">{p.party_name ?? '—'}</div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <span>{p.party_type === 'client' ? 'Client' : 'Fournisseur'}</span>
                    {p.document_number && (
                      <><span className="text-gray-300">·</span>
                      <span className="font-mono text-primary">{p.document_number}</span></>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="px-3 py-3 text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                  {p.cheque_number ?? (p.bank ?? '—')}
                </td>
                <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {p.due_date ? new Date(p.due_date).toLocaleDateString('fr-FR') : '—'}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-primary whitespace-nowrap">
                  {fmt(p.amount)} MAD
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLS[p.status] ?? STATUS_CLS.pending}`}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                  {(p.method === 'cheque' || p.method === 'lcn') && p.status === 'pending' && (
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => handleClear(p.id)} title="Encaisser"
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-100 hover:bg-green-200 dark:bg-green-900/40 transition-colors text-sm">
                        ✅
                      </button>
                      <button onClick={() => handleBounce(p.id)} title="Impayé"
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-900/40 transition-colors text-sm font-bold text-red-600">
                        ✗
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-600">
                <td colSpan={5} className="px-3 py-3 text-sm font-semibold text-gray-500">
                  Total ({filtered.length} paiement{filtered.length > 1 ? 's' : ''})
                </td>
                <td className="px-3 py-3 text-right font-bold text-primary whitespace-nowrap">
                  {fmt(totalAmount)} MAD
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Detail Drawer */}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title="Détails du paiement">
        {selected && (
          <PaymentDetail
            payment={selected}
            onClose={() => setSelected(null)}
            onClear={handleClear}
            onBounce={handleBounce}
          />
        )}
      </Drawer>
    </div>
  )
}
