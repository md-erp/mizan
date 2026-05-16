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

const STEPS = ['Activation', 'Réseau', 'Administrateur']

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
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="card w-full max-w-lg p-8">

        {/* شريط الخطوات */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${i === 0 ? 'bg-primary text-white' : 'bg-gray-200 text-gray-400'}`}>
                {i + 1}
              </div>
              <span className={`text-xs ${i === 0 ? 'text-primary font-medium' : 'text-gray-400'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* العنوان */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Activation du logiciel</h2>
          <p className="text-sm text-gray-500 mt-1">Entrez les informations fournies lors de l'achat</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom de l'entreprise</label>
            <input {...register('companyName')} className="input"
              placeholder="Exactement comme fourni lors de l'achat" autoFocus />
            {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Clé de licence</label>
            <input {...register('licenseKey')} className="input font-mono text-sm"
              placeholder="Collez votre clé ici" />
            {errors.licenseKey && <p className="text-red-500 text-xs mt-1">{errors.licenseKey.message}</p>}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <span className="mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2">
            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? 'Vérification...' : 'Suivant →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
