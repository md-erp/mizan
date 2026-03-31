import { useState, useEffect, useRef } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import Modal from '../ui/Modal'
import PartyForm from './PartyForm'
import type { Client, Product } from '../../types'

const lineSchema = z.object({
  product_id:  z.number().optional(),
  description: z.string().optional(),
  quantity:    z.coerce.number().min(0.01, 'Qté > 0'),
  unit_price:  z.coerce.number().min(0, 'Prix ≥ 0'),
  discount:    z.coerce.number().min(0).max(100, 'Remise 0-100%'),
  tva_rate:    z.coerce.number(),
}).refine(d => d.product_id || (d.description && d.description.trim().length > 0), {
  message: 'Produit ou description requis',
  path: ['description'],
})

const schema = z.object({
  date:           z.string().min(1, 'Date requise'),
  due_date:       z.string().optional(),
  party_id:       z.coerce.number().min(1, 'Client / Fournisseur requis'),
  payment_method: z.string().optional(),
  currency:       z.string().default('MAD'),
  exchange_rate:  z.coerce.number().min(0.0001, 'Taux invalide').default(1),
  notes:          z.string().optional(),
  lines:          z.array(lineSchema).min(1, 'Au moins une ligne requise'),
})

type FormData = z.infer<typeof schema>

const TVA_RATES = [0, 7, 10, 14, 20]
const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

// ==========================================
// Combobox مشترك للعملاء والمنتجات
// ==========================================
interface ComboboxProps {
  items: Array<{ id: number; label: string; sub?: string; extra?: string }>
  value: string
  onChange: (val: string) => void
  onSelect: (id: number, label: string) => void
  placeholder: string
  error?: boolean
}

