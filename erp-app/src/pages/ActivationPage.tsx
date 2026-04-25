import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../lib/api'

const schema = z.object({
  companyName: z.string().min(2, 'Nom requis'),
  licenseKey:  z.string().min(10, 'Clé invalide'),
})
type Form = z.infer<typeof schema>

export default function ActivationPage({ onActivated }: { onActivated: () => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: Form) {
    setLoading(true)
    setError('')
    try {
      const result = await api.activateLicense(data) as any
      if (result === false || result?.success === false) {
        setError(result?.error ?? 'Clé de licence invalide. Vérifiez le nom et la clé.')
        return
      }
      onActivated()
    } catch (e: any) {
      setError(e.message || 'Clé de licence invalide. Vérifiez le nom et la clé.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-primary">
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold text-primary mb-1">Mizan ERP</div>
          <div className="text-gray-500 text-sm">Activation du logiciel</div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom de l'entreprise</label>
            <input {...register('companyName')} className="input" placeholder="Exactement comme fourni lors de l'achat" />
            {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clé de licence</label>
            <input {...register('licenseKey')} className="input font-mono text-xs" placeholder="Collez votre clé ici" />
            {errors.licenseKey && <p className="text-red-500 text-xs mt-1">{errors.licenseKey.message}</p>}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Vérification...' : 'Activer le logiciel'}
          </button>
        </form>
      </div>
    </div>
  )
}
