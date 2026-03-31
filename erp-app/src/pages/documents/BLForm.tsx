import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import type { Client, Product, Document } from '../../types'

const schema = z.object({
  date:             z.string().min(1),
  delivery_date:    z.string().optional(),
  delivery_address: z.string().optional(),
  party_id:         z.coerce.number().min(1, 'Client requis'),
  source_invoice_id: z.coerce.number().optional(),
  notes:            z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function BLForm({ onSaved, onCancel }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientList, setShowClientList] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      lines: [{ quantity: 1, unit_price: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const partyId = watch('party_id')

  useEffect(() => {
    api.getClients({ limit: 200 }).then((r: any) => setClients(r.rows ?? []))
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, status: 'confirmed' })
      .then((r: any) => setInvoices(r.rows ?? []))
  }, [partyId])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)

  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 8)

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'bl', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: {
          delivery_address: data.delivery_address,
          delivery_date: data.delivery_date,
          stock_applied: false,
        },
        created_by: 1,
      }) as any

      if (data.source_invoice_id) {
        // ربط بالفاتورة
      }

      await api.confirmDocument(doc.id)
      toast('Bon de livraison créé — Mouvement stock en attente')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField label="Client" required error={errors.party_id?.message}>
        <div className="relative">
          <input
            value={selectedClient ? selectedClient.name : clientSearch}
            onChange={e => { setClientSearch(e.target.value); setSelectedClient(null); setValue('party_id', 0); setShowClientList(true) }}
            onFocus={() => setShowClientList(true)}
            className={`input ${errors.party_id ? 'input-error' : ''}`}
            placeholder="Rechercher un client..."
          />
          {showClientList && filteredClients.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
              {filteredClients.map(c => (
                <button key={c.id} type="button"
                  className="w-full px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left text-sm font-medium"
                  onMouseDown={e => { e.preventDefault(); setSelectedClient(c); setValue('party_id', c.id); setClientSearch(''); setShowClientList(false) }}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date BL" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date de livraison">
          <input {...register('delivery_date')} className="input" type="date" />
        </FormField>
      </div>

      <FormField label="Adresse de livraison">
        <input {...register('delivery_address')} className="input"
          placeholder={selectedClient?.address ?? 'Adresse de livraison...'} />
      </FormField>

      {invoices.length > 0 && (
        <FormField label="Facture liée (optionnel)">
          <select {...register('source_invoice_id')} className="input">
            <option value="">— Sans facture liée —</option>
            {invoices.map(inv => (
              <option key={inv.id} value={inv.id}>{inv.number} — {fmt(inv.total_ttc)} MAD</option>
            ))}
          </select>
        </FormField>
      )}

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Articles livrés * <span className="text-gray-400 font-normal">({fmt(totalQty)} unités total)</span></label>
          <button type="button" onClick={() => append({ quantity: 1, unit_price: 0, tva_rate: 20 })}
            className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-6">Produit</div>
            <div className="col-span-3 text-right">Quantité livrée</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
              <div className="col-span-6">
                <select className="input text-xs" onChange={e => {
                  const p = products.find(p => p.id === Number(e.target.value))
                  if (p) { setValue(`lines.${i}.product_id`, p.id); setValue(`lines.${i}.description`, p.name); setValue(`lines.${i}.unit_price`, p.sale_price); setValue(`lines.${i}.tva_rate`, p.tva_rate_value ?? 20) }
                }} defaultValue="">
                  <option value="">— Produit —</option>
                  {products.filter(p => p.type === 'finished' || p.type === 'semi_finished').map(p => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name} (Stock: {p.stock_quantity})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3"><input {...register(`lines.${i}.quantity`)} className="input text-xs text-right" type="number" min="0.01" step="0.01" /></div>
              <div className="col-span-2"><input {...register(`lines.${i}.unit_price`)} className="input text-xs text-right" type="number" min="0" step="0.01" /></div>
              <div className="col-span-1 text-right">
                {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-xl">×</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-400">
        ℹ️ Le mouvement de stock sera créé en attente. Vous pourrez l'appliquer depuis les détails du BL.
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Créer BL'}
        </button>
      </div>
    </form>
  )
}
