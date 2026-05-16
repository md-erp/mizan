import { useState } from 'react'
import { useAppStore } from '../../store/app.store'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import type { LicenseInfo } from '../../types'

// ── Validation locale de la clé (avant envoi au backend) ──────────────────
function b64decode(str: string): string {
  try { return atob(str) } catch { return '' }
}

function preValidateKey(key: string): { ok: boolean; reason?: string } {
  const k = key.trim()
  if (!k) return { ok: false, reason: 'Clé vide' }
  const parts = k.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'Format invalide — la clé doit contenir exactement un point (.)' }
  const [payload, sig] = parts
  const decoded = b64decode(payload)
  if (!decoded || !decoded.includes('|')) {
    return { ok: false, reason: 'Payload corrompu — la clé semble tronquée ou modifiée' }
  }
  if (sig.length !== 16) return { ok: false, reason: 'Signature invalide — longueur incorrecte' }
  if (!/^[A-F0-9]{16}$/.test(sig)) return { ok: false, reason: 'Signature invalide — caractères non reconnus' }
  return { ok: true }
}

// ── Décoder les infos de la clé sans vérifier la signature ────────────────
function decodeKeyPreview(key: string, company: string): {
  encodedCompany: string
  expiryDate: string
  isLifetime: boolean
  companyMatch: boolean
} | null {
  try {
    const [payload] = key.trim().split('.')
    const decoded = b64decode(payload)
    if (!decoded) return null
    const sep = decoded.lastIndexOf('|')
    if (sep === -1) return null
    const encodedCompany = decoded.substring(0, sep)
    const expiryDate = decoded.substring(sep + 1)
    const isLifetime = expiryDate.startsWith('9999')
    const companyMatch = encodedCompany.trim().toLowerCase() === company.trim().toLowerCase()
    return { encodedCompany, expiryDate, isLifetime, companyMatch }
  } catch { return null }
}

type ActivationState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'success'; message: string; isLifetime: boolean; expiryDate: string }
  | { status: 'error'; code: 'wrong_company' | 'invalid_sig' | 'expired_key' | 'already_active' | 'format' | 'unknown'; message: string }

