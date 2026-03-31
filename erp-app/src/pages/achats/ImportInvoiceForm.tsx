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
  party_id:       z.coerce.number().min(1, 'Fournisseur requis'),
  currency:       z.string().default('EUR'),
  exchange_rate:  z.coerce.number().min(0.01),
  invoice_amount: z.coerce.number().min(0),
  customs:        z.coerce.number().min(0).default(0),
  transitaire:    z.coerce.number().min(0).default(0),
  tva_import:     z.coerce.number().min(0).default(0),
  other_costs:    z.coerce.number().min(0).default(0),
  notes:          z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().min(1, 'Produit requis'),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    weight:      z.coerce.number().min(0).default(0),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function ImportInvoiceForm({ onSaved, onCancel }: Props) {
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
      currency: 'EUR', exchange_rate: 10.8,
      invoice_amount: 0, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0,
      lines: [{ product_id: 0, quantity: 1, weight: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const invoiceAmount = watch('invoice_amount')
  const exchangeRate  = watch('exchange_rate')
  const customs       = watch('customs')
  const transitaire   = watch('transitaire')
  const tvaImport     = watch('tva_import')
  const otherCosts    = watch('other_costs')
  const currency      = watch('currency')

  useEffect(() => {
    api.getSuppliers({ limit: 200 }).then((r: any) => setSuppliers(r.rows ?? []))
    api.getProducts({ type: 'raw', limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // حساب Landed Cost
  const invoiceMAD = (invoiceAmount || 0) * (exchangeRate || 1)
  const totalCost  = invoiceMAD + (customs || 0) + (transitaire || 0) + (tvaImport || 0) + (otherCosts || 0)

  // توزيع التكلفة بالتناسب مع الكمية
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const linesWithCost = lines.map(l => ({
    ...l,
    allocated: totalQty > 0 ? (Number(l.quantity) / totalQty) * totalCost : 0,
    unit_cost:  totalQty > 0 && Number(l.quantity) > 0
      ? ((Number(l.quantity) / totalQty) * totalCost) / Number(l.quantity)
      : 0,
  }))

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const filteredSuppliers = suppliers.filter(s =>
    !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  ).slice(0, 8)

  async function onSubmit(data: FormData) {
    try {
      // نبني الـ lines بالأسعار الموزعة
      const docLines = data.lines.map((l, i) => ({
        product_id:  l.product_id,
        description: l.description || products.find(p => p.id === l.product_id)?.name,
        quantity:    l.quantity,
        unit_price:  linesWithCost[i]?.unit_cost ?? 0,
        discount:    0,
        tva_rate:    0,
      }))

      const doc = await api.createDocument({
        type: 'import_invoice', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: docLines, notes: data.notes,
        extra: {
          currency: data.currency, exchange_rate: data.exchange_rate,
          invoice_amount: data.invoice_amount,
          customs: data.customs, transitaire: data.transitaire,
          tva_import: data.tva_import, other_costs: data.other_costs,
          total_cost: totalCost,
        },
        created_by: 1,
      }) as any
      await api.confirmDocument(doc.id)
      toast('Importation enregistrée — Landed Cost réparti et écriture comptable générée')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Fournisseur */}
      <FormField label="Fournisseur étranger" required error={errors.party_id?.message}>
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

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Devise">
          <select {...register('currency')} className="input">
            {['EUR', 'USD', 'GBP', 'CNY', 'AED'].map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label={`Taux de change (1 ${currency} = ? MAD)`}>
          <input {...register('exchange_rate')} className="input" type="number" min="0.01" step="0.01" />
        </FormField>
      </div>

      {/* Coûts */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">💰 Détail des coûts</h3>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={`Montant facture (${currency})`}>
            <input {...register('invoice_amount')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <div className="flex items-end pb-1">
            <span className="text-sm text-gray-500">= {fmt(invoiceMAD)} MAD</span>
          </div>
          <FormField label="Frais de douane (MAD)">
            <input {...register('customs')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="Frais transitaire (MAD)">
            <input {...register('transitaire')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="TVA import (MAD)">
            <input {...register('tva_import')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="Autres frais (MAD)">
            <input {...register('other_costs')} className="input" type="number" min="0" step="0.01" />
          </FormField>
        </div>
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 font-bold">
          <span>Coût total à répartir</span>
          <span className="text-primary text-lg">{fmt(totalCost)} MAD</span>
        </div>
      </div>

      {/* Produits importés */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Produits importés *</label>
          <button type="button" onClick={() => append({ product_id: 0, quantity: 1, weight: 0 })}
            className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-5">Produit</div>
            <div className="col-span-2 text-right">Quantité</div>
            <div className="col-span-2 text-right">Coût alloué</div>
            <div className="col-span-2 text-right">Coût/unité</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
              <div className="col-span-5">
                <select {...register(`lines.${i}.product_id`)} className="input text-xs">
                  <option value={0}>— Produit —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <input {...register(`lines.${i}.quantity`)} className="input text-xs text-right" type="number" min="0.01" step="0.01" />
              </div>
              <div className="col-span-2 text-right text-xs font-medium text-primary">
                {fmt(linesWithCost[i]?.allocated ?? 0)} MAD
              </div>
              <div className="col-span-2 text-right text-xs text-gray-500">
                {fmt(linesWithCost[i]?.unit_cost ?? 0)} MAD
              </div>
              <div className="col-span-1 text-right">
                {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-xl">×</button>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Le coût total est réparti proportionnellement aux quantités
        </p>
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Enregistrer importation'}
        </button>
      </div>
    </form>
  )
}
