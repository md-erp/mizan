import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ProductionForm from './ProductionForm'

const STATUS = {
  draft:     { label: 'Brouillon', cls: 'badge-gray' },
  confirmed: { label: 'Confirmé',  cls: 'badge-green' },
  cancelled: { label: 'Annulé',    cls: 'badge-red' },
}

export default function ProductionList() {
  const { user } = useAuthStore()
  const userId = user?.id ?? 1

  const [rows, setRows]       = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [cancelId, setCancelId]   = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api.getProductionOrders() as any[]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleConfirm() {
    if (!confirmId) return
    try {
      await api.confirmProduction(confirmId, userId)
      toast('Production confirmée — Stock mis à jour')
      load()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setConfirmId(null) }
  }

  async function handleCancel() {
    if (!cancelId) return
    try {
      await api.cancelProduction(cancelId, userId)
      toast('Ordre annulé')
      load()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setCancelId(null) }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const totalCost   = rows.reduce((s, r) => s + (r.total_cost ?? 0), 0)
  const confirmed   = rows.filter(r => r.status === 'confirmed').length
  const drafts      = rows.filter(r => r.status === 'draft').length

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── Bouton ── */}
      <div className="shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
          onClick={() => setModalOpen(true)}>
          + Nouvel Ordre de Production
        </button>
      </div>

      {/* ── KPI cards ── */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
          {[
            { label: 'Total ordres',   value: String(rows.length),      color: 'text-primary',   bg: 'bg-primary/5',                      icon: '🏭' },
            { label: 'Confirmés',      value: String(confirmed),        color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10',  icon: '✅' },
            { label: 'Brouillons',     value: String(drafts),           color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10',  icon: '📝' },
            { label: 'Coût total',     value: fmt(totalCost) + ' MAD',  color: 'text-gray-700',  bg: 'bg-gray-50 dark:bg-gray-700/30',    icon: '💰' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="text-lg mb-1">{c.icon}</div>
              <div className="text-xs text-gray-400 mb-1">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={load} className="btn-secondary btn-sm">↻ Actualiser</button>
        <span className="text-sm text-gray-500 ml-auto">{rows.length} ordre(s)</span>
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Produit fini</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Quantité</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût unitaire</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût total</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Statut</th>
              <th className="px-4 py-3 w-36"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(7)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-16">
                <div className="text-4xl mb-3">🏭</div>
                <div className="text-gray-500 font-medium">Aucun ordre de production</div>
                <button onClick={() => setModalOpen(true)} className="btn-primary mt-3">+ Créer le premier</button>
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.product_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{r.product_code}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{r.quantity} {r.unit}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(r.unit_cost)} MAD</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(r.total_cost)} MAD</td>
                <td className="px-4 py-3 text-center">
                  <span className={(STATUS as any)[r.status]?.cls ?? 'badge-gray'}>
                    {(STATUS as any)[r.status]?.label ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    {r.status === 'draft' && (
                      <>
                        <button onClick={() => setConfirmId(r.id)} className="btn-primary btn-sm text-xs">
                          ✅ Confirmer
                        </button>
                        <button onClick={() => setCancelId(r.id)} className="btn-secondary btn-sm text-xs text-red-500 hover:text-red-700">
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvel Ordre de Production" size="lg">
        <ProductionForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>

      <ConfirmDialog
        open={confirmId !== null}
        title="Confirmer la production"
        message="Cette action va consommer les matières premières et mettre à jour le stock. Continuer ?"
        confirmLabel="✅ Confirmer"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmId(null)}
      />

      <ConfirmDialog
        open={cancelId !== null}
        title="Annuler l'ordre"
        message="Voulez-vous annuler cet ordre de production ? Cette action est irréversible."
        confirmLabel="Annuler l'ordre"
        onConfirm={handleCancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  )
}
