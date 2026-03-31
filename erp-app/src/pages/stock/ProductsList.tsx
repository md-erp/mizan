import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ProductForm from '../../components/forms/ProductForm'
import ProductDetail from './ProductDetail'
import ImportButton from '../../components/ImportButton'
import type { Product } from '../../types'

import SkeletonRows from '../../components/ui/SkeletonRows'

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  raw:           { label: 'Matière 1ère', cls: 'badge-blue' },
  finished:      { label: 'Produit fini', cls: 'badge-green' },
  semi_finished: { label: 'Semi-fini',    cls: 'badge-orange' },
}

const TYPE_FILTER = [
  { value: '',              label: 'Tous les types' },
  { value: 'raw',           label: 'Matières premières' },
  { value: 'finished',      label: 'Produits finis' },
  { value: 'semi_finished', label: 'Semi-finis' },
]

export default function ProductsList() {
  const [rows, setRows] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getProducts({ type: typeFilter || undefined, search }) as any
      setRows(result.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [typeFilter, search])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          + Nouveau Produit
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs" placeholder="Rechercher par code ou nom..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-44">
          {TYPE_FILTER.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <ImportButton type="products" onImported={load} />
          <button onClick={async () => {
            try {
              await api.excelExportStock()
              toast('✅ Fichier Excel enregistré')
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">📤 Exporter</button>
        </div>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Désignation</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Unité</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Stock</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">CMUP</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Valeur</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">État</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <SkeletonRows cols={9} />}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-16">
                <div className="text-4xl mb-3">📦</div>
                <div className="text-gray-500 font-medium">Aucun produit</div>
                <button onClick={() => { setEditing(null); setModalOpen(true) }}
                  className="btn-primary mt-3">+ Créer le premier</button>
              </td></tr>
            )}
            {rows.map(p => {
              const isLow = p.min_stock > 0 && p.stock_quantity <= p.min_stock
              const typeBadge = TYPE_BADGE[p.type] ?? { label: p.type, cls: 'badge-gray' }
              return (
                <tr key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{p.code}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={typeBadge.cls}>{typeBadge.label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.unit}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${isLow ? 'text-red-500' : ''}`}>
                    {fmt(p.stock_quantity)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(p.cmup_price)}</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(p.stock_quantity * p.cmup_price)} MAD</td>
                  <td className="px-4 py-3 text-center">
                    <span className={isLow ? 'badge-red' : 'badge-green'}>
                      {isLow ? '⚠ Bas' : '✓ OK'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditing(p); setModalOpen(true) }}
                        className="btn-secondary btn-sm text-xs">✏️</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? 'Modifier Produit' : 'Nouveau Produit'}>
        <ProductForm
          initial={editing ?? undefined}
          onSaved={() => { setModalOpen(false); load() }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Fiche Produit" width="w-[700px]">
        {selectedId !== null && <ProductDetail id={selectedId} onClose={() => setSelectedId(null)} onStockChanged={load} />}
      </Drawer>
    </div>
  )
}
