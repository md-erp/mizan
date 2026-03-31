import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import type { Supplier, Product } from '../../types'

const schema = z.object({
  date:           z.string().min(1),
  due_date:       z.string().optional(),
  party_id:       z.coerce.number().min(1, 'Fournisseur requis'),
  payment_method: z.string().default('bank'),
  notes:          z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

interface Props { onSaved: () => void; onCancel: () => void }

export default function PurchaseInvoiceForm({ onSaved, onCancel }: Props) {
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
      payment_method: 'bank',
      lines: [{ quantity: 1, unit_price: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')

  useEffect(() => {
    api.getSuppliers({ limit: 200 }).then((r: any) => setSuppliers(r.rows ?? []))
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  function calcLine(l: any) {
    const ht = (l.quantity || 0) * (l.unit_price || 0)
    return { ht, tva: ht * (l.tva_rate || 0) / 100, ttc: ht + ht * (l.tva_rate || 0) / 100 }
  }

  const totals = lines.reduce((acc, l) => {
    const { ht, tva, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tva, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const filteredSuppliers = suppliers.filter(s =>
    !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  ).slice(0, 8)

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'purchase_invoice', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { payment_method: data.payment_method, due_date: data.due_date },
        created_by: 1,
      }) as any
      await api.confirmDocument(doc.id)
      toast('Facture fournisseur enregistrée — Écriture comptable générée')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                  className="w-full px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left text-sm font-medium"
                  onMouseDown={e => { e.preventDefault(); setSelectedSupplier(s); setValue('party_id', s.id); setSupplierSearch(''); setShowSupplierList(false) }}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date facture" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date d'échéance">
          <input {...register('due_date')} className="input" type="date" />
        </FormField>
      </div>

      <FormField label="Mode de paiement">
        <div className="flex gap-2">
          {PAYMENT_METHODS.map(m => (
            <label key={m.value}
              className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${watch('payment_method') === m.value ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}>
              <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Lignes *</label>
          <button type="button" onClick={() => append({ quantity: 1, unit_price: 0, tva_rate: 20 })} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-5">Produit / Description</div>
            <div className="col-span-2 text-right">Qté</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-2 text-right">TVA%</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
              <div className="col-span-5">
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
              <div className="col-span-2">
                <select {...register(`lines.${i}.tva_rate`)} className="input text-xs">
                  {[0,7,10,14,20].map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div className="col-span-1 text-right">
                {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-xl">×</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end text-sm">
        <div className="w-56 space-y-1">
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
          {isSubmitting ? '...' : '✅ Enregistrer facture'}
        </button>
      </div>
    </form>
  )
}
