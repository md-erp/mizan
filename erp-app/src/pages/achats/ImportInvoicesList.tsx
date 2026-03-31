import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ImportInvoiceForm from './ImportInvoiceForm'
import DocumentDetail from '../../components/DocumentDetail'
import SkeletonRows from '../../components/ui/SkeletonRows'
import type { Document, PaginatedResponse } from '../../types'

export default function ImportInvoicesList() {
  const [data, setData] = useState<PaginatedResponse<Document> | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getDocuments({ type: 'import_invoice' }) as PaginatedResponse<Document>
      setData(r)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle Importation</button>
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Numéro</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fournisseur</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Montant facture</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Coût total MAD</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <SkeletonRows cols={6} />}
            {!loading && (data?.rows.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">🌍</div>
                <div className="text-gray-500">Aucune importation</div>
              </td></tr>
            )}
            {data?.rows.map(doc => (
              <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{doc.number}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-4 py-3 font-medium">{doc.party_name ?? '—'}</td>
                <td className="px-4 py-3 text-right">{fmt(doc.total_ht)} MAD</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(doc.total_ttc)} MAD</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setSelectedId(doc.id)} className="text-gray-400 hover:text-primary text-xs">Voir →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle Importation (Landed Cost)" size="xl">
        <ImportInvoiceForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails Importation">
        {selectedId !== null && (
          <DocumentDetail docId={selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />
        )}
      </Drawer>
    </div>
  )
}