function Combobox({ items, value, onChange, onSelect, placeholder, error }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // إغلاق عند الضغط خارج
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = value
    ? items.filter(i => i.label.toLowerCase().includes(value.toLowerCase()) || (i.sub ?? '').includes(value))
    : items  // يظهر الكل عند الفتح بدون بحث

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className={`input ${error ? 'input-error' : ''}`}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {filtered.slice(0, 10).map(item => (
            <button key={item.id} type="button"
              className="w-full flex items-center justify-between px-4 py-2.5
                hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
              onMouseDown={e => {
                e.preventDefault()
                onSelect(item.id, item.label)
                setOpen(false)
              }}>
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                {item.sub && <div className="text-xs text-gray-400 font-mono">{item.sub}</div>}
              </div>
              {item.extra && <span className="text-xs text-orange-500 font-medium ml-2">{item.extra}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ==========================================
// INVOICE FORM
// ==========================================
interface Props {
  docType?: string
  onSaved: () => void
  onCancel: () => void
}

export default function InvoiceForm({ docType = 'invoice', onSaved, onCancel }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [productSearches, setProductSearches] = useState<string[]>([''])
  const [newClientModal, setNewClientModal] = useState(false)

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:           new Date().toISOString().split('T')[0],
      currency:       'MAD',
      exchange_rate:  1,
      payment_method: 'cash',
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const currency = watch('currency')

  useEffect(() => {
    loadClients()
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  function loadClients() {
    api.getClients({ limit: 500 }).then((r: any) => setClients(r.rows ?? []))
  }

  function calcLine(line: Partial<FormData['lines'][0]>) {
    const qty   = Number(line.quantity)   || 0
    const price = Number(line.unit_price) || 0
    const disc  = Number(line.discount)   || 0
    const tva   = Number(line.tva_rate)   || 0
    const ht    = qty * price * (1 - disc / 100)
    return { ht, tvaAmt: ht * tva / 100, ttc: ht + ht * tva / 100 }
  }

  const totals = lines.reduce((acc, line) => {
    const { ht, tvaAmt, ttc } = calcLine(line)
    return { ht: acc.ht + ht, tva: acc.tva + tvaAmt, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  function selectProduct(index: number, product: Product) {
    setValue(`lines.${index}.product_id`,  product.id)
    setValue(`lines.${index}.unit_price`,  product.sale_price)
    setValue(`lines.${index}.tva_rate`,    product.tva_rate_value ?? 20)
    const searches = [...productSearches]
    searches[index] = product.name
    setProductSearches(searches)
    // نضع الاسم في description أيضاً
    setValue(`lines.${index}.description`, product.name)
  }

  function addLine() {
    append({ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 })
    setProductSearches(prev => [...prev, ''])
  }

  function removeLine(i: number) {
    remove(i)
    setProductSearches(prev => prev.filter((_, idx) => idx !== i))
  }

  // بيانات الـ combobox
  const clientItems = clients.map(c => ({
    id: c.id, label: c.name,
    sub: c.ice ? `ICE: ${c.ice}` : undefined,
    extra: (c.balance ?? 0) > 0 ? `${fmt(c.balance!)} MAD` : undefined,
  }))

  const productItems = products.map(p => ({
    id: p.id, label: p.name,
    sub: `${p.code} · ${p.unit}`,
    extra: p.sale_price > 0 ? `${fmt(p.sale_price)} MAD` : undefined,
  }))

  async function onSubmit(data: FormData) {
    await submitDoc(data, true)
  }

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      const doc = await api.createDocument({
        type: docType, date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: {
          currency: data.currency, exchange_rate: data.exchange_rate,
          payment_method: data.payment_method, due_date: data.due_date,
        },
        created_by: 1,
      }) as any
      if (confirm) {
        await api.confirmDocument(doc.id)
        toast('Document confirmé — Écriture comptable générée')
      } else {
        toast('Brouillon sauvegardé')
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {/* Client combobox */}
        <div className="col-span-2">
          <FormField label="Client" required error={errors.party_id?.message}>
            <div className="flex gap-2">
              <div className="flex-1">
                <Combobox
                  items={clientItems}
                  value={selectedClient ? selectedClient.name : clientSearch}
                  onChange={v => { setClientSearch(v); setSelectedClient(null); setValue('party_id', 0) }}
                  onSelect={(id, label) => {
                    const c = clients.find(c => c.id === id)!
                    setSelectedClient(c)
                    setClientSearch(label)
                    setValue('party_id', id)
                  }}
                  placeholder="Rechercher un client..."
                  error={!!errors.party_id}
                />
              </div>
              <button
                type="button"
                onClick={() => setNewClientModal(true)}
                className="btn-secondary btn-sm shrink-0 whitespace-nowrap"
                title="Créer un nouveau client">
                + Nouveau
              </button>
            </div>
            {selectedClient && (
              <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                {selectedClient.address && <span>📍 {selectedClient.address}</span>}
                {selectedClient.phone && <span>📞 {selectedClient.phone}</span>}
                {selectedClient.ice && <span className="font-mono">ICE: {selectedClient.ice}</span>}
                <button type="button" onClick={() => { setSelectedClient(null); setClientSearch(''); setValue('party_id', 0) }}
                  className="ml-auto text-gray-400 hover:text-red-500">✕</button>
              </div>
            )}
          </FormField>
        </div>

        {/* Date */}
        <FormField label="Date" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date d'échéance">
          <input {...register('due_date')} className="input" type="date" />
        </FormField>

        {/* Mode paiement */}
        <FormField label="Mode de paiement">
          <div className="flex gap-2">
            {PAYMENT_METHODS.map(m => (
              <label key={m.value}
                className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                  ${watch('payment_method') === m.value
                    ? 'bg-primary text-white border-primary'
                    : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}>
                <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
                {m.label}
              </label>
            ))}
          </div>
        </FormField>

        {/* Devise */}
        <FormField label="Devise">
          <div className="flex gap-2">
            <select {...register('currency')} className="input flex-1">
              {['MAD', 'EUR', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}
            </select>
            {currency !== 'MAD' && (
              <input {...register('exchange_rate')} className="input w-28" type="number" step="0.01" placeholder="Taux" />
            )}
          </div>
        </FormField>
      </div>

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Lignes <span className="text-red-500">*</span>
          </label>
          <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible">
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
              <div key={field.id}
                className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-start">
                {/* Produit combobox + description */}
                <div className="col-span-4 space-y-1">
                  <Combobox
                    items={productItems}
                    value={productSearches[i] ?? ''}
                    onChange={v => {
                      const s = [...productSearches]
                      s[i] = v
                      setProductSearches(s)
                      // إذا مسح الاختيار، نمسح product_id
                      setValue(`lines.${i}.product_id`, undefined)
                      setValue(`lines.${i}.description`, v)
                    }}
                    onSelect={(id) => {
                      const p = products.find(p => p.id === id)
                      if (p) selectProduct(i, p)
                    }}
                    placeholder="Produit ou description..."
                  />
                </div>
                <div className="col-span-2">
                  <input {...register(`lines.${i}.quantity`)} className="input text-xs text-right"
                    type="number" min="0.01" step="0.01" />
                </div>
                <div className="col-span-2">
                  <input {...register(`lines.${i}.unit_price`)} className="input text-xs text-right"
                    type="number" min="0" step="0.01" />
                </div>
                <div className="col-span-1">
                  <input {...register(`lines.${i}.discount`)} className="input text-xs text-right"
                    type="number" min="0" max="100" step="0.1" />
                </div>
                <div className="col-span-1">
                  <select {...register(`lines.${i}.tva_rate`)} className="input text-xs">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
                <div className="col-span-1 text-right text-xs font-semibold pt-2">{fmt(ttc)}</div>
                <div className="col-span-1 text-right pt-1">
                  {fields.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)}
                      className="text-gray-300 hover:text-red-500 text-xl leading-none">×</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Totaux */}
      <div className="flex justify-end">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Total HT</span><span className="font-medium">{fmt(totals.ht)} {currency}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>TVA</span><span className="font-medium">{fmt(totals.tva)} {currency}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
            <span>Total TTC</span>
            <span className="text-primary">{fmt(totals.ttc)} {currency}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <FormField label="Notes / Observations">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="Conditions de paiement, remarques..." />
      </FormField>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary justify-center">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitDoc(d, false))}
          className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitDoc(d, true))}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>

      {/* Modal nouveau client inline */}
      <Modal open={newClientModal} onClose={() => setNewClientModal(false)} title="Nouveau Client">
        <PartyForm
          type="client"
          onSaved={async () => {
            setNewClientModal(false)
            // تحديث قائمة العملاء واختيار الأخير تلقائياً
            const result = await api.getClients({ limit: 500 }) as any
            const rows: Client[] = result.rows ?? []
            setClients(rows)
            // نختار العميل الأحدث (آخر واحد في القائمة)
            const newest = [...rows].sort((a, b) => b.id - a.id)[0]
            if (newest) {
              setSelectedClient(newest)
              setClientSearch(newest.name)
              setValue('party_id', newest.id)
            }
            toast('Client créé et sélectionné')
          }}
          onCancel={() => setNewClientModal(false)}
        />
      </Modal>
    </form>
  )
}
