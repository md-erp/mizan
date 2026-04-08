/**
 * Personnalisation du modèle de facture
 * Couleurs, pied de page, conditions de paiement, affichage des colonnes
 */
import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'

interface TemplateSettings {
  primary_color:    string
  accent_color:     string
  invoice_footer:   string
  payment_terms:    string
  show_bank_details: string
  bank_name:        string
  bank_rib:         string
  show_stamp_area:  string
  invoice_prefix:   string
  quote_prefix:     string
  bl_prefix:        string
  proforma_prefix:  string
  avoir_prefix:     string
  po_prefix:        string
  reception_prefix: string
  pinvoice_prefix:  string
  import_prefix:    string
}

const DEFAULTS: TemplateSettings = {
  primary_color:    '#1E3A5F',
  accent_color:     '#F0A500',
  invoice_footer:   'Merci pour votre confiance',
  payment_terms:    'Paiement à 30 jours',
  show_bank_details:'0',
  bank_name:        '',
  bank_rib:         '',
  show_stamp_area:  '1',
  invoice_prefix:   'F',
  quote_prefix:     'D',
  bl_prefix:        'BL',
  proforma_prefix:  'PRO',
  avoir_prefix:     'AV',
  po_prefix:        'BC',
  reception_prefix: 'BR',
  pinvoice_prefix:  'FF',
  import_prefix:    'IMP',
}

export default function InvoiceTemplateSettings() {
  const [settings, setSettings] = useState<TemplateSettings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.settingsGet().then((r: any) => {
      if (r) setSettings(prev => ({ ...prev, ...r }))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.settingsSetMany(settings as any)
      toast('Modèle de facture sauvegardé ✓')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function set(key: keyof TemplateSettings, val: string) {
    setSettings(prev => ({ ...prev, [key]: val }))
  }

  if (loading) return <div className="text-gray-400 text-sm">Chargement...</div>

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold">Modèle de facture</h2>

      <form onSubmit={handleSave} className="space-y-8">

        {/* Couleurs */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Couleurs
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Couleur principale</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={settings.primary_color}
                  onChange={e => set('primary_color', e.target.value)}
                  className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer"
                />
                <input
                  value={settings.primary_color}
                  onChange={e => set('primary_color', e.target.value)}
                  className="input flex-1 font-mono text-sm"
                  placeholder="#1E3A5F"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Couleur accent</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={settings.accent_color}
                  onChange={e => set('accent_color', e.target.value)}
                  className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer"
                />
                <input
                  value={settings.accent_color}
                  onChange={e => set('accent_color', e.target.value)}
                  className="input flex-1 font-mono text-sm"
                  placeholder="#F0A500"
                />
              </div>
            </div>
          </div>

          {/* Aperçu couleurs */}
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 text-white text-sm font-medium flex justify-between"
              style={{ backgroundColor: settings.primary_color }}>
              <span>FACTURE N° F-2026-0001</span>
              <span style={{ color: settings.accent_color }}>Aperçu</span>
            </div>
            <div className="px-4 py-2 bg-white dark:bg-gray-800 text-xs text-gray-500">
              Aperçu de l'en-tête avec vos couleurs
            </div>
          </div>
        </section>

        {/* Textes */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Textes
          </h3>
          <div>
            <label className="block text-sm font-medium mb-1">Pied de page</label>
            <input
              value={settings.invoice_footer}
              onChange={e => set('invoice_footer', e.target.value)}
              className="input"
              placeholder="Merci pour votre confiance"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Conditions de paiement</label>
            <input
              value={settings.payment_terms}
              onChange={e => set('payment_terms', e.target.value)}
              className="input"
              placeholder="Paiement à 30 jours"
            />
          </div>
        </section>

        {/* Coordonnées bancaires */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Coordonnées bancaires
          </h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.show_bank_details === '1'}
              onChange={e => set('show_bank_details', e.target.checked ? '1' : '0')}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Afficher les coordonnées bancaires sur la facture</span>
          </label>
          {settings.show_bank_details === '1' && (
            <div className="grid grid-cols-2 gap-3 pl-7">
              <div>
                <label className="block text-sm font-medium mb-1">Banque</label>
                <input value={settings.bank_name} onChange={e => set('bank_name', e.target.value)}
                  className="input" placeholder="Attijariwafa Bank" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">RIB / IBAN</label>
                <input value={settings.bank_rib} onChange={e => set('bank_rib', e.target.value)}
                  className="input font-mono" placeholder="007 780 0000000000000000 00" />
              </div>
            </div>
          )}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.show_stamp_area === '1'}
              onChange={e => set('show_stamp_area', e.target.checked ? '1' : '0')}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Afficher la zone "Cachet & Signature"</span>
          </label>
        </section>

        {/* Préfixes de numérotation */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Préfixes de numérotation
          </h3>
          <p className="text-xs text-gray-400">Format: {'{PRÉFIXE}'}-{'{ANNÉE}'}-{'{SÉQUENCE}'} — ex: F-2026-0001</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'invoice_prefix',   label: 'Facture' },
              { key: 'quote_prefix',     label: 'Devis' },
              { key: 'bl_prefix',        label: 'Bon de Livraison' },
              { key: 'proforma_prefix',  label: 'Proforma' },
              { key: 'avoir_prefix',     label: 'Avoir' },
              { key: 'po_prefix',        label: 'Bon de Commande' },
              { key: 'reception_prefix', label: 'Bon de Réception' },
              { key: 'pinvoice_prefix',  label: 'Facture Fourn.' },
              { key: 'import_prefix',    label: 'Importation' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input
                  value={(settings as any)[key]}
                  onChange={e => set(key as keyof TemplateSettings, e.target.value.toUpperCase())}
                  className="input font-mono text-sm"
                  maxLength={6}
                  placeholder="F"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Sauvegarde...' : '💾 Sauvegarder le modèle'}
          </button>
        </div>
      </form>
    </div>
  )
}
