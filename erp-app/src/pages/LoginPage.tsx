import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '../lib/api'
import { useAuthStore } from '../store/auth.store'
import { useAppStore } from '../store/app.store'
import type { User } from '../types'

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const { config, license } = useAppStore()
  const { register, handleSubmit } = useForm<{ email: string; password: string }>()

  async function onSubmit(data: { email: string; password: string }) {
    setLoading(true)
    setError('')
    try {
      const user = await api.login(data) as User
      login(user)
      onLogin()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-primary p-12">
        <div className="text-white">
          <div className="text-3xl font-bold">Mizan ERP</div>
          <div className="text-primary-100 mt-1 text-sm">Gestion comptable & commerciale</div>
        </div>
        <div className="text-primary-200 text-xs">
          {config?.company_name && <div className="font-medium text-white">{config.company_name}</div>}
          {license && <div>Licence valide jusqu'au {new Date(license.expiryDate).toLocaleDateString('fr-FR')}</div>}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Connexion</h1>
          <p className="text-gray-500 text-sm mb-8">Entrez vos identifiants pour accéder au système</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input {...register('email')} type="email" className="input" placeholder="admin@entreprise.ma" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mot de passe</label>
              <input {...register('password')} type="password" className="input" placeholder="••••••••" required />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
