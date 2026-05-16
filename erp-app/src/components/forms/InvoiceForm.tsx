import { useState, useEffect, useRef } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import NumberInput from '../ui/NumberInput'
import DateOffsetField from '../ui/DateOffsetField'
import { PartySelector } from '../ui/PartySelector'
import { LinesTable, getDefaultTva, LinesTotals } from '../ui/LinesTable'
import DocumentNumberField from '../ui/DocumentNumberField'
import type { Product } from '../../types'

const schema = z.object({
  date:            z.string().min(1, 'Date requise'),
  due_date:        z.string().optional(),
  party_id:        z.coerce.number().min(1, 'Client requis'),
  payment_method:  z.string().default('cash'),
  currency:        z.string().default('MAD'),
  exchange_rate:   z.coerce.number().min(0.0001).default(1),
  global_discount: z.coerce.number().min(0).max(100).default(0),
  notes:           z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01, 'Qté > 0'),
    unit_price:  z.coerce.number().min(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1, 'Au moins une ligne'),
})

type FormData = z.infer<typeof schema>

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

const COMMON_CURRENCIES = ['MAD', 'EUR', 'USD', 'GBP', 'AED', 'CNY', 'SAR', 'TND', 'DZD', 'CHF', 'CAD', 'JPY']

function CurrencyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = value
    ? COMMON_CURRENCIES.filter(c => c.toLowerCase().includes(value.toLowerCase()))
    : COMMON_CURRENCIES

  return (
    <div ref={ref} className="relative flex-1">
      <input
        value={value}
        onChange={e => onChange(e.target.value.toUpperCase())}
        onFocus={() => setOpen(true)}
        className="input w-full font-mono"
        placeholder="MAD"
        maxLength={5}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {filtered.map(c => (
            <button key={c} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm font-mono font-medium
                hover:bg-primary/5 dark:hover:bg-primary/10 text-gray-800 dark:text-gray-100
                border-b border-gray-50 dark:border-gray-700/50 last:border-0">
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Retourne une date ISO (YYYY-MM-DD) décalée de `days` jours depuis aujourd'hui */
function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

interface Props {
  docType?: string
  editDocId?: number          // si défini → mode édition
  defaultValues?: Partial<FormData & { docId: number }>
  onSaved: () => void
  onCancel: () => void
}

export default function InvoiceForm({
  docType = 'invoice',
  editDocId,
  defaultValues,
  onSaved,
  onCancel,
}: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:            new Date().toISOString().split('T')[0],
      due_date:        addDays(30),
      currency:        'MAD',
      exchange_rate:   1,
      payment_method:  'cash',
      global_discount: 0,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines     = watch('lines')
  const currency  = watch('currency')
  const payMethod = watch('payment_method')
  const globalDiscount = watch('global_discount')
  
  // 🔍 DEBUG: تتبع globalDiscount
  useEffect(() => {
    console.log('🔍 [InvoiceForm] globalDiscount changed:', globalDiscount, 'type:', typeof globalDiscount)
  }, [globalDiscount])

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // pré-remplir en mode édition
  useEffect(() => {
    if (!defaultValues) return
    
    console.log('🔍 [InvoiceForm] defaultValues received:', {
      global_discount: defaultValues.global_discount,
      date: defaultValues.date,
      party_id: defaultValues.party_id,
    })
    
    const formData = {
      date:           defaultValues.date           ?? new Date().toISOString().split('T')[0],
      due_date:       (defaultValues as any).due_date ?? '',
      party_id:       defaultValues.party_id       ?? 0,
      payment_method: (defaultValues as any).payment_method ?? 'cash',
      currency:       (defaultValues as any).currency       ?? 'MAD',
      exchange_rate:  (defaultValues as any).exchange_rate  ?? 1,
      global_discount: (defaultValues as any).global_discount ?? 0,
      notes:          defaultValues.notes          ?? '',
      lines:          defaultValues.lines?.length
        ? defaultValues.lines as FormData['lines']
        : [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    }
    
    console.log('🔄 [InvoiceForm] Resetting form with:', {
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
      console.log('✅ [InvoiceForm] Force set global_discount to:', formData.global_discount)
    }, 100)
  }, [defaultValues, reset, setValue])

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      if (isEdit) {
        const totalHt  = data.lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100), 0)
        const totalTva = data.lines.reduce((s, l) => {
          const ht = l.quantity * l.unit_price * (1 - (l.discount ?? 0) / 100)
          return s + ht * (l.tva_rate ?? 0) / 100
        }, 0)
        const disc = (data.global_discount ?? 0) / 100
        const totalHtAfterDisc = totalHt * (1 - disc)
        const totalTvaAfterDisc = totalTva * (1 - disc)

        await api.updateDocument({
          id:              editDocId,
          date:            data.date,
          due_date:        data.due_date,
          party_id:        data.party_id,
          party_type:      'client',
          payment_method:  data.payment_method,
          currency:        data.currency,
          exchange_rate:   data.exchange_rate,
          global_discount: data.global_discount ?? 0,
          notes:           data.notes,
          lines:           data.lines,
          total_ht:        Math.round(totalHtAfterDisc * 100) / 100,
          total_tva:       Math.round(totalTvaAfterDisc * 100) / 100,
          total_ttc:       Math.round((totalHtAfterDisc + totalTvaAfterDisc) * 100) / 100,
        })
        toast('Brouillon mis à jour ✓')
      } else {
        const doc = await api.createDocument({
          type: docType, date: data.date,
          party_id: data.party_id, party_type: 'client',
          lines: data.lines, notes: data.notes,
          extra: {
            currency: data.currency, exchange_rate: data.exchange_rate,
            payment_method: data.payment_method, due_date: data.due_date,
            global_discount: data.global_discount ?? 0,
          },
          created_by: 1,
          ...(customSeq !== undefined ? { custom_seq: customSeq } : {}),
        }) as any
        if (confirm) {
          await api.confirmDocument(doc.id)
          toast('Document confirmé — Écriture comptable générée ✓')
        } else {
          toast('Brouillon sauvegardé')
        }
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <form className="space-y-5">
      {isEdit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          ✏️ Mode édition — le brouillon actuel sera remplacé par cette version.
        </div>
      )}

      {/* Client */}
      <FormField label="Client" required error={errors.party_id?.message}>
        <PartySelector
          type="client"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <DateOffsetField
          label="Date d'échéance"
          storageKey="offset_due_date"
          defaultDays={30}
          baseDate={watch('date')}
          value={watch('due_date')}
          onChange={(iso) => setValue('due_date', iso)}
          error={errors.due_date?.message}
        />
      </div>

      {!isEdit && (
        <FormField label="Numéro du document">
          <DocumentNumberField
            docType={docType}
            onSeqChange={setCustomSeq}
          />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mode de paiement">
          <div className="flex gap-1.5">
            {PAYMENT_METHODS.map(m => (
              <label key={m.value}
                className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                  ${payMethod === m.value
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary/40'}`}>
                <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
                {m.label}
              </label>
            ))}
          </div>
        </FormField>

        <FormField label="Devise">
          <div className="flex gap-2">
            <CurrencyInput
              value={currency}
              onChange={v => setValue('currency', v)}
            />
            {currency !== 'MAD' && (
              <input {...register('exchange_rate')} className="input w-28"
                step="0.0001" min="0.0001" placeholder="Taux" />
            )}
          </div>
        </FormField>
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
      
        onProductsRefresh={setProducts}
      />

      <LinesTotals lines={lines} currency={currency} globalDiscount={globalDiscount ?? 0} />

      <div className="flex items-center gap-3 justify-end -mt-2">
        <label className="text-sm text-gray-500 shrink-0">Remise globale (%)</label>
        <Controller
          name="global_discount"
          control={control}
          render={({ field }) => (
            <NumberInput
              {...field}
              className="input w-28 text-right"
              decimals={2} min="0" max="100" placeholder="0"
            />
          )}
        />
      </div>

      <FormField label="Notes / Observations">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="Conditions de paiement, remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitDoc(d, false), () => {
            toast('Vérifiez les champs requis', 'error')
          })}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Enregistrer'}
        </button>
      </div>
    </form>
  )
}
