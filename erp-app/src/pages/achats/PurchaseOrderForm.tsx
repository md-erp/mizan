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
import type { Product } from '../../types'
import DocumentNumberField from '../../components/ui/DocumentNumberField'

const schema = z.object({
  date:                   z.string().min(1, 'Date requise'),
  expected_delivery_date: z.string().optional(),
  party_id:               z.coerce.number().min(1, 'Fournisseur requis'),
  currency:               z.string().default('MAD'),
  exchange_rate:          z.coerce.number().min(0.0001).default(1),
  global_discount:        z.coerce.number().min(0).max(100).default(0),
  notes:                  z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props {
  onSaved: () => void
  onCancel: () => void
  editDocId?: number
  defaultValues?: Partial<FormData & { docId: number }>
}

export default function PurchaseOrderForm({ onSaved, onCancel, editDocId, defaultValues }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      expected_delivery_date: (() => {
        const saved = localStorage.getItem('offset_delivery_bc')
        const days = saved !== null ? parseInt(saved, 10) : 14
        const d = new Date(); d.setDate(d.getDate() + days)
        return d.toISOString().split('T')[0]
      })(),
      global_discount: 0,
      currency: 'MAD',
      exchange_rate: 1,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const globalDiscount = watch('global_discount') || 0

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // pré-remplir en mode édition
  useEffect(() => {
    if (!defaultValues) return
    reset({
      date:                   defaultValues.date ?? new Date().toISOString().split('T')[0],
      expected_delivery_date: (defaultValues as any).expected_delivery_date ?? '',
      party_id:               defaultValues.party_id ?? 0,
      notes:                  defaultValues.notes ?? '',
      lines:                  defaultValues.lines?.length
        ? defaultValues.lines as FormData['lines']
        : [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    })
  }, [defaultValues])

  async function onSubmit(data: FormData, confirm: boolean) {
    try {
      if (isEdit) {
        // تحديث المسودة مباشرة
        const totalHt  = data.lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100), 0)
        const totalTva = data.lines.reduce((s, l) => { const ht = l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100); return s + ht * (l.tva_rate ?? 0) / 100 }, 0)
        const disc = (data.global_discount ?? 0) / 100
        await api.updateDocument({
          id: editDocId, date: data.date, party_id: data.party_id, party_type: 'supplier',
          notes: data.notes, lines: data.lines,
          total_ht: Math.round(totalHt * (1 - disc) * 100) / 100,
          total_tva: Math.round(totalTva * (1 - disc) * 100) / 100,
          total_ttc: Math.round((totalHt + totalTva) * (1 - disc) * 100) / 100,
        })
        if (confirm) { await api.confirmDocument(editDocId!); toast('BC mis à jour et confirmé ✓') }
        else toast('BC mis à jour ✓')
        onSaved(); return
      }
      const doc = await api.createDocument({
        type: 'purchase_order', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { expected_delivery_date: data.expected_delivery_date, global_discount: data.global_discount ?? 0 },
        created_by: 1,
          ...(customSeq !== undefined ? { custom_seq: customSeq } : {}),
        }) as any
      if (confirm) {
        await api.confirmDocument(doc.id)
        toast('Bon de commande confirmé ✓')
      } else {
        toast('Brouillon sauvegardé')
      }
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
      <FormField label="Fournisseur" required error={errors.party_id?.message}>
        <PartySelector
          type="supplier"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>

      <FormField label="Numéro du document">
        <DocumentNumberField
          docType="purchase_order"
          onSeqChange={setCustomSeq}
        />
      </FormField>
        <DateOffsetField
          label="Livraison prévue"
          storageKey="offset_delivery_bc"
          defaultDays={14}
          baseDate={watch('date')}
          value={watch('expected_delivery_date')}
          onChange={(iso) => setValue('expected_delivery_date', iso)}
        />
      </div>

      {/* Devise */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Devise">
          <select {...register('currency')} className="input">
            {['MAD','EUR','USD','GBP','AED','CNY','SAR','TND'].map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        {watch('currency') !== 'MAD' && (
          <FormField label={`Taux (1 ${watch('currency')} = ? MAD)`}>
            <input {...register('exchange_rate')} className="input" type="number" step="0.0001" min="0.0001" />
          </FormField>
        )}
      </div>

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
        priceLabel="Prix HT unitaire"
      
        onProductsRefresh={setProducts}
      />

      <LinesTotals lines={lines} globalDiscount={globalDiscount} />

      <div className="flex items-center gap-3 justify-end -mt-2">
        <label className="text-sm text-gray-500 shrink-0">Remise globale (%)</label>
        <NumberInput {...register('global_discount')} 
          className="input w-28 text-right" decimals={2} min="0" max="100" placeholder="0" />
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques, conditions..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => onSubmit(d, false))}
          className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => onSubmit(d, true))}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer BC'}
        </button>
      </div>
    </form>
  )
}
