import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import type { Supplier, Product } from '../../types'

const lineSchema = z.object({
  product_id:  z.number().optional(),
  description: z.string().optional(),
  quantity:    z.coerce.number().min(0.01),
  unit_price:  z.coerce.number().min(0),
  discount:    z.coerce.number().min(0).max(100).default(0),
  tva_rate:    z.coerce.number().default(20),
})

const schema = z.object({
  date:                  z.string().min(1),
  expected_delivery_date: z.string().optional(),
  party_id:              z.coerce.number().min(1, 'Fournisseur requis'),
  notes:                 z.string().optional(),
  lines:                 z.array(lineSchema).min(1),
})

type FormData = z.infer<typeof schema>

const TVA_RATES = [0, 7, 10, 14, 20]

interface Props { onSaved: () => void; onCancel: () => void }

export default function PurchaseOrderForm({ onSaved, onCancel }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierList, setShowSupplierList] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')

  useEffect(() => {
    api.getSuppliers({ limit: 200 }).then((r: any) => setSuppliers(r.rows ?? []))
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  function calcLine(line: any) {
    const ht = (line.quantity || 0) * (line.unit_price || 0) * (1 - (line.discount || 0) / 100)
    return { ht, tva: ht * (line.tva_rate || 0) / 100, ttc: ht + ht * (line.tva_rate || 0) / 100 }
  }

  const totals = lines.reduce((acc, l) => {
    const { ht, tva, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tva, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const filteredSuppliers = suppliers.filter(s =>
    !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || (s.ice ?? '').includes(supplierSearch)
  ).slice(0, 8)

  async function onSubmit(data: FormData) {
    try {
      await api.createDocument({
        type: 'purchase_order', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { expected_delivery_date: data.expected_delivery_date },
        created_by: 1,
      })
      toast('Bon de commande créé')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Fournisseur */}
      <FormField label="Fournisseur" required error={errors.party_id?.message}>
        <div className="relative">
          <input
            value={selectedSupplier ? selectedSupplier.name : supplierSearch}
            onChange={e => { setSupplierSearch(e.target.value); setSelectedSupplier(null); setValue('party_id', 0); setShowSupplierList(true) }}
            onFocus={() => setShowSupplierList(true)}
            className={`input ${errors.party_id ? 'input-error' : ''}`}
            placeholder="Rechercher un fournisseur..."
          />
          {showSupplierList && filteredSuppliers.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
              {filteredSuppliers.map(s => (
                <button key={s.id} type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                  onMouseDown={e => { e.preventDefault(); setSelectedSupplier(s); setValue('party_id', s.id); setSupplierSearch(''); setShowSupplierList(false) }}>
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    {s.ice && <div className="text-xs text-gray-400 font-mono">ICE: {s.ice}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date de livraison prévue">
          <input {...register('expected_delivery_date')} className="input" type="date" />
        </FormField>
      </div>

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Lignes *</label>
          <button type="button" onClick={() => append({ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 })}
            className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-4">Produit / Description</div>
            <div className="col-span-2 text-right">Qté</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-1 text-right">Rem%</div>
            <div className="col-span-1 text-right">TVA%</div>
            <div className="col-span-1 text-right">TTC</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => {
            const { ttc } = calcLine(lines[i] ?? {})
            return (
              <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
                <div className="col-span-4">
                  <select className="input text-xs" onChange={e => {
                    const p = products.find(p => p.id === Number(e.target.value))
                    if (p) { setValue(`lines.${i}.product_id`, p.id); setValue(`lines.${i}.description`, p.name); setValue(`lines.${i}.tva_rate`, p.tva_rate_value ?? 20) }
                  }} defaultValue="">
                    <option value="">— Produit —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                  <input {...register(`lines.${i}.description`)} className="input text-xs mt-1" placeholder="Description..." />
                </div>
                <div className="col-span-2"><input {...register(`lines.${i}.quantity`)} className="input text-xs text-right" type="number" min="0.01" step="0.01" /></div>
                <div className="col-span-2"><input {...register(`lines.${i}.unit_price`)} className="input text-xs text-right" type="number" min="0" step="0.01" /></div>
                <div className="col-span-1"><input {...register(`lines.${i}.discount`)} className="input text-xs text-right" type="number" min="0" max="100" /></div>
                <div className="col-span-1">
                  <select {...register(`lines.${i}.tva_rate`)} className="input text-xs">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
                <div className="col-span-1 text-right text-xs font-semibold">{fmt(ttc)}</div>
                <div className="col-span-1 text-right">
                  {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-xl">×</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Totaux */}
      <div className="flex justify-end">
        <div className="w-56 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Total HT</span><span>{fmt(totals.ht)} MAD</span></div>
          <div className="flex justify-between text-gray-600"><span>TVA</span><span>{fmt(totals.tva)} MAD</span></div>
          <div className="flex justify-between font-bold border-t border-gray-200 pt-1">
            <span>Total TTC</span><span className="text-primary">{fmt(totals.ttc)} MAD</span>
          </div>
        </div>
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Créer BC'}
        </button>
      </div>
    </form>
  )
}
