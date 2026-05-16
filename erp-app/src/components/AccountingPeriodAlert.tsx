import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import Modal from './ui/Modal'
import { toast } from './ui/Toast'
import { emitRefresh } from '../lib/refresh'

interface AccountingPeriod {
  id: number
  name: string
  start_date: string
  end_date: string
  fiscal_year: number
  status: 'open' | 'closed' | 'locked'
}

export default function AccountingPeriodAlert() {
  const [showAlert, setShowAlert] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState({
    name: `Exercice ${currentYear}`,
    start_date: `${currentYear}-01-01`,
    end_date: `${currentYear}-12-31`,
    fiscal_year: currentYear,
    status: 'open' as const,
    notes: '',
  })

  useEffect(() => {
    checkAccountingPeriods()
  }, [])

  async function checkAccountingPeriods() {
    try {
      const periods = await api.getAccountingPeriods()
      
      // التحقق من وجود فترة مفتوحة للسنة الحالية
      const currentYearPeriod = periods.find((p: AccountingPeriod) => 
        p.fiscal_year === currentYear && p.status === 'open'
      )

      if (!currentYearPeriod && !dismissed) {
        setShowAlert(true)
      }
    } catch (error) {
      console.error('Error checking accounting periods:', error)
    }
  }

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)

    try {
      await api.createAccountingPeriod(form)
      toast('Période comptable créée avec succès', 'success')
      setShowCreateModal(false)
      setShowAlert(false)
      setDismissed(true)
      emitRefresh()
    } catch (error: any) {
      toast(error.message || 'Erreur lors de la création', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleAutoCreate() {
    setCreating(true)

    try {
      await api.createAccountingPeriod({
        name: `Exercice ${currentYear}`,
        start_date: `${currentYear}-01-01`,
        end_date: `${currentYear}-12-31`,
        fiscal_year: currentYear,
        status: 'open',
        notes: 'Période créée automatiquement',
      })
      toast(`Période comptable ${currentYear} créée automatiquement`, 'success')
      setShowAlert(false)
      setDismissed(true)
      emitRefresh()
    } catch (error: any) {
      toast(error.message || 'Erreur lors de la création automatique', 'error')
    } finally {
      setCreating(false)
    }
  }

  function handleDismiss() {
    setShowAlert(false)
    setDismissed(true)
  }

  if (!showAlert) return null

  return (
    <>
      {/* Alert Banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
                Aucune période comptable active
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                Pour garantir la conformité comptable (CGNC), vous devez créer une période comptable 
                pour l'année {currentYear} avant de commencer à enregistrer des opérations.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleAutoCreate}
                  disabled={creating}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {creating ? '⏳ Création...' : '⚡ Créer automatiquement'}
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  disabled={creating}
                  className="px-4 py-1.5 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 transition-colors"
                >
                  📅 Créer manuellement
                </button>
                <button
                  onClick={handleDismiss}
                  disabled={creating}
                  className="px-4 py-1.5 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 transition-colors"
                >
                  Plus tard
                </button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 text-xl"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      {/* Create Period Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Créer une période comptable"
        size="md"
      >
        <form onSubmit={handleCreatePeriod} className="p-6 space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
            <div className="flex gap-2">
              <div className="text-xl">ℹ️</div>
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-1">Création manuelle</p>
                <p>
                  Personnalisez les dates et paramètres de votre période comptable. 
                  Par défaut, elle couvre l'année fiscale complète (1er janvier - 31 décembre).
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nom de la période *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
              placeholder="Ex: Exercice 2026"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date de début *
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date de fin *
              </label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="input"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Année fiscale *
            </label>
            <input
              type="number"
              value={form.fiscal_year}
              onChange={e => setForm(f => ({ ...f, fiscal_year: parseInt(e.target.value) }))}
              className="input"
              min="2000"
              max="2100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes (optionnel)
            </label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input"
              rows={3}
              placeholder="Notes ou remarques sur cette période..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="btn-secondary flex-1 justify-center"
              disabled={creating}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 justify-center"
              disabled={creating}
            >
              {creating ? 'Création...' : '✓ Créer la période'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
