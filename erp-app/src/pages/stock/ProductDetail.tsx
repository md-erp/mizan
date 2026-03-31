import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import type { Product, StockMovement } from '../../types'

interface Props { id: number; onClose?: () => void; onStockChanged?: () => void }

type Tab = 'movements' | 'info'

export default function ProductDetail({ id, onStockChanged }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [tab, setTab] = useState<Tab>('movements')
  const [manualModal, setManualModal] = useState(false)
  const [manualForm, setManualForm] = useState({ type: 'in', quantity: 1, unit_cost: 0, notes: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, m] = await Promise.all([
        api.getProduct(id) as unknown as Promise<Product>,
        api.getStockMovements({ product_id: id }) as Promise<StockMovement[]>,
      ])
      setProduct(p)
      setMovements(m ?? [])
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleApply(movId: number) {
    try {
      await api.applyStockMovement(movId)
      load()
      onStockChanged?.()
    } catch (e: any) { alert(e.message) }
  }

  async function handleManual(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.createManualMovement({
        product_id: id,
        type: manualForm.type,
        quantity: manualForm.quantity,
        unit_cost: manualForm.unit_cost,
        notes: manualForm.notes,
        date: new Date().toISOString().split('T')[0],
        created_by: 1,
      })
      setManualModal(false)
      setManualForm({ type: 'in', quantity: 1, unit_cost: 0, notes: '' })
      load()
      onStockChanged?.()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Chargement...</div>
  if (!product) return <div className="flex items-center justify-center h-64 text-gray-400">Introuvable</div>

  const isLow = product.stock_quantity <= product.min_stock

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{product.code}</span>
              <span className={`text-xs ${product.type === 'raw' ? 'badge-blue' : product.type === 'finished' ? 'badge-green' : 'badge-orange'}`}>
                {product.type === 'raw' ? 'Matière première' : product.type === 'finished' ? 'Produit fini' : 'Semi-fini'}
              </span>
            </div>
            <h2 className="text-xl font-bold mt-1">{product.name}</h2>
            <div className="text-sm text-gray-500 mt-1">Unité: {product.unit}</div>
          </div>
          <button onClick={() => setManualModal(true)} className="btn-secondary btn-sm">
            + Mouvement manuel
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Stock actuel', value: `${fmt(product.stock_quantity)} ${product.unit}`, color: isLow ? 'text-red-500' : 'text-green-600', bold: true },
            { label: 'Stock minimum', value: `${fmt(product.min_stock)} ${product.unit}`, color: 'text-gray-600' },
            { label: 'CMUP', value: `${fmt(product.cmup_price)} MAD`, color: 'text-gray-700' },
            { label: 'Valeur stock', value: `${fmt(product.stock_quantity * product.cmup_price)} MAD`, color: 'text-primary', bold: true },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">{s.label}</div>
              <div className={`text-sm ${s.bold ? 'font-bold' : 'font-medium'} ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {isLow && (
          <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 dark:text-red-400">
            ⚠️ Stock insuffisant — en dessous du minimum ({fmt(product.min_stock)} {product.unit})
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5">
          {([
            { id: 'movements', label: `Mouvements (${movements.length})` },
            { id: 'info',      label: 'Informations' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'movements' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Type</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Quantité</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Coût unit.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">CMUP avant→après</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Source</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Statut</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {movements.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Aucun mouvement</td></tr>
              )}
              {movements.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-gray-500 text-xs">{new Date(m.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={m.type === 'in' ? 'badge-green' : 'badge-red'}>
                      {m.type === 'in' ? '▲ Entrée' : '▼ Sortie'}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${m.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                    {m.type === 'in' ? '+' : '-'}{fmt(m.quantity)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">{fmt(m.unit_cost)}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    {m.applied
                      ? `${fmt(m.cmup_before)} → ${fmt(m.cmup_after)}`
                      : `${fmt(m.cmup_before)} → ?`}
                  </td>
                  <td className="px-3 py-2 text-xs text-primary">
                    {m.document_id ? `Doc #${m.document_id}` :
                     m.production_id ? `Prod #${m.production_id}` :
                     m.transformation_id ? `Trans #${m.transformation_id}` :
                     m.manual_ref ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {m.applied
                      ? <span className="badge-green text-xs">✅</span>
                      : <span className="badge-orange text-xs">⏳</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
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
        )}

        {tab === 'info' && (
          <div className="space-y-3 max-w-sm">
            {[
              { label: 'Code',          value: product.code },
              { label: 'Désignation',   value: product.name },
              { label: 'Type',          value: product.type },
              { label: 'Unité',         value: product.unit },
              { label: 'Prix de vente', value: `${fmt(product.sale_price)} MAD` },
              { label: 'Stock minimum', value: `${fmt(product.min_stock)} ${product.unit}` },
            ].map(f => (
              <div key={f.label} className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm text-gray-500">{f.label}</span>
                <span className="text-sm font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual movement modal */}
      <Modal open={manualModal} onClose={() => setManualModal(false)} title="Mouvement de stock manuel">
        <form onSubmit={handleManual} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type de mouvement</label>
            <div className="flex gap-3">
              {[{ v: 'in', l: '▲ Entrée', c: 'border-green-400 bg-green-50 text-green-700' },
                { v: 'out', l: '▼ Sortie', c: 'border-red-400 bg-red-50 text-red-700' }].map(o => (
                <label key={o.v} className={`flex-1 text-center py-3 rounded-lg border-2 cursor-pointer font-medium transition-all
                  ${manualForm.type === o.v ? o.c : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <input type="radio" value={o.v} checked={manualForm.type === o.v}
                    onChange={e => setManualForm(f => ({ ...f, type: e.target.value }))} className="hidden" />
                  {o.l}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Quantité *</label>
              <input value={manualForm.quantity} onChange={e => setManualForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                className="input" type="number" min="0.01" step="0.01" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Coût unitaire (MAD)</label>
              <input value={manualForm.unit_cost} onChange={e => setManualForm(f => ({ ...f, unit_cost: Number(e.target.value) }))}
                className="input" type="number" min="0" step="0.01" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Motif / Notes</label>
            <textarea value={manualForm.notes} onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))}
              className="input resize-none" rows={2} placeholder="Inventaire, ajustement, perte..." />
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => setManualModal(false)} className="btn-secondary flex-1 justify-center">Annuler</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? '...' : '✅ Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
