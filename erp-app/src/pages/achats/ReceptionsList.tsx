import { fmt } from '../../lib/format'
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ReceptionForm from './ReceptionForm'
import DocumentDetail from '../../components/DocumentDetail'
import SkeletonRows from '../../components/ui/SkeletonRows'
import { docRowBg } from '../../lib/rowBg'
import type { Document, PaginatedResponse } from '../../types'

// fmt imported from lib/format

export default function ReceptionsList() {

  const [data, setData]           = useState<PaginatedResponse<Document> | null>(null)
  const [search, setSearch]       = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTotals, setShowTotals]   = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getDocuments({ type: 'bl_reception', search, page, limit: 50 }) as PaginatedResponse<Document>
      setData(r)
    } finally { setLoading(false) }
  }, [search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])
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
  const active       = rows.filter(d => d.status !== 'cancelled')
  const totalHT      = active.reduce((s, d) => s + d.total_ht, 0)
  const pendingStock = active.filter(d => (d as any).pending_stock_count > 0).length
  const applied      = active.filter(d => (d as any).pending_stock_count === 0).length

  const filtered = rows.filter(d => {
    if (!showCancelled && d.status === 'cancelled') return false
    if (dateFrom && d.date < dateFrom) return false
    if (dateTo   && d.date > dateTo)   return false
    return true
  })

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm" onClick={() => setModalOpen(true)}>
          + Nouveau Bon de Réception
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total BR',       value: String(active.length),     sub: 'Bons de réception actifs',   color: 'text-primary',    bg: 'bg-primary/5' },
          { label: 'Total HT',       value: fmt(totalHT) + ' MAD',     sub: 'Hors annulés',               color: 'text-gray-700 dark:text-gray-200',  bg: 'bg-gray-50 dark:bg-gray-700/30' },
          { label: 'Stock en attente', value: String(pendingStock),     sub: 'Mouvements non appliqués', color: pendingStock > 0 ? 'text-amber-600' : 'text-gray-400', bg: pendingStock > 0 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-gray-700/30', alert: pendingStock > 0 },
          { label: 'Stock appliqué', value: String(applied),           sub: 'Mouvements appliqués',    color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/10' },
        ].map(c => (
          <div key={c.label} className={`card p-4 ${c.bg} ${(c as any).alert ? 'border-amber-200 dark:border-amber-800' : ''}`}>
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input onChange={e => handleSearch(e.target.value)} className="input max-w-xs text-sm" placeholder="Rechercher..." />
        <input value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input w-36 text-sm" type="date" title="Date début" />
        <span className="text-gray-400 text-xs">→</span>
        <input value={dateTo} onChange={e => setDateTo(e.target.value)} className="input w-36 text-sm" type="date" title="Date fin" />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-red-500">✕</button>}
        <button onClick={() => setShowCancelled(v => !v)}
          className={`ml-auto text-xs px-3 py-1.5 rounded-lg border transition-all ${showCancelled ? 'bg-red-50 border-red-200 text-red-600' : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600'}`}>
          🚫 Annulés
        </button>

      </div>

      <div className="card overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '100px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Numéro</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Fournisseur</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total HT</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">TVA</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total TTC</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && <SkeletonRows cols={6} />}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-16">
                <div className="text-4xl mb-3">📥</div>
                <div className="text-gray-500 font-medium">Aucun bon de réception</div>
              </td></tr>
            )}
            {filtered.map(doc => {
              const hasPending = (doc as any).pending_stock_count > 0
              return (
                <tr key={doc.id} onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(doc.id)
                  }}
                  className={`cursor-pointer transition-colors ${docRowBg(doc.status, { pendingStock: hasPending })}`}>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className="font-mono text-xs font-semibold text-primary">{doc.number}</span>
                    {hasPending && <span className="ml-1.5 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">⚠ Stock</span>}
                  </td>
                  <td className="px-3 py-3 text-center align-middle text-gray-500 text-xs">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-3 text-center align-middle font-medium truncate">{doc.party_name ?? '—'}</td>
                  <td className="px-3 py-3 text-center align-middle text-gray-600">{fmt(doc.total_ht)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle text-gray-500 text-xs">{fmt(doc.total_tva)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle font-semibold">{fmt(doc.total_ttc)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className={hasPending ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'}>
                      {hasPending ? '⏳ En attente' : '✅ Appliqué'}
                    </span>
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
            Total — {filtered.length} réception{filtered.length > 1 ? 's' : ''} <span className="text-xs text-gray-400">→ détails</span>
          </span>
          <span className="text-base font-bold text-primary whitespace-nowrap">{fmt(filtered.reduce((s, d) => s + d.total_ht, 0))} MAD HT</span>
        </button>
      )}

      {(data?.total ?? 0) > 50 && (
        <div className="flex items-center justify-between shrink-0 text-xs text-gray-500">
          <span>{data?.total} BR</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">{page} / {Math.ceil((data?.total ?? 0) / 50)}</span>
            <button disabled={page >= Math.ceil((data?.total ?? 0) / 50)} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      <Modal open={showTotals} onClose={() => setShowTotals(false)} title="📊 Récapitulatif — Bons de Réception" size="md">
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total HT',          value: filtered.reduce((s,d)=>s+d.total_ht,0),  color: 'text-primary',    bg: 'bg-primary/5' },
              { label: 'Total TVA',         value: filtered.reduce((s,d)=>s+d.total_tva,0), color: 'text-gray-500',   bg: 'bg-gray-50 dark:bg-gray-700/30' },
              { label: 'Total TTC',         value: filtered.reduce((s,d)=>s+d.total_ttc,0), color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30' },
              { label: 'Stock en attente',  value: filtered.filter(d=>(d as any).pending_stock_count>0).length, isCount: true, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10' },
            ].map(r => (
              <div key={r.label} className={`rounded-xl p-4 ${r.bg}`}>
                <div className="text-xs text-gray-400 mb-1">{r.label}</div>
                <div className={`text-lg font-bold ${r.color}`}>
                  {(r as any).isCount ? r.value : fmt(r.value as number) + ' MAD'}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">État du stock</div>
            <div className="space-y-2">
              {[
                { label: 'Stock appliqué',    count: filtered.filter(d=>(d as any).pending_stock_count===0 && d.status!=='cancelled').length, color: 'text-green-600' },
                { label: 'En attente',        count: filtered.filter(d=>(d as any).pending_stock_count>0).length, color: 'text-amber-600' },
                { label: 'Annulés',           count: filtered.filter(d=>d.status==='cancelled').length, color: 'text-gray-400' },
              ].filter(s=>s.count>0).map(s => (
                <div key={s.label} className="flex justify-between text-sm py-1.5 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-gray-500">{s.label}</span>
                  <span className={`font-semibold ${s.color}`}>{s.count} BR</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t-2 border-primary/20">
            <span className="font-bold text-gray-700 dark:text-gray-200">TOTAL HT GÉNÉRAL</span>
            <span className="text-xl font-bold text-primary">{fmt(filtered.reduce((s,d)=>s+d.total_ht,0))} MAD</span>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau Bon de Réception" size="xl">
        <ReceptionForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>
      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails Bon de Réception">
        {selectedId !== null && <DocumentDetail docId={selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />}
      </Drawer>
    </div>
  )
}
