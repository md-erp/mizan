import { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/auth.store'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import type { Product } from '../../types'

interface OutputLine { product_id: number; quantity: number }
interface Props { onSaved: () => void; onCancel: () => void }

export default function TransformationForm({ onSaved, onCancel }: Props) {
  const [rawMaterials, setRawMaterials] = useState<Product[]>([])
  const [finishedProducts, setFinishedProducts] = useState<Product[]>([])
  const [materialId, setMaterialId] = useState(0)
  const [inputQty, setInputQty] = useState(1)
  const [costPerUnit, setCostPerUnit] = useState(0)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [outputs, setOutputs] = useState<OutputLine[]>([{ product_id: 0, quantity: 0 }])
  const { user } = useAuthStore()
  const userId = user?.id ?? 1
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getProducts({ type: 'raw', limit: 200 }).then((r: any) => setRawMaterials(r.rows ?? []))
    api.getProducts({ type: 'finished', limit: 200 }).then((r: any) => setFinishedProducts(r.rows ?? []))
  }, [])

  const selectedMaterial = rawMaterials.find(m => m.id === materialId)
  const material_cost = (selectedMaterial?.cmup_price ?? 0) * inputQty
  const transform_cost = costPerUnit * inputQty
  const total_cost = material_cost + transform_cost

  function addOutput() { setOutputs(prev => [...prev, { product_id: 0, quantity: 0 }]) }
  function removeOutput(i: number) { setOutputs(prev => prev.filter((_, idx) => idx !== i)) }
  function updateOutput(i: number, field: keyof OutputLine, value: number) {
    setOutputs(prev => prev.map((o, idx) => idx === i ? { ...o, [field]: value } : o))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!materialId) { toast('Choisissez une matière première', 'error'); return }
    if (outputs.some(o => !o.product_id || o.quantity <= 0)) {
      toast('Vérifiez les produits de sortie', 'error'); return
    }
    setLoading(true)
    try {
      await api.createTransformation({
        raw_material_id: materialId,
        input_quantity: inputQty,
        cost_per_unit: costPerUnit,
        date, notes, outputs,
        created_by: userId,
      })
      toast('Transformation créée — Stock mis à jour')
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
      {/* Matière première */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Matière première <span className="text-red-500">*</span></label>
          <select value={materialId} onChange={e => setMaterialId(Number(e.target.value))} className="input" required>
            <option value={0}>— Choisir —</option>
            {rawMaterials.map(p => (
              <option key={p.id} value={p.id}>{p.code} — {p.name} (Stock: {p.stock_quantity} {p.unit})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quantité entrée</label>
          <input value={inputQty} onChange={e => setInputQty(Number(e.target.value))}
            className="input" type="number" min="0.01" step="0.01" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Coût de transformation / unité (MAD)</label>
          <input value={costPerUnit} onChange={e => setCostPerUnit(Number(e.target.value))}
            className="input" type="number" min="0" step="0.01" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input value={date} onChange={e => setDate(e.target.value)} className="input" type="date" />
        </div>
      </div>

      {/* Résumé coûts */}
      {materialId > 0 && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Coût matière ({fmt(selectedMaterial?.cmup_price ?? 0)} × {inputQty})</span>
            <span className="font-medium">{fmt(material_cost)} MAD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Coût transformation ({fmt(costPerUnit)} × {inputQty})</span>
            <span className="font-medium">{fmt(transform_cost)} MAD</span>
          </div>
          <div className="flex justify-between font-bold border-t border-gray-200 dark:border-gray-600 pt-1">
            <span>Coût total à répartir</span>
            <span className="text-primary">{fmt(total_cost)} MAD</span>
          </div>
        </div>
      )}

      {/* Produits de sortie */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Produits obtenus <span className="text-red-500">*</span></label>
          <button type="button" onClick={addOutput} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="space-y-2">
          {outputs.map((o, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select value={o.product_id} onChange={e => updateOutput(i, 'product_id', Number(e.target.value))}
                className="input flex-1">
                <option value={0}>— Produit obtenu —</option>
                {finishedProducts.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
              <input value={o.quantity} onChange={e => updateOutput(i, 'quantity', Number(e.target.value))}
                className="input w-28" type="number" min="0.01" step="0.01" placeholder="Qté" />
              {outputs.length > 1 && (
                <button type="button" onClick={() => removeOutput(i)}
                  className="text-red-400 hover:text-red-600 text-xl">×</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none" rows={2} placeholder="Remarques..." />
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? 'Traitement...' : '✅ Confirmer la transformation'}
        </button>
      </div>
    </form>
  )
}
