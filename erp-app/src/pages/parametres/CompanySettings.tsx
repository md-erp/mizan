import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import { useAppStore } from '../../store/app.store'
import type { DeviceConfig } from '../../types'

export default function CompanySettings() {
  const { config, setConfig } = useAppStore()
  const [form, setForm] = useState({
    company_name: '', company_ice: '', company_if: '', company_rc: '',
    company_address: '', company_city: '', company_country: 'Maroc',
    company_phone: '', company_fax: '', company_email: '', company_website: '',
    company_cnss: '', company_patente: '', company_capital: '', company_legal_form: '',
    company_bank_name: '', company_bank_rib: '', company_bank_account: '',
    company_logo: '',
    company_logo_width: 0 as number,
    company_logo_height: 0 as number,
  })
  const [saving, setSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (config) {
      setForm({
        company_name: config.company_name ?? '',
        company_ice: config.company_ice ?? '',
        company_if: config.company_if ?? '',
        company_rc: config.company_rc ?? '',
        company_address: config.company_address ?? '',
        company_city: config.company_city ?? '',
        company_country: config.company_country ?? 'Maroc',
        company_phone: config.company_phone ?? '',
        company_fax: config.company_fax ?? '',
        company_email: config.company_email ?? '',
        company_website: config.company_website ?? '',
        company_cnss: config.company_cnss ?? '',
        company_patente: (config as any).company_patente ?? '',
        company_capital: config.company_capital ?? '',
        company_legal_form: config.company_legal_form ?? '',
        company_bank_name: config.company_bank_name ?? '',
        company_bank_rib: config.company_bank_rib ?? '',
        company_bank_account: config.company_bank_account ?? '',
        company_logo: config.company_logo ?? '',
        company_logo_width: (config as any).company_logo_width ?? 0,
        company_logo_height: (config as any).company_logo_height ?? 0,
      })
      if (config.company_logo) {
        setLogoPreview(config.company_logo)
      }
    }
  }, [config])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveConfig(form)
      const updated = await api.getConfig() as DeviceConfig
      setConfig(updated)
      toast('Informations sauvegardées')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast('Veuillez sélectionner une image', 'error')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      setLogoPreview(base64)

      // Measure the actual pixel dimensions of the image
      const img = new Image()
      img.onload = () => {
        setForm(f => ({
          ...f,
          company_logo: base64,
          company_logo_width: img.naturalWidth,
          company_logo_height: img.naturalHeight,
        }))
      }
      img.src = base64
    }
    reader.readAsDataURL(file)
  }

  function handleRemoveLogo() {
    setLogoPreview('')
    setForm(f => ({ ...f, company_logo: '' }))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const field = (key: keyof typeof form, label: string, placeholder = '', required = false) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="input"
        placeholder={placeholder}
        required={required}
      />
    </div>
  )

  return (
    <div className="max-w-4xl">
      <h2 className="text-lg font-semibold mb-6">Informations de l'entreprise</h2>

      <form onSubmit={e => { e.stopPropagation(); handleSave(e) }} className="space-y-6">
        {/* Logo Section */}
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Logo de l'entreprise
          </label>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              {logoPreview ? (
                <div className="relative">
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="w-32 h-32 object-contain border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition-colors"
                    title="Supprimer le logo"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="w-32 h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-gray-700">
                  <span className="text-gray-400 text-sm">Aucun logo</span>
                </div>
              )}
            </div>
            <div className="flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
                id="logo-upload"
              />
              <label
                htmlFor="logo-upload"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600 transition-colors"
              >
                📁 Choisir une image
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Formats acceptés: JPG, PNG, GIF. Taille recommandée: 200x200px
              </p>
            </div>
          </div>
        </div>

        {/* Basic Information */}
        <div className="space-y-4">
          <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 border-b pb-2">
            Informations générales
          </h3>
          {field('company_name', 'Nom de l\'entreprise', 'Nom officiel', true)}

          <div className="grid grid-cols-2 gap-4">
            {field('company_legal_form', 'Forme juridique', 'S.A.R.L, S.A, etc.')}
            {field('company_capital', 'Capital social', '100000.00 dhs')}
          </div>
        </div>

        {/* Tax Information */}
        <div className="space-y-4">
          <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 border-b pb-2">
            Informations fiscales
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {field('company_ice', 'ICE', '000000000000000')}
            {field('company_if', 'IF', '12345678')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('company_rc', 'RC', 'RC12345')}
            {field('company_cnss', 'CNSS', '1234567')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('company_patente', 'Patente / TP', '12345678')}
            <div></div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="space-y-4">
          <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 border-b pb-2">
            Coordonnées
          </h3>
          {field('company_address', 'Adresse', 'Rue, N°, Quartier')}
          <div className="grid grid-cols-2 gap-4">
            {field('company_city', 'Ville', 'Casablanca')}
            {field('company_country', 'Pays', 'Maroc')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('company_phone', 'Téléphone', '+212 5 22 00 00 00')}
            {field('company_fax', 'Fax', '+212 5 22 00 00 01')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('company_email', 'Email', 'contact@entreprise.ma')}
            {field('company_website', 'Site web', 'www.entreprise.ma')}
          </div>
        </div>

        {/* Bank Information */}
        <div className="space-y-4">
          <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 border-b pb-2">
            Informations bancaires
          </h3>
          {field('company_bank_name', 'Nom de la banque', 'Banque Crédit du Maroc')}
          <div className="grid grid-cols-2 gap-4">
            {field('company_bank_rib', 'RIB', '230107450001234567890123')}
            {field('company_bank_account', 'N° de compte', '450001234567890123')}
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-4 border-t">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Sauvegarde...' : '💾 Sauvegarder'}
          </button>
        </div>
      </form>
    </div>
  )
}
