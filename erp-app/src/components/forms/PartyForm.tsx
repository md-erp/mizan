import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import type { Client, Supplier } from '../../types'

const schema = z.object({
  name:       z.string().min(2, 'Nom requis (min 2 caractères)'),
  address:    z.string().optional(),
  email:      z.string().email('Email invalide').optional().or(z.literal('')),
  phone:      z.string().optional(),
  ice:        z.string()
    .optional()
    .refine(v => !v || v.trim() === '' || /^\d{15}$/.test(v.trim()), {
      message: 'ICE doit contenir exactement 15 chiffres',
    }),
  if_number:  z.string().optional(),
  rc:         z.string().optional(),
  credit_limit: z.coerce.number().min(0).optional(),
  notes:      z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  type: 'client' | 'supplier'
  initial?: Partial<Client | Supplier>
  onSaved: () => void
  onCancel: () => void
}

export default function PartyForm({ type, initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial?.id
  const label = type === 'client' ? 'Client' : 'Fournisseur'

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:         initial?.name ?? '',
      address:      initial?.address ?? '',
      email:        initial?.email ?? '',
      phone:        initial?.phone ?? '',
      ice:          initial?.ice ?? '',
      if_number:    initial?.if_number ?? '',
      rc:           initial?.rc ?? '',
      credit_limit: (initial as Client)?.credit_limit ?? 0,
      notes:        initial?.notes ?? '',
    },
  })

  async function onSubmit(data: FormData) {
    try {
      if (isEdit) {
        const fn = type === 'client' ? api.updateClient : api.updateSupplier
        await fn({ ...data, id: initial!.id })
        toast(`${label} modifié avec succès`)
      } else {
        const fn = type === 'client' ? api.createClient : api.createSupplier
        await fn(data)
        toast(`${label} créé avec succès`)
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* Nom */}
      <FormField label="Nom" required error={errors.name?.message}>
        <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`}
          placeholder={`Nom du ${label.toLowerCase()}`} autoFocus />
      </FormField>

      {/* ICE / IF / RC */}
      <div className="grid grid-cols-3 gap-3">
        <FormField label="ICE" error={errors.ice?.message} hint="15 chiffres">
          <input {...register('ice')} className={`input font-mono ${errors.ice ? 'input-error' : ''}`}
            placeholder="000000000000000" maxLength={15} />
        </FormField>
        <FormField label="IF" error={errors.if_number?.message}>
          <input {...register('if_number')} className="input" placeholder="12345678" />
        </FormField>
        <FormField label="RC" error={errors.rc?.message}>
          <input {...register('rc')} className="input" placeholder="RC12345" />
        </FormField>
      </div>

      {/* Téléphone / Email */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Téléphone" error={errors.phone?.message}>
          <input {...register('phone')} className="input" placeholder="+212 6 00 00 00 00" />
        </FormField>
        <FormField label="Email" error={errors.email?.message}>
          <input {...register('email')} className="input" type="email" placeholder="contact@entreprise.ma" />
        </FormField>
      </div>

      {/* Adresse */}
      <FormField label="Adresse" error={errors.address?.message}>
        <input {...register('address')} className="input" placeholder="Adresse complète" />
      </FormField>

      {/* Plafond crédit (clients seulement) */}
      {type === 'client' && (
        <FormField label="Plafond de crédit (MAD)" error={errors.credit_limit?.message}
          hint="Laisser à 0 pour aucune limite">
          <input {...register('credit_limit')} className="input" type="number" min="0" step="100" />
        </FormField>
      )}

      {/* Notes */}
      <FormField label="Notes" error={errors.notes?.message}>
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">
          Annuler
        </button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? 'Enregistrement...' : isEdit ? 'Modifier' : `Créer ${label}`}
        </button>
      </div>
    </div>
  )
}
