import { useState, useEffect } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
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

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

/** Retourne une date ISO (YYYY-MM-DD) décalée de `days` jours depuis aujourd'hui */
function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const schema = z.object({
  date:           z.string().min(1, 'Date requise'),
  due_date:       z.string().optional(),
  party_id:       z.coerce.number().min(1, 'Fournisseur requis'),
  payment_method: z.string().default('bank'),
  currency:       z.string().default('MAD'),
  exchange_rate:  z.coerce.number().min(0.0001).default(1),
  global_discount: z.coerce.number().min(0).max(100).default(0),
  notes:          z.string().optional(),
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

export default function PurchaseInvoiceForm({ onSaved, onCancel, editDocId, defaultValues }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      due_date: addDays(30),
      payment_method: 'bank',
      currency: 'MAD',
      exchange_rate: 1,
      global_discount: 0,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines     = watch('lines')
  const globalDiscount = watch('global_discount') || 0
  const payMethod = watch('payment_method')
  
  // 🔍 DEBUG: تتبع globalDiscount
  useEffect(() => {
    console.log('🔍 [PurchaseInvoiceForm] globalDiscount changed:', globalDiscount, 'type:', typeof globalDiscount)
  }, [globalDiscount])

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!defaultValues) return
    
    console.log('🔍 [PurchaseInvoiceForm] defaultValues received:', {
      global_discount: (defaultValues as any).global_discount,
      date: defaultValues.date,
      party_id: defaultValues.party_id,
    })
    
    const formData = {
      date:           defaultValues.date           ?? new Date().toISOString().split('T')[0],
      due_date:       (defaultValues as any).due_date       ?? '',
      party_id:       defaultValues.party_id       ?? 0,
      payment_method: (defaultValues as any).payment_method ?? 'bank',
      currency:       (defaultValues as any).currency       ?? 'MAD',
      exchange_rate:  (defaultValues as any).exchange_rate  ?? 1,
      global_discount: (defaultValues as any).global_discount ?? 0,
      notes:          defaultValues.notes          ?? '',
      lines: defaultValues.lines?.length
        ? defaultValues.lines as FormData['lines']
        : [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    }
    
    console.log('🔄 [PurchaseInvoiceForm] Resetting form with:', {
      global_discount: formData.global_discount,
      lines_count: formData.lines.length,
    })
    
    reset(formData)
    
    // ✅ FIX: Force setValue for global_discount with shouldValidate and shouldDirty
    setTimeout(() => {
      setValue('global_discount', formData.global_discount, { 
        shouldValidate: true,
        shouldDirty: false,
        shouldTouch: false
      })
      console.log('✅ [PurchaseInvoiceForm] Force set global_discount to:', formData.global_discount)
    }, 100)
  }, [defaultValues, reset, setValue])

  async function onSubmit(data: FormData, confirm: boolean) {
    try {
      if (isEdit) {
        const totalHt  = data.lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100), 0)
        const totalTva = data.lines.reduce((s, l) => { const ht = l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100); return s + ht * (l.tva_rate ?? 0) / 100 }, 0)
        const disc = (data.global_discount ?? 0) / 100
        await api.updateDocument({
          id: editDocId, date: data.date, party_id: data.party_id, party_type: 'supplier',
          payment_method: data.payment_method, due_date: data.due_date,
          global_discount: data.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
          notes: data.notes, lines: data.lines,
          total_ht: Math.round(totalHt * (1 - disc) * 100) / 100,
          total_tva: Math.round(totalTva * (1 - disc) * 100) / 100,
          total_ttc: Math.round((totalHt + totalTva) * (1 - disc) * 100) / 100,
        })
        if (confirm) { await api.confirmDocument(editDocId!); toast('Facture mise à jour et confirmée ✓') }
        else toast('Brouillon mis à jour ✓')
        onSaved(); return
      }
      const doc = await api.createDocument({
        type: 'purchase_invoice', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { payment_method: data.payment_method, due_date: data.due_date, global_discount: data.global_discount ?? 0 },
        created_by: 1,
          ...(customSeq !== undefined ? { custom_seq: customSeq } : {}),
        }) as any
      if (confirm) {
        await api.confirmDocument(doc.id)
        toast('Facture fournisseur enregistrée ✓')
      } else {
        toast('Brouillon sauvegardé')
      }
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
      {isEdit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          ✏️ Mode édition — le brouillon actuel sera remplacé.
        </div>
      )}

      <FormField label="Fournisseur" required error={errors.party_id?.message}>
        <PartySelector
          type="supplier"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date facture" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>

      <FormField label="Numéro du document">
        <DocumentNumberField
          docType="purchase_invoice"
          onSeqChange={setCustomSeq}
        />
      </FormField>
        <DateOffsetField
          label="Date d'échéance"
          storageKey="offset_due_date_purchase"
          defaultDays={30}
          baseDate={watch('date')}
          value={watch('due_date')}
          onChange={(iso) => setValue('due_date', iso)}
        />
      </div>

      <FormField label="Mode de paiement">
        <div className="flex gap-1.5">
          {PAYMENT_METHODS.map(m => (
            <label key={m.value}
              className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${payMethod === m.value
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 hover:border-primary/40'}`}>
              <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

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
        priceLabel="Prix d'achat HT"
      
        onProductsRefresh={setProducts}
      />

      <LinesTotals lines={lines} globalDiscount={globalDiscount} />

      <div className="flex items-center gap-3 justify-end -mt-2">
        <label className="text-sm text-gray-500 shrink-0">Remise globale (%)</label>
        <Controller
          name="global_discount"
          control={control}
          render={({ field }) => (
            <NumberInput 
              {...field}
              className="input w-28 text-right" decimals={2} min="0" max="100" placeholder="0" />
          )}
        />
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
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
          {isSubmitting ? '...' : '✅ Confirmer facture'}
        </button>
      </div>
    </form>
  )
}
