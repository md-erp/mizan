import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'

interface Period {
  id: number
  name: string
  start_date: string
  end_date: string
  fiscal_year: number
  status: 'open' | 'closed' | 'locked'
  closed_by?: number
  closed_at?: string
  notes?: string
}

const STATUS_LABELS = {
  open: { label: 'Ouverte', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', icon: '🟢' },
  closed: { label: 'Clôturée', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', icon: '🟠' },
  locked: { label: 'Verrouillée', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: '🔒' },
}

export default function PeriodesView() {
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    fiscal_year: new Date().getFullYear(),
    status: 'open' as 'open' | 'closed' | 'locked',
    notes: '',
  })

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.getAccountingPeriods()
      setPeriods(data as Period[])
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function openForm(period?: Period) {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() // 0-11
    
    if (period) {
      setEditingId(period.id)
      setForm({
        name: period.name,
        start_date: period.start_date,
        end_date: period.end_date,
        fiscal_year: period.fiscal_year,
        status: period.status,
        notes: period.notes ?? '',
      })
    } else {
      // تواريخ تلقائية للشهر الحالي
      const startDate = new Date(currentYear, currentMonth, 1)
      const endDate = new Date(currentYear, currentMonth + 1, 0) // آخر يوم من الشهر
      
      const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                          'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
      
      setEditingId(null)
      setForm({
        name: `${monthNames[currentMonth]} ${currentYear}`,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        fiscal_year: currentYear,
        status: 'open',
        notes: '',
      })
    }
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingId) {
        await api.updateAccountingPeriod({ id: editingId, ...form })
        toast('Période modifiée', 'success')
      } else {
        await api.createAccountingPeriod(form)
        toast('Période créée', 'success')
      }
      setShowForm(false)
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Supprimer cette période ? Les écritures liées perdront leur référence de période.')) return
    try {
      await api.deleteAccountingPeriod(id)
      toast('Période supprimée', 'success')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  async function handleChangeStatus(id: number, newStatus: 'open' | 'closed' | 'locked') {
    try {
      await api.updateAccountingPeriod({ id, status: newStatus })
      toast('Statut modifié', 'success')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Périodes comptables</h2>
        <button onClick={() => openForm()} className="btn-primary btn-sm">
          ➕ Nouvelle période
        </button>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center h-40 text-gray-400">
          Chargement...
        </div>
      ) : periods.length === 0 ? (
        <div className="card flex flex-col items-center justify-center h-40 text-gray-400">
          <div className="text-3xl mb-2">📅</div>
          <div className="text-sm">Aucune période comptable définie</div>
          <button onClick={() => openForm()} className="btn-primary btn-sm mt-3">
            Créer la première période
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Période</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exercice</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {periods.map(p => {
                const cfg = STATUS_LABELS[p.status]
                return (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-gray-100">{p.name}</div>
                      {p.notes && (
                        <div className="text-xs text-gray-400 mt-0.5">{p.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                      {new Date(p.start_date).toLocaleDateString('fr-FR')}
                      {' → '}
                      {new Date(p.end_date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300">
                      {p.fiscal_year}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* أزرار تغيير الحالة */}
                        {p.status === 'open' && (
                          <button
                            onClick={() => handleChangeStatus(p.id, 'closed')}
                            className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-300 transition-colors"
                            title="Clôturer la période">
                            Clôturer
                          </button>
                        )}
                        {p.status === 'closed' && (
                          <>
                            <button
                              onClick={() => handleChangeStatus(p.id, 'open')}
                              className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 transition-colors"
                              title="Rouvrir la période">
                              Rouvrir
                            </button>
                            <button
                              onClick={() => handleChangeStatus(p.id, 'locked')}
                              className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 transition-colors"
                              title="Verrouiller définitivement">
                              Verrouiller
                            </button>
                          </>
                        )}
                        
                        {/* أزرار التعديل والحذف */}
                        <button
                          onClick={() => openForm(p)}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 transition-colors"
                          title="Modifier">
                          ✏️
                        </button>
                        {p.status !== 'locked' && (
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 transition-colors"
                            title="Supprimer">
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Modifier la période' : 'Nouvelle période'}
        size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom de la période *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="input"
              placeholder="Ex: Janvier 2026, T1 2026..."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Date début *</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date fin *</label>
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
            <label className="block text-sm font-medium mb-1">Exercice fiscal *</label>
            <input
              type="number"
              value={form.fiscal_year}
              onChange={e => setForm(f => ({ ...f, fiscal_year: Number(e.target.value) }))}
              className="input"
              min="2000"
              max="2100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Statut</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
              className="input">
              <option value="open">🟢 Ouverte</option>
              <option value="closed">🟠 Clôturée</option>
              <option value="locked">🔒 Verrouillée</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input resize-none"
              rows={2}
              placeholder="Remarques..."
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button type="submit" className="btn-primary flex-1">
              {editingId ? 'Modifier' : 'Créer'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Annuler
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
