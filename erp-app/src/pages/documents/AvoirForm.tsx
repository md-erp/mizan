import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/forms/../../components/ui/FormField'
import type { Client, Document } from '../../types'

const schema = z.object({
  avoir_type: z.enum(['retour', 'commercial', 'annulation']),
  party_id:   z.coerce.number().min(1, 'Client requis'),
  date:       z.string().min(1),
  reason:     z.string().optional(),
  affects_stock: z.boolean().default(false),
  source_invoice_id: z.coerce.number().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function AvoirForm({ onSaved, onCancel }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientList, setShowClientList] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      avoir_type: 'commercial',
      date: new Date().toISOString().split('T')[0],
      affects_stock: false,
      lines: [{ quantity: 1, unit_price: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const avoirType = watch('avoir_type')
  const partyId = watch('party_id')

  useEffect(() => {
    api.getClients({ limit: 200 }).then((r: any) => setClients(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, status: 'confirmed' })
      .then((r: any) => setInvoices(r.rows ?? []))
  }, [partyId])

  function calcLine(l: any) {
    const ht = (l.quantity || 0) * (l.unit_price || 0)
    return { ht, ttc: ht + ht * (l.tva_rate || 0) / 100 }
  }

  const totals = lines.reduce((acc, l) => {
    const { ht, ttc } = calcLine(l)
    return { ht: acc.ht + ht, ttc: acc.ttc + ttc }
  }, { ht: 0, ttc: 0 })

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 8)

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'avoir', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.reason,
        extra: {
          avoir_type: data.avoir_type,
          affects_stock: data.avoir_type === 'retour' ? true : data.affects_stock,
          reason: data.reason,
        },
        created_by: 1,
      }) as any

      // Lier à la facture source si spécifiée
      if (data.source_invoice_id) {
        await api.convertDocument({
          sourceId: data.source_invoice_id,
          targetType: 'avoir',
          extra: { avoir_type: data.avoir_type },
        })
      }

      await api.confirmDocument(doc.id)
      toast('Avoir créé — Écriture comptable générée')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const AVOIR_TYPES = [
    { value: 'retour',      label: 'Retour marchandise',  desc: 'Retour physique + stock' },
    { value: 'commercial',  label: 'Avoir commercial',    desc: 'Remise sur facture existante' },
    { value: 'annulation',  label: 'Annulation facture',  desc: 'Annulation complète' },
  ]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Type d'avoir */}
      <FormField label="Type d'avoir" required>
        <div className="grid grid-cols-3 gap-2">
          {AVOIR_TYPES.map(t => (
            <label key={t.value}
              className={`p-3 rounded-lg border-2 cursor-pointer transition-all
                ${avoirType === t.value ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
              <input {...register('avoir_type')} type="radio" value={t.value} className="hidden" />
              <div className="font-medium text-sm">{t.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
            </label>
          ))}
        </div>
      </FormField>

      {/* Client */}
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
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
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
      </div>

      <FormField label="Motif">
        <input {...register('reason')} className="input" placeholder="Raison de l'avoir..." />
      </FormField>

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Lignes *</label>
          <button type="button" onClick={() => append({ quantity: 1, unit_price: 0, tva_rate: 20 })}
            className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-5">Description</div>
            <div className="col-span-2 text-right">Qté</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-2 text-right">TVA%</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
              <div className="col-span-5">
                <input {...register(`lines.${i}.description`)} className="input text-xs" placeholder="Description..." />
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
        <div className="w-48 space-y-1">
          <div className="flex justify-between text-gray-600"><span>Total HT</span><span>{fmt(totals.ht)} MAD</span></div>
          <div className="flex justify-between font-bold border-t border-gray-200 pt-1">
            <span>Total TTC</span><span className="text-primary">{fmt(totals.ttc)} MAD</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Créer Avoir'}
        </button>
      </div>
    </form>
  )
}
