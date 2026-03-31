import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Pagination from '../../components/ui/Pagination'
import type { StockMovement } from '../../types'

const LIMIT = 50

export default function MovementsList() {
  const [rows, setRows]     = useState<StockMovement[]>([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'applied'>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const applied = filter === 'all' ? undefined : filter === 'applied'
      const result = await api.getStockMovements({ applied, page, limit: LIMIT }) as any
      // handler يرجع array أو paginated object
      if (Array.isArray(result)) {
        setRows(result)
        setTotal(result.length)
      } else {
        setRows(result.rows ?? result)
        setTotal(result.total ?? result.length)
      }
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => { load() }, [load])

  // reset page عند تغيير الفلتر
  useEffect(() => { setPage(1) }, [filter])

  async function handleApply(id: number) {
    try {
      await api.applyStockMovement(id)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  function getSource(m: StockMovement): string {
    if (m.document_id)       return `Document #${m.document_id}`
    if (m.production_id)     return `Production #${m.production_id}`
    if (m.transformation_id) return `Transformation #${m.transformation_id}`
    if (m.manual_ref)        return m.manual_ref
    return '—'
  }

  const filtered = rows.filter(m =>
    !search || m.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.product_code?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(['all', 'pending', 'applied'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${filter === f
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'all' ? 'Tous' : f === 'pending' ? '⏳ En attente' : '✅ Appliqués'}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input max-w-xs"
          placeholder="Rechercher un produit..."
        />
        <button onClick={load} className="btn-secondary btn-sm ml-auto">↻ Actualiser</button>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Produit</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Mouvement</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Quantité</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût unit.</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">CMUP avant → après</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Statut</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(9)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    </td>
                  ))}
                </tr>
              ))
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-16">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-gray-500 font-medium">Aucun mouvement</div>
                <div className="text-gray-400 text-xs mt-1">Les mouvements apparaissent lors de la confirmation des documents</div>
              </td></tr>
            )}
            {!loading && filtered.map(m => (
              <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {new Date(m.date).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{m.product_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{m.product_code} · {m.unit}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold
                    ${m.type === 'in'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {m.type === 'in' ? '▲ Entrée' : '▼ Sortie'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-bold text-base ${m.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                    {m.type === 'in' ? '+' : '-'}{fmt(m.quantity)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600 text-xs">{fmt(m.unit_cost)} MAD</td>
                <td className="px-4 py-3 text-right text-xs text-gray-500">
                  {m.applied
                    ? <span>{fmt(m.cmup_before)} <span className="text-gray-300">→</span> <span className="font-medium text-gray-700 dark:text-gray-300">{fmt(m.cmup_after)}</span></span>
                    : <span className="text-gray-400">{fmt(m.cmup_before)} → ?</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs text-primary font-medium">{getSource(m)}</div>
                  {m.notes && <div className="text-xs text-gray-400 mt-0.5">{m.notes}</div>}
                </td>
                <td className="px-4 py-3 text-center">
                  {m.applied
                    ? <span className="badge-green">✅ Appliqué</span>
                    : <span className="badge-orange">⏳ En attente</span>
                  }
                </td>
                <td className="px-4 py-3 text-right">
                  {!m.applied && (
                    <button onClick={() => handleApply(m.id)} className="btn-primary btn-sm text-xs">
                      Appliquer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{total} mouvement(s)</span>
          <span className="text-green-600">▲ entrées: {filtered.filter(m => m.type === 'in').length}</span>
          <span className="text-red-500">▼ sorties: {filtered.filter(m => m.type === 'out').length}</span>
          <span className="text-orange-500">⏳ en attente: {filtered.filter(m => !m.applied).length}</span>
        </div>
        <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
      </div>
    </div>
  )
}
