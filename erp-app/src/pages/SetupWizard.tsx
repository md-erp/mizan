import { useState } from 'react'
import { api } from '../lib/api'

const STEPS = ['Entreprise', 'Réseau', 'Administrateur']

// نستخدم state منفصل لكل حقل بدل useForm لتجنب مشكلة reset
export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Étape 1
  const [companyName, setCompanyName]     = useState('')
  const [companyIce, setCompanyIce]       = useState('')
  const [companyIf, setCompanyIf]         = useState('')
  const [companyRc, setCompanyRc]         = useState('')
  const [companyPhone, setCompanyPhone]   = useState('')
  const [companyAddress, setCompanyAddress] = useState('')

  // Étape 2
  const [mode, setMode] = useState<'standalone' | 'master' | 'client'>('standalone')
  const [serverIp, setServerIp]     = useState('')
  const [serverPort, setServerPort] = useState('3000')

  // Étape 3
  const [adminName, setAdminName]         = useState('')
  const [adminEmail, setAdminEmail]       = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  function nextStep(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      handleFinish()
    }
  }

  async function handleFinish() {
    if (!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()) {
      setError('Veuillez remplir tous les champs obligatoires.')
      return
    }
    if (adminPassword.length < 4) {
      setError('Le mot de passe doit contenir au moins 4 caractères.')
      return
    }

    setLoading(true)
    setError('')
    try {
      await api.saveConfig({
        company_name:    companyName.trim(),
        company_ice:     companyIce.trim() || '',
        company_if:      companyIf.trim() || '',
        company_rc:      companyRc.trim() || '',
        company_address: companyAddress.trim() || '',
        company_phone:   companyPhone.trim() || '',
        mode,
        server_ip:       mode === 'client' ? serverIp.trim() : '',
        server_port:     mode === 'client' ? (Number(serverPort) || 3000) : 3000,
        setup_done:      true,
      })
      await api.createUser({
        name:     adminName.trim(),
        email:    adminEmail.trim(),
        password: adminPassword,
        role:     'admin',
      })
      onComplete()
    } catch (e: any) {
      const msg = e.message ?? ''
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        setError('Cet email est déjà utilisé.')
      } else {
        setError(msg || 'Une erreur inattendue est survenue.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="card w-full max-w-lg p-8">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${i <= step ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'}`}>
                {i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'text-primary font-medium' : 'text-gray-400'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-primary' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <form onSubmit={nextStep} className="space-y-4">
          {/* Étape 1 */}
          {step === 0 && (
            <>
              <h2 className="text-lg font-semibold mb-4">Informations de l'entreprise</h2>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                className="input" placeholder="Nom de l'entreprise *" required autoFocus />
              <div className="grid grid-cols-2 gap-3">
                <input value={companyIce} onChange={e => setCompanyIce(e.target.value)}
                  className="input" placeholder="ICE" />
                <input value={companyIf} onChange={e => setCompanyIf(e.target.value)}
                  className="input" placeholder="IF" />
                <input value={companyRc} onChange={e => setCompanyRc(e.target.value)}
                  className="input" placeholder="RC" />
                <input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)}
                  className="input" placeholder="Téléphone" />
              </div>
              <input value={companyAddress} onChange={e => setCompanyAddress(e.target.value)}
                className="input" placeholder="Adresse" />
            </>
          )}

          {/* Étape 2 */}
          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold mb-4">Mode de fonctionnement</h2>
              <div className="grid grid-cols-1 gap-3">
                {([
                  { value: 'standalone', label: '🖥️ Poste unique',    desc: 'Un seul ordinateur, base de données locale' },
                  { value: 'master',     label: '🌐 Serveur réseau',   desc: 'Ce poste héberge les données pour le réseau' },
                  { value: 'client',     label: '💻 Client réseau',    desc: 'Ce poste se connecte à un serveur existant' },
                ] as const).map(opt => (
                  <label key={opt.value} onClick={() => setMode(opt.value)}
                    className={`card p-4 cursor-pointer border-2 transition-all flex items-start gap-3
                      ${mode === opt.value ? 'border-primary bg-primary/5' : 'border-transparent hover:border-gray-200'}`}>
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center
                      ${mode === opt.value ? 'border-primary' : 'border-gray-300'}`}>
                      {mode === opt.value && <div className="w-2 h-2 rounded-full bg-primary"></div>}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              {(mode === 'client') && (
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <input value={serverIp} onChange={e => setServerIp(e.target.value)}
                    className="input col-span-2" placeholder="IP du serveur (ex: 192.168.1.10)" required />
                  <input value={serverPort} onChange={e => setServerPort(e.target.value)}
                    className="input" placeholder="Port (3000)" />
                </div>
              )}
            </>
          )}

          {/* Étape 3 */}
          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold mb-4">Compte administrateur</h2>
              <input value={adminName} onChange={e => setAdminName(e.target.value)}
                className="input" placeholder="Nom complet *" required autoFocus />
              <input value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                className="input" placeholder="Email *" type="email" required />
              <input value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                className="input" placeholder="Mot de passe * (min. 4 caractères)" type="password" required />
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <span className="text-red-500 mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {step > 0 && (
              <button type="button" onClick={() => { setStep(s => s - 1); setError('') }}
                className="btn-secondary flex-1 justify-center">
                ← Retour
              </button>
            )}
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={loading}>
              {step < STEPS.length - 1 ? 'Suivant →' : loading ? 'Configuration...' : '✅ Terminer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
