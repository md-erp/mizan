import { fmt } from '../../lib/format'
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import PurchaseInvoiceForm from './PurchaseInvoiceForm'
import DocumentDetail from '../../components/DocumentDetail'
import SkeletonRows from '../../components/ui/SkeletonRows'
import { docRowBg } from '../../lib/rowBg'
import type { Document, PaginatedResponse } from '../../types'

// fmt imported from lib/format

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  confirmed: { label: 'Impayée',   cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  partial:   { label: 'Partiel',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  paid:      { label: 'Payée',     cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  cancelled: { label: 'Annulée',   cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
}

const FILTER_TABS = [
  { key: 'all',       label: 'Toutes' },
  { key: 'confirmed', label: 'Impayées' },
  { key: 'partial',   label: 'Partiels' },
  { key: 'paid',      label: 'Payées' },
]

export default function PurchaseInvoicesList() {

  const [data, setData]           = useState<PaginatedResponse<Document> | null>(null)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTotals, setShowTotals]   = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters: any = { type: 'purchase_invoice', page, limit: 50 }
      if (search) filters.search = search
      if (statusFilter !== 'all') filters.status = statusFilter
      const r = await api.getDocuments(filters) as PaginatedResponse<Document>
      setData(r)
    } finally { setLoading(false) }
  }, [search, statusFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  function handleSearch(v: string) {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setSearch(v), 300)
  }

  const rows = data?.rows ?? []
  const active    = rows.filter(d => d.status !== 'cancelled')
  const totalTTC  = active.reduce((s, d) => s + d.total_ttc, 0)
  const unpaid    = active.filter(d => ['confirmed', 'partial'].includes(d.status)).length
  const unpaidAmt = active.filter(d => ['confirmed', 'partial'].includes(d.status)).reduce((s, d) => s + d.total_ttc, 0)

  const filtered = rows.filter(d => {
    if (d.status === 'cancelled' && statusFilter !== 'cancelled') return false
    if (dateFrom && d.date < dateFrom) return false
    if (dateTo   && d.date > dateTo)   return false
    return true
  })

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm" onClick={() => setModalOpen(true)}>
          + Nouvelle Facture Fournisseur
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total factures', value: String(active.length),     sub: 'Hors annulées',          color: 'text-primary',    bg: 'bg-primary/5' },
          { label: 'Total TTC',      value: fmt(totalTTC) + ' MAD',    sub: 'Hors annulées',           color: 'text-gray-700 dark:text-gray-200',  bg: 'bg-gray-50 dark:bg-gray-700/30' },
          { label: 'Impayées',       value: String(unpaid),            sub: fmt(unpaidAmt) + ' MAD',   color: unpaid > 0 ? 'text-red-500' : 'text-gray-400', bg: unpaid > 0 ? 'bg-red-50 dark:bg-red-900/10' : 'bg-gray-50 dark:bg-gray-700/30', alert: unpaid > 0 },
          { label: 'Payées',         value: String(active.filter(d => d.status === 'paid').length), sub: 'Soldées', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10' },
        ].map(c => (
          <div key={c.label} className={`card p-4 ${c.bg} ${(c as any).alert ? 'border-red-200 dark:border-red-800' : ''}`}>
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input onChange={e => handleSearch(e.target.value)} className="input max-w-xs text-sm" placeholder="Rechercher..." />
        <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }} className="input w-36 text-sm">
          {FILTER_TABS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input w-36 text-sm" type="date" title="Date début" />
        <span className="text-gray-400 text-xs">→</span>
        <input value={dateTo} onChange={e => setDateTo(e.target.value)} className="input w-36 text-sm" type="date" title="Date fin" />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-red-500">✕</button>}
      </div>

      <div className="card overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Numéro</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Fournisseur</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total HT</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total TTC</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && <SkeletonRows cols={6} />}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">🧾</div>
                <div className="text-gray-500 font-medium">Aucune facture fournisseur</div>
                <div className="text-gray-400 text-xs mt-1">{statusFilter !== 'all' ? 'Essayez un autre filtre' : 'Créez votre première facture'}</div>
              </td></tr>
            )}
            {filtered.map(doc => {
              const cfg = STATUS_CFG[doc.status] ?? STATUS_CFG.draft
              return (
                <tr key={doc.id} onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(doc.id)
                  }}
                  className={`cursor-pointer transition-colors ${docRowBg(doc.status)}`}>
                  <td className="px-3 py-3 text-center align-middle"><span className="font-mono text-xs font-semibold text-primary">{doc.number}</span></td>
                  <td className="px-3 py-3 text-center align-middle text-gray-500 text-xs">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-3 text-center align-middle font-medium truncate">{doc.party_name ?? '—'}</td>
                  <td className="px-3 py-3 text-center align-middle text-gray-600">{fmt(doc.total_ht)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle font-semibold">{fmt(doc.total_ttc)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 && (
        <button onClick={() => setShowTotals(true)}
          className="shrink-0 flex items-center justify-between px-4 py-2.5 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors w-full text-left">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Total — {filtered.length} facture{filtered.length > 1 ? 's' : ''} <span className="text-xs text-gray-400">→ détails</span>
          </span>
          <span className="text-base font-bold text-primary whitespace-nowrap">{fmt(filtered.reduce((s, d) => s + d.total_ttc, 0))} MAD</span>
        </button>
      )}

      {(data?.total ?? 0) > 50 && (
        <div className="flex items-center justify-between shrink-0 text-xs text-gray-500">
          <span>{data?.total} facture(s)</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">{page} / {Math.ceil((data?.total ?? 0) / 50)}</span>
            <button disabled={page >= Math.ceil((data?.total ?? 0) / 50)} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      <Modal open={showTotals} onClose={() => setShowTotals(false)} title="📊 Récapitulatif — Factures Fournisseurs" size="md">
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total HT',   value: filtered.reduce((s,d)=>s+d.total_ht,0),  color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30' },
              { label: 'Total TVA',  value: filtered.reduce((s,d)=>s+d.total_tva,0), color: 'text-gray-500',                    bg: 'bg-gray-50 dark:bg-gray-700/30' },
              { label: 'Impayées',   value: filtered.filter(d=>['confirmed','partial'].includes(d.status)).reduce((s,d)=>s+d.total_ttc,0), color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/10' },
              { label: 'Payées',     value: filtered.filter(d=>d.status==='paid').reduce((s,d)=>s+d.total_ttc,0), color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10' },
            ].map(r => (
              <div key={r.label} className={`rounded-xl p-4 ${r.bg}`}>
                <div className="text-xs text-gray-400 mb-1">{r.label}</div>
                <div className={`text-lg font-bold ${r.color}`}>{fmt(r.value)} MAD</div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Répartition par statut</div>
            <div className="space-y-1.5">
              {[
                { key: 'draft',     label: 'Brouillons', color: 'text-gray-500' },
                { key: 'confirmed', label: 'Impayées',   color: 'text-red-600' },
                { key: 'partial',   label: 'Partiels',   color: 'text-amber-600' },
                { key: 'paid',      label: 'Payées',     color: 'text-green-600' },
                { key: 'cancelled', label: 'Annulées',   color: 'text-gray-400' },
              ].map(s => {
                const count = (data?.rows??[]).filter(d=>d.status===s.key).length
                if (!count) return null
                const amt = (data?.rows??[]).filter(d=>d.status===s.key).reduce((a,d)=>a+d.total_ttc,0)
                const pct = (data?.rows??[]).length > 0 ? (count/(data?.rows??[]).length)*100 : 0
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="text-xs text-gray-500 w-20 shrink-0">{s.label}</div>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full" style={{width:`${pct}%`}} />
                    </div>
                    <div className={`text-xs font-semibold w-5 text-right ${s.color}`}>{count}</div>
                    <div className="text-xs text-gray-400 w-28 text-right">{fmt(amt)} MAD</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t-2 border-primary/20">
            <span className="font-bold text-gray-700 dark:text-gray-200">TOTAL TTC GÉNÉRAL</span>
            <span className="text-xl font-bold text-primary">{fmt(filtered.reduce((s,d)=>s+d.total_ttc,0))} MAD</span>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle Facture Fournisseur" size="xl">
        <PurchaseInvoiceForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>
      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails Facture Fournisseur">
        {selectedId !== null && <DocumentDetail docId={selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />}
      </Drawer>
    </div>
  )
}
