import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import { toast } from '../../components/ui/Toast'
import type { Product } from '../../types'

interface Props { onSaved: () => void; onCancel: () => void }

export default function ProductionForm({ onSaved, onCancel }: Props) {
  const { user } = useAuthStore()
  const userId = user?.id ?? 1
  const [products, setProducts] = useState<Product[]>([])
  const [boms, setBoms] = useState<any[]>([])
  const [selectedProduct, setSelectedProduct] = useState<number>(0)
  const [selectedBom, setSelectedBom] = useState<number>(0)
  const [quantity, setQuantity] = useState(1)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getProducts({ type: 'finished', limit: 200 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!selectedProduct) { setBoms([]); setSelectedBom(0); setPreview(null); return }
    api.getBomTemplates(selectedProduct).then((r: any) => {
      setBoms(r ?? [])
      const def = (r ?? []).find((b: any) => b.is_default)
      if (def) setSelectedBom(def.id)
    })
  }, [selectedProduct])

  useEffect(() => {
    if (!selectedBom || !quantity) { setPreview(null); return }
    const bom = boms.find(b => b.id === selectedBom)
    if (!bom) return
    const materials_cost = (bom.lines ?? []).reduce((s: number, l: any) => s + l.quantity * quantity * (l.cmup_price ?? 0), 0)
    const unit_cost = (materials_cost + (bom.labor_cost ?? 0)) / quantity
    setPreview({ bom, unit_cost, total_cost: unit_cost * quantity })
  }, [selectedBom, quantity, boms])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) { toast('Choisissez un produit', 'error'); return }
    setLoading(true)
    try {
      await api.createProduction({
        product_id: selectedProduct,
        bom_id: selectedBom || null,
        quantity, date, notes,
        created_by: userId,
      })
      toast('Ordre créé avec succès')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Produit fini <span className="text-red-500">*</span></label>
          <select value={selectedProduct} onChange={e => setSelectedProduct(Number(e.target.value))} className="input" required>
            <option value={0}>— Choisir produit —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quantité à produire <span className="text-red-500">*</span></label>
          <input value={quantity} onChange={e => setQuantity(Number(e.target.value))}
            className="input" type="number" min="0.01" step="0.01" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nomenclature (BOM)</label>
          <select value={selectedBom} onChange={e => setSelectedBom(Number(e.target.value))} className="input">
            <option value={0}>— Sans BOM —</option>
            {boms.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' ★' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input value={date} onChange={e => setDate(e.target.value)} className="input" type="date" />
        </div>
      </div>

      {/* Aperçu BOM */}
      {preview && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-3">
            📋 Aperçu — {preview.bom.name}
          </div>
          <div className="space-y-1 mb-3">
            {(preview.bom.lines ?? []).map((l: any) => (
              <div key={l.id} className="flex justify-between text-xs">
                <span className="text-gray-600">{l.material_name} <span className="text-gray-400">({l.material_code})</span></span>
                <span className="font-medium">{l.quantity * quantity} {l.unit}</span>
              </div>
            ))}
            {preview.bom.labor_cost > 0 && (
              <div className="flex justify-between text-xs border-t border-blue-200 pt-1 mt-1">
                <span className="text-gray-600">Main d'œuvre</span>
                <span className="font-medium">{fmt(preview.bom.labor_cost)} MAD</span>
              </div>
            )}
          </div>
          <div className="flex justify-between text-sm font-bold text-blue-700 dark:text-blue-400 border-t border-blue-200 pt-2">
            <span>Coût unitaire estimé</span>
            <span>{fmt(preview.unit_cost)} MAD</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-blue-700 dark:text-blue-400">
            <span>Coût total ({quantity} unités)</span>
            <span>{fmt(preview.total_cost)} MAD</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none" rows={2} placeholder="Remarques..." />
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? 'Création...' : '✅ Créer l\'ordre'}
        </button>
      </div>
    </form>
  )
}
