import { fmt } from '../../lib/format'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import NumberInput from '../ui/NumberInput'
import DocumentNumberField from '../ui/DocumentNumberField'

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
  const [unpaidDocs, setUnpaidDocs] = useState<any[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(
    documentId ? new Set([documentId]) : new Set()
  )
  const [paidAmounts, setPaidAmounts] = useState<Record<number, number>>({})
  const [customSeq, setCustomSeq] = useState<number | undefined>(undefined)
  const [useMulti, setUseMulti] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      method: 'cash',
      date:   new Date().toISOString().split('T')[0],
      amount: maxAmount ?? 0,
    },
  })

  const method = watch('method')

  useEffect(() => {
    if (documentId) return
    api.getDocuments({ party_id: partyId, limit: 9999 } as any).then(async (r: any) => {
      const validTypes = partyType === 'client'
        ? ['invoice']
        : ['purchase_invoice', 'import_invoice']
      const invoices = (r.rows ?? []).filter((d: any) =>
        validTypes.includes(d.type) && (d.status === 'confirmed' || d.status === 'partial')
      )
      const amounts: Record<number, number> = {}
      for (const inv of invoices) {
        const paid = await api.getPaymentPaidAmount(inv.id) as any
        amounts[inv.id] = paid?.total ?? 0
      }
      setPaidAmounts(amounts)
      setUnpaidDocs(invoices.filter((d: any) => (d.total_ttc - (amounts[d.id] ?? 0)) > 0.01))
    })
  }, [partyId, partyType, documentId])

  // عند اختيار فاتورة واحدة (radio)
  function handleSelectSingle(docId: number | null) {
    if (docId === null) {
      setSelectedDocIds(new Set())
      setValue('amount', 0)
    } else {
      setSelectedDocIds(new Set([docId]))
      const doc = unpaidDocs.find(d => d.id === docId)
      if (doc) setValue('amount', Math.round((doc.total_ttc - (paidAmounts[docId] ?? 0)) * 100) / 100)
    }
  }

  // عند تحديد/إلغاء فاتورة في الوضع المتعدد
  function handleToggleDoc(docId: number) {
    const next = new Set(selectedDocIds)
    if (next.has(docId)) next.delete(docId)
    else next.add(docId)
    setSelectedDocIds(next)
    // تحديث المبلغ تلقائياً بمجموع الفواتير المختارة
    const total = unpaidDocs
      .filter(d => next.has(d.id))
      .reduce((s, d) => s + (d.total_ttc - (paidAmounts[d.id] ?? 0)), 0)
    setValue('amount', Math.round(total * 100) / 100)
  }

  const singleSelected = !useMulti && selectedDocIds.size === 1 ? [...selectedDocIds][0] : null

  async function onSubmit(data: FormData) {
    try {
      const status = data.method === 'cash' || data.method === 'bank' ? 'collected' : 'pending'
      const base = { ...data, party_id: partyId, party_type: partyType, status, created_by: 1,
        ...(customSeq !== undefined ? { custom_seq: customSeq } : {}) }

      if (useMulti && selectedDocIds.size > 1) {
        // دفعة على فواتير متعددة — ننشئ دفعة لكل فاتورة
        const docs = unpaidDocs.filter(d => selectedDocIds.has(d.id))
        const totalRemaining = docs.reduce((s, d) => s + (d.total_ttc - (paidAmounts[d.id] ?? 0)), 0)
        for (const doc of docs) {
          const remaining = doc.total_ttc - (paidAmounts[doc.id] ?? 0)
          const allocated = totalRemaining > 0
            ? Math.round((remaining / totalRemaining) * data.amount * 100) / 100
            : remaining
          await api.createPayment({ ...base, amount: allocated, document_id: doc.id })
        }
        toast(`${docs.length} paiements enregistrés`)
      } else {
        await api.createPayment({ ...base, document_id: singleSelected ?? (documentId ?? null) })
        toast('Paiement enregistré')
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* اختيار الفاتورة */}
      {!documentId && unpaidDocs.length > 0 && (
        <FormField label={partyType === 'client' ? 'Imputer sur une facture' : 'Régler une facture fournisseur'}>
          <div className="space-y-2">
            {/* Toggle multi */}
            {unpaidDocs.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
                <input type="checkbox" checked={useMulti} onChange={e => { setUseMulti(e.target.checked); setSelectedDocIds(new Set()); setValue('amount', 0) }} className="accent-primary" />
                Régler plusieurs factures à la fois
              </label>
            )}

            <div className="space-y-1 max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
              {!useMulti && (
                <label className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
                  ${selectedDocIds.size === 0 ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  <input type="radio" checked={selectedDocIds.size === 0} onChange={() => handleSelectSingle(null)} className="accent-primary" />
                  <span className="text-gray-500 italic">Sans imputation (acompte général)</span>
                </label>
              )}
              {unpaidDocs.map(doc => {
                const remaining = doc.total_ttc - (paidAmounts[doc.id] ?? 0)
                const isSelected = selectedDocIds.has(doc.id)
                return (
                  <label key={doc.id} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
                    ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <div className="flex items-center gap-2">
                      {useMulti
                        ? <input type="checkbox" checked={isSelected} onChange={() => handleToggleDoc(doc.id)} className="accent-primary" />
                        : <input type="radio" checked={isSelected} onChange={() => handleSelectSingle(doc.id)} className="accent-primary" />
                      }
                      <span className="font-mono text-xs font-bold">{doc.number}</span>
                      <span className="text-gray-400 text-xs">{new Date(doc.date).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <span className="font-semibold text-orange-500 shrink-0">{fmt(remaining)} MAD</span>
                  </label>
                )
              })}
            </div>
          </div>
        </FormField>
      )}

      <FormField label="Numéro du paiement">
        <DocumentNumberField docType="payment" onSeqChange={setCustomSeq} />
      </FormField>

      <FormField label="Montant (MAD)" required error={errors.amount?.message}>
        <NumberInput {...register('amount')} className="input text-lg font-semibold" min="0.01" decimals={2} autoFocus />
        {maxAmount && selectedDocIds.size === 0 && (
          <p className="text-xs text-gray-400 mt-1">Solde total: {fmt(maxAmount)} MAD</p>
        )}
      </FormField>

      <FormField label="Mode de paiement" required error={errors.method?.message}>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map(m => (
            <label key={m.value}
              className={`text-center py-2.5 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${watch('method') === m.value ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}>
              <input {...register('method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

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

      <FormField label="Notes" error={errors.notes?.message}>
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? 'Enregistrement...' : '✅ Enregistrer paiement'}
        </button>
      </div>
    </div>
  )
}
