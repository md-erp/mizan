import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import BomForm from './BomForm'

export default function BomList() {
  const [rows, setRows]         = useState<any[]>([])
  const [loading, setLoading]   = useState(false)
  const [search, setSearch]     = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editBom, setEditBom]   = useState<any>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api.getAllBoms() as any[]) }
    catch (e: any) { toast(e.message, 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete() {
    if (!deleteId) return
    try {
      await api.deleteBomTemplate(deleteId)
      toast('Nomenclature supprimée')
      load()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setDeleteId(null) }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const filtered = rows.filter(r =>
    !search ||
    r.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.product_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="btn-primary" onClick={() => { setEditBom(null); setModalOpen(true) }}>
          + Nouvelle Nomenclature
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs" placeholder="🔍 Rechercher produit ou BOM..." />
        <button onClick={load} className="btn-secondary btn-sm ml-auto">↻ Actualiser</button>
        <span className="text-sm text-gray-500">{filtered.length} nomenclature(s)</span>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600 w-8"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Produit fini</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Nomenclature</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 w-24">Matières</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 w-36">Coût estimé</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 w-24">Défaut</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(7)].map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" /></td>
                ))}
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-16">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-gray-500 font-medium">Aucune nomenclature</div>
                <button onClick={() => { setEditBom(null); setModalOpen(true) }} className="btn-primary mt-3">
                  + Créer la première
                </button>
              </td></tr>
            )}
            {!loading && filtered.map(r => {
              const isOpen = expanded === r.id
              const totalCost = (r.lines ?? []).reduce((s: number, l: any) =>
                s + (l.cmup_price ?? 0) * l.quantity, 0) + (r.labor_cost ?? 0)
              return (
                <>
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : r.id)}>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">
                      {isOpen ? '▼' : '▶'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.product_name}</div>
                      <div className="text-xs text-gray-400 font-mono">{r.product_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.name}</span>
                      {r.labor_cost > 0 && (
                        <span className="ml-2 text-xs text-gray-400">MO: {fmt(r.labor_cost)} MAD</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="badge badge-blue">{(r.lines ?? []).length} ligne(s)</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">
                      {fmt(totalCost)} MAD
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.is_default ? <span className="text-amber-500 text-base">★</span> : <span className="text-gray-300">☆</span>}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditBom(r); setModalOpen(true) }}
                          className="btn-secondary btn-sm text-xs">✏️</button>
                        <button onClick={() => setDeleteId(r.id)}
                          className="btn-secondary btn-sm text-xs text-red-500 hover:text-red-700">🗑️</button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${r.id}-detail`} className="bg-blue-50/50 dark:bg-blue-900/10">
                      <td colSpan={7} className="px-8 py-3">
                        <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                          Détail des matières premières
                        </div>
                        <div className="grid grid-cols-1 gap-1">
                          {(r.lines ?? []).map((l: any, i: number) => (
                            <div key={i} className="flex items-center justify-between py-1 border-b border-blue-100 dark:border-blue-800 last:border-0">
                              <div className="flex items-center gap-3">
                                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{i + 1}</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{l.material_name}</span>
                                <span className="text-gray-400 font-mono text-xs">{l.material_code}</span>
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="font-semibold">{l.quantity} {l.unit}</span>
                                <span className="text-gray-400">CMUP: {fmt(l.cmup_price ?? 0)} MAD</span>
                                <span className="font-bold text-primary">{fmt((l.cmup_price ?? 0) * l.quantity)} MAD</span>
                              </div>
                            </div>
                          ))}
                          {r.labor_cost > 0 && (
                            <div className="flex items-center justify-between py-1 mt-1">
                              <div className="flex items-center gap-3">
                                <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 text-xs flex items-center justify-center">👷</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">Main d'œuvre</span>
                              </div>
                              <span className="text-xs font-bold text-orange-600">{fmt(r.labor_cost)} MAD</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditBom(null) }}
        title={editBom ? `Modifier — ${editBom.name}` : 'Nouvelle Nomenclature (BOM)'} size="xl">
        <BomForm
          bom={editBom}
          onSaved={() => { setModalOpen(false); setEditBom(null); load() }}
          onCancel={() => { setModalOpen(false); setEditBom(null) }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Supprimer la nomenclature"
        message="Cette action est irréversible. La nomenclature sera supprimée définitivement."
        confirmLabel="🗑️ Supprimer"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
