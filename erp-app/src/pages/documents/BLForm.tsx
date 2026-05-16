import { fmt } from '../../lib/format'
import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import DateOffsetField from '../../components/ui/DateOffsetField'
import { PartySelector } from '../../components/ui/PartySelector'
import { LinesTable, getDefaultTva, LinesTotals } from '../../components/ui/LinesTable'
import NumberInput from '../../components/ui/NumberInput'
import type { Product, Document } from '../../types'
import DocumentNumberField from '../../components/ui/DocumentNumberField'

const schema = z.object({
  date:              z.string().min(1, 'Date requise'),
  delivery_date:     z.string().optional(),
  delivery_address:  z.string().optional(),
  party_id:          z.coerce.number().min(1, 'Client requis'),
  source_invoice_id: z.coerce.number().optional(),
  payment_method:    z.string().optional(),
  global_discount:   z.coerce.number().min(0).max(100).default(0),
  notes:             z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0).default(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function BLForm({ onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)

  /** Retourne une date ISO décalée de `days` jours depuis aujourd'hui */
  function addDays(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      delivery_date: addDays(7),
      global_discount: 0,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines   = watch('lines')
  const globalDiscount = watch('global_discount') || 0
  const partyId = watch('party_id')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, status: 'confirmed' })
      .then((r: any) => setInvoices(r.rows ?? []))
  }, [partyId])

  // fmt imported from lib/format

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'bl', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: {
          delivery_address: data.delivery_address,
          delivery_date: data.delivery_date,
          payment_method: data.payment_method,
          global_discount: data.global_discount ?? 0,
        },
        created_by: 1,
          ...(customSeq !== undefined ? { custom_seq: customSeq } : {}),
        }) as any

      // Lier à la facture source si sélectionnée
      if (data.source_invoice_id) {
        await api.linkDocuments({
          parentId: data.source_invoice_id,
          childId: doc.id,
          linkType: 'invoice_to_bl',
        }).catch(() => {})
      }

      toast('Bon de livraison sauvegardé en brouillon')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
      <FormField label="Client" required error={errors.party_id?.message}>
        <PartySelector
          type="client"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => { setValue('party_id', 0); setInvoices([]) }}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date BL" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>

      <FormField label="Numéro du document">
        <DocumentNumberField
          docType="bl"
          onSeqChange={setCustomSeq}
        />
      </FormField>
        <DateOffsetField
          label="Date de livraison prévue"
          storageKey="offset_delivery_bl"
          defaultDays={7}
          baseDate={watch('date')}
          value={watch('delivery_date')}
          onChange={(iso) => setValue('delivery_date', iso)}
        />
      </div>

      <FormField label="Adresse de livraison">
        <input {...register('delivery_address')} className="input" placeholder="Adresse de livraison..." />
      </FormField>

      <FormField label="Mode de paiement (optionnel)">
        <select {...register('payment_method')} className="input">
          <option value="">— Non spécifié —</option>
          <option value="cash">Espèces</option>
          <option value="bank">Virement</option>
          <option value="cheque">Chèque</option>
          <option value="lcn">LCN</option>
        </select>
      </FormField>

      {invoices.length > 0 && (
        <FormField label="Facture liée (optionnel)">
          <select {...register('source_invoice_id')} className="input">
            <option value="">— BL autonome (sans facture) —</option>
            {invoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.number} — {fmt(inv.total_ttc)} MAD
              </option>
            ))}
          </select>
        </FormField>
      )}

      <LinesTable
        fields={fields}
        lines={lines}
        products={products}
        register={register}
        control={control}
        setValue={setValue}
        onRemove={remove}
        onAdd={() => append({ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() })}
        showDiscount
        showTva
        productFilter={p => p.type === 'finished' || p.type === 'semi_finished'}
      
        onProductsRefresh={setProducts}
      />

      <LinesTotals lines={lines} globalDiscount={globalDiscount} />

      <div className="flex items-center gap-3 justify-end -mt-2">
        <label className="text-sm text-gray-500 shrink-0">Remise globale (%)</label>
        <NumberInput {...register('global_discount')} 
          className="input w-28 text-right" decimals={2} min="0" max="100" placeholder="0" />
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
        ℹ️ Le mouvement de stock sera créé en attente. Vous pourrez l'appliquer depuis les détails du BL.
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="submit" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
      </div>
    </form>
  )
}
