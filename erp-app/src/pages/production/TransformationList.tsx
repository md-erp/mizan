import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import TransformationForm from './TransformationForm'

export default function TransformationList() {
  const [rows, setRows]       = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api.getTransformations() as any[]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Explication */}
      {showHelp && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-300 shrink-0 flex items-start gap-3">
          <div className="flex-1">
            <span className="font-semibold">⚙️ Transformation</span>
            {' '}— Convertit une matière première en produit(s) fini(s).
            Le stock de la matière est débité, le stock des produits obtenus est crédité,
            et le CMUP est recalculé automatiquement.
            <span className="ml-2 text-blue-500 text-xs">Ex: 100 kg Aluminium → 50 Profilés</span>
          </div>
          <button onClick={() => setShowHelp(false)}
            className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors text-lg leading-none">
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle Transformation</button>
        <button onClick={load} className="btn-secondary btn-sm">↻ Actualiser</button>
        <span className="text-sm text-gray-500 ml-auto">{rows.length} transformation(s)</span>
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Matière première</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Qté entrée</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût/unité</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(5)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="text-center py-16">
                <div className="text-4xl mb-3">🔄</div>
                <div className="text-gray-500 font-medium">Aucune transformation</div>
                <button onClick={() => setModalOpen(true)} className="btn-primary mt-3">+ Créer la première</button>
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.material_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{r.material_code}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{r.input_quantity}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(r.cost_per_unit)} MAD</td>
                <td className="px-4 py-3 text-right font-semibold text-primary">{fmt(r.total_cost)} MAD</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle Transformation" size="lg">
        <TransformationForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  )
}