export default function LicenseSettings() {
  const { license, setLicense } = useAppStore()
  const [renewKey, setRenewKey]         = useState('')
  const [renewCompany, setRenewCompany] = useState('')
  const [showRenew, setShowRenew]       = useState(false)
  const [activation, setActivation]     = useState<ActivationState>({ status: 'idle' })
  const [keyPreview, setKeyPreview]     = useState<ReturnType<typeof decodeKeyPreview>>(null)

  function openRenew() {
    setRenewCompany(license?.companyName ?? '')
    setRenewKey('')
    setActivation({ status: 'idle' })
    setKeyPreview(null)
    setShowRenew(true)
  }

  // Analyse en temps réel quand l'utilisateur tape
  function handleKeyChange(val: string) {
    setRenewKey(val)
    setActivation({ status: 'idle' })
    if (val.trim().length > 10) {
      const pre = preValidateKey(val)
      if (pre.ok) {
        setKeyPreview(decodeKeyPreview(val, renewCompany))
      } else {
        setKeyPreview(null)
      }
    } else {
      setKeyPreview(null)
    }
  }

  function handleCompanyChange(val: string) {
    setRenewCompany(val)
    if (renewKey.trim().length > 10) {
      setKeyPreview(decodeKeyPreview(renewKey, val))
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault()
    const company = renewCompany.trim()
    const key     = renewKey.trim()
    if (!company || !key) return

    // 1. Validation format locale
    const pre = preValidateKey(key)
    if (!pre.ok) {
      setActivation({ status: 'error', code: 'format', message: pre.reason! })
      return
    }

    // 2. Vérification préliminaire du contenu
    const preview = decodeKeyPreview(key, company)
    if (preview) {
      if (!preview.companyMatch) {
        setActivation({
          status: 'error',
          code: 'wrong_company',
          message: `Le nom d'entreprise ne correspond pas. La clé est enregistrée pour "${preview.encodedCompany}", mais vous avez saisi "${company}".`,
        })
        return
      }
      if (!preview.isLifetime) {
        const expiry = new Date(preview.expiryDate)
        if (expiry < new Date()) {
          setActivation({
            status: 'error',
            code: 'expired_key',
            message: `Cette clé a expiré le ${expiry.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}. Contactez votre revendeur pour une nouvelle clé.`,
          })
          return
        }
      }
    }

    // 3. Vérifier si c'est la même clé déjà active
    if (
      license &&
      !license.isExpired &&
      license.companyName.toLowerCase() === company.toLowerCase() &&
      preview && !preview.isLifetime
    ) {
      const currentExpiry = new Date(license.expiryDate)
      const newExpiry = preview ? new Date(preview.expiryDate) : null
      if (newExpiry && Math.abs(currentExpiry.getTime() - newExpiry.getTime()) < 86400000) {
        setActivation({
          status: 'error',
          code: 'already_active',
          message: 'Cette licence est déjà active sur ce poste. Aucune modification nécessaire.',
        })
        return
      }
    }

    // 4. Envoi au backend
    setActivation({ status: 'validating' })
    try {
      await api.activateLicense({ companyName: company, licenseKey: key })
      const updated = await api.getLicense() as LicenseInfo
      setLicense(updated)

      const isLifetime = updated.expiryDate?.startsWith('9999') ?? false
      const expiryFormatted = isLifetime
        ? 'Illimitée'
        : new Date(updated.expiryDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

      setActivation({
        status: 'success',
        message: isLifetime
          ? `Licence permanente activée pour "${updated.companyName}". L'application est déverrouillée sans limite de durée.`
          : `Licence activée avec succès pour "${updated.companyName}" jusqu'au ${expiryFormatted}.`,
        isLifetime,
        expiryDate: expiryFormatted,
      })

      toast(isLifetime ? '🔓 Licence permanente activée ✓' : '✅ Licence activée avec succès', 'success' as any)
      setTimeout(() => setShowRenew(false), 2500)
    } catch (err: any) {
      const msg: string = err.message ?? ''
      let code: Extract<ActivationState, { status: 'error' }>['code'] = 'unknown'
      let userMsg = msg

      if (msg.toLowerCase().includes('entreprise') || msg.toLowerCase().includes('company')) {
        code = 'wrong_company'
        userMsg = `Nom d'entreprise incorrect. Vérifiez l'orthographe exacte (majuscules comprises).`
      } else if (msg.toLowerCase().includes('invalide') || msg.toLowerCase().includes('signature') || msg.toLowerCase().includes('corrompu')) {
        code = 'invalid_sig'
        userMsg = 'Clé de licence invalide ou corrompue. Vérifiez que vous avez copié la clé complète sans espaces.'
      } else if (msg.toLowerCase().includes('expir')) {
        code = 'expired_key'
        userMsg = 'Cette clé de licence a expiré. Contactez votre revendeur pour un renouvellement.'
      } else if (msg.toLowerCase().includes('format')) {
        code = 'format'
        userMsg = 'Format de clé incorrect. La clé doit être au format: PAYLOAD.SIGNATURE'
      }

      setActivation({ status: 'error', code, message: userMsg })
      toast('Activation échouée', 'error')
    }
  }

  const daysColor = !license ? 'text-gray-500'
    : license.isExpired      ? 'text-red-600'
    : license.isExpiringSoon ? 'text-orange-500'
    : 'text-green-600'

  const isLifetimeLicense = license?.expiryDate?.startsWith('9999')

  // Indicateur visuel de la clé en cours de saisie
  const keyFormatOk = renewKey.trim().length > 10 && preValidateKey(renewKey).ok
  const companyMatchOk = keyPreview?.companyMatch ?? null

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold mb-6">Informations de licence</h2>

      {/* ── Carte statut actuel ── */}
      <div className="card p-5 space-y-4">

        {/* Statut global */}
        <div className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium
          ${isLifetimeLicense
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
            : license?.isExpired
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              : license?.isExpiringSoon
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
          }`}>
          <span className="text-xl">
            {isLifetimeLicense ? '🔓' : license?.isExpired ? '🔴' : license?.isExpiringSoon ? '⚠️' : '✅'}
          </span>
          <span>
            {isLifetimeLicense
              ? 'Licence permanente — aucune expiration'
              : license?.isExpired
                ? 'Licence expirée — mode lecture seule'
                : license?.isExpiringSoon
                  ? `Expire dans ${license.daysRemaining} jour${license.daysRemaining > 1 ? 's' : ''} — renouvelez bientôt`
                  : `Licence active — ${license?.daysRemaining ?? 0} jours restants`}
          </span>
        </div>

        <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
          <span className="text-sm text-gray-500">Entreprise</span>
          <span className="font-semibold">{license?.companyName ?? '—'}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
          <span className="text-sm text-gray-500">Date d'expiration</span>
          <span className="font-medium">
            {isLifetimeLicense
              ? <span className="text-green-600 font-bold">Illimitée ∞</span>
              : license
                ? new Date(license.expiryDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
                : '—'}
          </span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-gray-500">Jours restants</span>
          <span className={`text-xl font-bold ${daysColor}`}>
            {isLifetimeLicense ? '∞' : license?.isExpired ? 'Expirée' : `${license?.daysRemaining ?? 0} jours`}
          </span>
        </div>
      </div>

      {/* ── Formulaire d'activation ── */}
      <div className="mt-4">
        {!showRenew ? (
          <button onClick={openRenew} className="btn-secondary">
            🔑 Activer / Renouveler la licence
          </button>
        ) : (
          <form onSubmit={e => { e.stopPropagation(); handleActivate(e) }} className="card p-5 space-y-4">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Activation de licence
            </div>

            {/* Entreprise */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Nom d'entreprise <span className="text-red-500">*</span>
              </label>
              <input
                value={renewCompany}
                onChange={e => handleCompanyChange(e.target.value)}
                className={`input text-sm ${
                  keyPreview !== null
                    ? companyMatchOk ? 'border-green-400 focus:ring-green-300' : 'border-red-400 focus:ring-red-300'
                    : ''
                }`}
                placeholder="Nom exact tel qu'enregistré dans la clé"
                required
                autoFocus
              />
              {keyPreview !== null && (
                <p className={`text-[10px] mt-1 flex items-center gap-1 ${companyMatchOk ? 'text-green-600' : 'text-red-500'}`}>
                  {companyMatchOk
                    ? <><span>✓</span> Correspond à la clé</>
                    : <><span>✗</span> La clé est pour "{keyPreview.encodedCompany}" — corrigez le nom</>}
                </p>
              )}
            </div>

            {/* Clé */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Clé de licence <span className="text-red-500">*</span>
              </label>
              <input
                value={renewKey}
                onChange={e => handleKeyChange(e.target.value)}
                className={`input font-mono text-xs ${
                  renewKey.trim().length > 10 && !keyFormatOk
                    ? 'border-red-400 focus:ring-red-300'
                    : activation.status === 'success'
                      ? 'border-green-400 focus:ring-green-300'
                      : ''
                }`}
                placeholder="PAYLOAD.SIGNATURE"
                required
              />

              {/* Aperçu de la clé */}
              {keyPreview && keyFormatOk && (
                <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Entreprise dans la clé</span>
                    <span className={`font-medium ${companyMatchOk ? 'text-green-600' : 'text-red-500'}`}>
                      {keyPreview.encodedCompany}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Expiration (non vérifiée)</span>
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {keyPreview.isLifetime
                        ? '∞ Permanente'
                        : new Date(keyPreview.expiryDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Signature</span>
                    <span className="text-amber-500 font-medium">⏳ En attente de vérification</span>
                  </div>
                </div>
              )}

              {renewKey.trim().length > 10 && !keyFormatOk && (
                <p className="text-[10px] text-red-500 mt-1">
                  ✗ {preValidateKey(renewKey).reason}
                </p>
              )}
            </div>

            {/* Résultat activation */}
            {activation.status === 'validating' && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-400">
                <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Vérification de la clé en cours...
              </div>
            )}

            {activation.status === 'success' && (
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">{activation.isLifetime ? '🔓' : '✅'}</span>
                  <div>
                    <div className="font-semibold mb-0.5">Activation réussie</div>
                    <div className="text-xs opacity-90">{activation.message}</div>
                  </div>
                </div>
              </div>
            )}

            {activation.status === 'error' && (() => {
              const err = activation as Extract<ActivationState, { status: 'error' }>
              return (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">
                    {err.code === 'wrong_company' ? '🏢' :
                     err.code === 'expired_key'   ? '📅' :
                     err.code === 'already_active'? '✅' :
                     err.code === 'invalid_sig'   ? '🔐' : '❌'}
                  </span>
                  <div>
                    <div className="font-semibold mb-0.5">
                      {err.code === 'wrong_company'  ? "Nom d'entreprise incorrect" :
                       err.code === 'expired_key'    ? 'Clé expirée' :
                       err.code === 'already_active' ? 'Déjà active' :
                       err.code === 'invalid_sig'    ? 'Clé invalide' :
                       err.code === 'format'         ? 'Format incorrect' :
                       'Activation échouée'}
                    </div>
                    <div className="text-xs opacity-90">{err.message}</div>
                  </div>
                </div>
              </div>
              )
            })()}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowRenew(false)} className="btn-secondary flex-1 justify-center">
                Annuler
              </button>
              <button
                type="submit"
                disabled={
                  activation.status === 'validating' ||
                  activation.status === 'success' ||
                  !renewCompany.trim() ||
                  !renewKey.trim()
                }
                className="btn-primary flex-1 justify-center"
              >
                {activation.status === 'validating' ? 'Vérification...' : '✅ Activer'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
