import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import PurchaseOrderForm from './PurchaseOrderForm'
import DocumentDetail from '../../components/DocumentDetail'
import type { Document, PaginatedResponse } from '../../types'

import SkeletonRows from '../../components/ui/SkeletonRows'
import Pagination from '../../components/ui/Pagination'

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon',  cls: 'badge-gray' },
  confirmed: { label: 'Confirmé',   cls: 'badge-blue' },
  received:  { label: 'Reçu',       cls: 'badge-green' },
  cancelled: { label: 'Annulé',     cls: 'badge-red' },
}

export default function PurchaseOrdersList() {
  const [data, setData] = useState<PaginatedResponse<Document> | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getDocuments({ type: 'purchase_order', search, page, limit: 50 }) as PaginatedResponse<Document>
      setData(r)
    } finally { setLoading(false) }
  }, [search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouveau Bon de Commande</button>
        <input value={search} onChange={e => setSearch(e.target.value)} className="input max-w-xs" placeholder="Rechercher..." />
        <span className="text-sm text-gray-500 ml-auto">{data?.total ?? 0} résultat(s)</span>
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Numéro</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fournisseur</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Total TTC</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Statut</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <SkeletonRows cols={6} />}
            {!loading && (data?.rows.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">🛒</div>
                <div className="text-gray-500">Aucun bon de commande</div>
              </td></tr>
            )}
            {data?.rows.map(doc => (
              <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{doc.number}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-4 py-3 font-medium">{doc.party_name ?? '—'}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(doc.total_ttc)} MAD</td>
                <td className="px-4 py-3 text-center">
                  <span className={STATUS[doc.status]?.cls ?? 'badge-gray'}>
                    {STATUS[doc.status]?.label ?? doc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setSelectedId(doc.id)} className="text-gray-400 hover:text-primary text-xs">Voir →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau Bon de Commande" size="xl">
        <PurchaseOrderForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails Bon de Commande">
        {selectedId !== null && (
          <DocumentDetail docId={selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />
        )}
      </Drawer>

      <Pagination page={page} total={data?.total ?? 0} limit={50} onChange={setPage} />
    </div>
  )
}
