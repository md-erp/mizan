import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'

const schema = z.object({
  amount:        z.coerce.number().min(0.01, 'Montant requis'),
  method:        z.enum(['cash', 'bank', 'cheque', 'lcn']),
  date:          z.string().min(1, 'Date requise'),
  due_date:      z.string().optional(),
  cheque_number: z.string().optional(),
  bank:          z.string().optional(),
  notes:         z.string().optional(),
})

type FormData = z.infer<typeof schema>

const METHODS = [
  { value: 'cash',   label: '💵 Espèces' },
  { value: 'bank',   label: '🏦 Virement' },
  { value: 'cheque', label: '📝 Chèque' },
  { value: 'lcn',    label: '📋 LCN' },
]

interface Props {
  partyId: number
  partyType: 'client' | 'supplier'
  documentId?: number
  maxAmount?: number
  onSaved: () => void
  onCancel: () => void
}

export default function PaymentForm({ partyId, partyType, documentId, maxAmount, onSaved, onCancel }: Props) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      method:  'cash',
      date:    new Date().toISOString().split('T')[0],
      amount:  maxAmount ?? 0,
    },
  })

  const method = watch('method')

  async function onSubmit(data: FormData) {
    try {
      await api.createPayment({
        ...data,
        party_id:   partyId,
        party_type: partyType,
        document_id: documentId ?? null,
        status: data.method === 'cash' || data.method === 'bank' ? 'collected' : 'pending',
        created_by: 1,
      })
      toast('Paiement enregistré')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Montant */}
      <FormField label="Montant (MAD)" required error={errors.amount?.message}>
        <input {...register('amount')} className="input text-lg font-semibold" type="number"
          min="0.01" step="0.01" autoFocus />
        {maxAmount && (
          <p className="text-xs text-gray-400 mt-1">Solde restant: {maxAmount.toFixed(2)} MAD</p>
        )}
      </FormField>

      {/* Mode */}
      <FormField label="Mode de paiement" required error={errors.method?.message}>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map(m => (
            <label key={m.value}
              className={`text-center py-2.5 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${watch('method') === m.value
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}>
              <input {...register('method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

      {/* Date */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date de paiement" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        {(method === 'cheque' || method === 'lcn') && (
          <FormField label="Date d'échéance" error={errors.due_date?.message}>
            <input {...register('due_date')} className="input" type="date" />
          </FormField>
        )}
      </div>

      {/* Chèque / LCN */}
      {(method === 'cheque' || method === 'lcn') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Numéro" error={errors.cheque_number?.message}>
            <input {...register('cheque_number')} className="input font-mono"
              placeholder={method === 'cheque' ? 'N° chèque' : 'N° LCN'} />
          </FormField>
          <FormField label="Banque" error={errors.bank?.message}>
            <input {...register('bank')} className="input" placeholder="Nom de la banque" />
          </FormField>
        </div>
      )}

      {/* Notes */}
      <FormField label="Notes" error={errors.notes?.message}>
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="btn-primary flex-1 justify-center">
          {isSubmitting ? 'Enregistrement...' : '✅ Enregistrer paiement'}
        </button>
      </div>
    </form>
  )
}
