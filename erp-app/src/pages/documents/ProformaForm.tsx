import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import { PartySelector } from '../../components/ui/PartySelector'
import { LinesTable, LinesTotals } from '../../components/ui/LinesTable'
import type { Product } from '../../types'

const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']

const schema = z.object({
  date:          z.string().min(1, 'Date requise'),
  validity_date: z.string().optional(),
  party_id:      z.coerce.number().min(1, 'Client requis'),
  currency:      z.string().default('MAD'),
  exchange_rate: z.coerce.number().min(0.0001).default(1),
  incoterm:      z.string().optional(),
  port:          z.string().optional(),
  notes:         z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(0), // proforma souvent exonérée
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function ProformaForm({ onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      currency: 'MAD', exchange_rate: 1,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines    = watch('lines')
  const currency = watch('currency')
  const incoterm = watch('incoterm')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      const doc = await api.createDocument({
        type: 'proforma', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: {
          validity_date: data.validity_date,
          currency: data.currency, exchange_rate: data.exchange_rate,
          incoterm: data.incoterm, port: data.port,
        },
        created_by: 1,
      }) as any
      if (confirm) { await api.confirmDocument(doc.id); toast('Proforma confirmée ✓') }
      else toast('Brouillon sauvegardé')
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
          onClear={() => setValue('party_id', 0)}
          error={errors.party_id?.message}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Valide jusqu'au">
          <input {...register('validity_date')} className="input" type="date" />
        </FormField>
      </div>

      {/* Devise + Incoterm — spécifique Proforma */}
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Devise">
          <select {...register('currency')} className="input">
            {['MAD', 'EUR', 'USD', 'GBP', 'AED', 'CNY'].map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        {currency !== 'MAD' && (
          <FormField label={`Taux (1 ${currency} = ? MAD)`}>
            <input {...register('exchange_rate')} className="input" type="number" step="0.0001" min="0.0001" />
          </FormField>
        )}
        <FormField label="Incoterm">
          <select {...register('incoterm')} className="input">
            <option value="">— Sans incoterm —</option>
            {INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </FormField>
        {incoterm && (
          <FormField label="Port / Lieu">
            <input {...register('port')} className="input" placeholder="Ex: Casablanca, Tanger Med..." />
          </FormField>
        )}
      </div>

      {incoterm && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-xs text-blue-700 dark:text-blue-400">
          <span className="font-semibold">{incoterm}</span> — Les conditions de livraison seront mentionnées sur la proforma.
        </div>
      )}

      <LinesTable
        fields={fields}
        lines={lines}
        products={products}
        register={register}
        setValue={setValue}
        onRemove={remove}
        onAdd={() => append({ quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 })}
        showDiscount
        showTva
      />

      <LinesTotals lines={lines} currency={currency} />

      <FormField label="Notes / Conditions">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="Conditions de paiement, délai de livraison, validité..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, false))} className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, true))} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>
    </form>
  )
}
