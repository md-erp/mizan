import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import PartyForm from '../../components/forms/PartyForm'
import PartyDetail from './PartyDetail'
import ImportButton from '../../components/ImportButton'
import SkeletonRows from '../../components/ui/SkeletonRows'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import type { Client, Supplier } from '../../types'

interface Props { type: 'client' | 'supplier' }

export default function PartiesList({ type }: Props) {
  const [rows, setRows] = useState<(Client | Supplier)[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Client | Supplier | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const label = type === 'client' ? 'Client' : 'Fournisseur'
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fn = type === 'client' ? api.getClients : api.getSuppliers
      const result = await fn({ search }) as any
      setRows(result.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [type, search])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: number) {
    try {
      const fn = type === 'client' ? api.deleteClient : api.deleteSupplier
      await fn(id)
      toast(`${label} supprimé`)
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          + Nouveau {label}
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs" placeholder="Rechercher..." />
        <div className="ml-auto flex gap-2">
          <ImportButton type={type === 'client' ? 'clients' : 'suppliers'} onImported={load} />
          <button onClick={async () => {
            try {
              await api.excelExportParties(type)
              toast('✅ Fichier Excel enregistré')
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">📤 Exporter</button>
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Nom</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">ICE</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Téléphone</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              {type === 'client' && <th className="px-4 py-3 text-right font-medium text-gray-600">Solde</th>}
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <SkeletonRows cols={type === 'client' ? 6 : 5} />}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">👥</div>
                <div className="text-gray-500 font-medium">Aucun {label.toLowerCase()}</div>
                <button onClick={() => { setEditing(null); setModalOpen(true) }}
                  className="btn-primary mt-3">
                  + Créer le premier
                </button>
              </td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id}
                onClick={() => setSelectedId(row.id)}
                className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.ice ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{row.phone ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{row.email ?? '—'}</td>
                {type === 'client' && (
                  <td className="px-4 py-3 text-right font-semibold">
                    <span className={(row as Client).balance ?? 0 > 0 ? 'text-orange-500' : 'text-gray-600'}>
                      {fmt((row as Client).balance ?? 0)} MAD
                    </span>
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setEditing(row); setModalOpen(true) }}
                      className="btn-secondary btn-sm text-xs">✏️</button>
                    <button onClick={() => setDeleteId(row.id)}
                      className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 transition-all">
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Modifier ${label}` : `Nouveau ${label}`}
      >
        <PartyForm
          type={type}
          initial={editing ?? undefined}
          onSaved={() => { setModalOpen(false); load() }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={`Fiche ${label}`}
        width="w-[700px]"
      >
        {selectedId !== null && (
          <PartyDetail
            id={selectedId}
            type={type}
            onClose={() => setSelectedId(null)}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={deleteId !== null}
        title={`Supprimer ce ${label.toLowerCase()}`}
        message="Cette action est irréversible. Le contact sera archivé."
        confirmLabel="Supprimer"
        danger
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
