import { useState } from 'react'
import InvoicesList from './InvoicesList'
import AvoirForm from './AvoirForm'
import QuoteForm from './QuoteForm'
import BLForm from './BLForm'
import Modal from '../../components/ui/Modal'

const TABS = [
  { id: 'invoice',  label: 'Factures' },
  { id: 'quote',    label: 'Devis' },
  { id: 'bl',       label: 'Bons de Livraison' },
  { id: 'proforma', label: 'Proforma' },
  { id: 'avoir',    label: 'Avoirs' },
] as const

type TabId = typeof TABS[number]['id']

export default function DocumentsPage() {
  const [tab, setTab] = useState<TabId>('invoice')
  const [avoirModal, setAvoirModal] = useState(false)
  const [quoteModal, setQuoteModal] = useState(false)
  const [blModal, setBlModal] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  function saved(closeFn: () => void) {
    closeFn()
    setRefreshKey(k => k + 1)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {tab === 'avoir' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <button className="btn-primary" onClick={() => setAvoirModal(true)}>+ Nouvel Avoir</button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <InvoicesList key={refreshKey} docType="avoir" hideNewButton />
            </div>
            <Modal open={avoirModal} onClose={() => setAvoirModal(false)} title="Nouvel Avoir" size="lg">
              <AvoirForm onSaved={() => saved(() => setAvoirModal(false))} onCancel={() => setAvoirModal(false)} />
            </Modal>
          </>
        ) : tab === 'quote' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <button className="btn-primary" onClick={() => setQuoteModal(true)}>+ Nouveau Devis</button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <InvoicesList key={refreshKey} docType="quote" hideNewButton />
            </div>
            <Modal open={quoteModal} onClose={() => setQuoteModal(false)} title="Nouveau Devis" size="xl">
              <QuoteForm docType="quote" onSaved={() => saved(() => setQuoteModal(false))} onCancel={() => setQuoteModal(false)} />
            </Modal>
          </>
        ) : tab === 'proforma' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <button className="btn-primary" onClick={() => setQuoteModal(true)}>+ Nouvelle Proforma</button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <InvoicesList key={refreshKey} docType="proforma" hideNewButton />
            </div>
            <Modal open={quoteModal} onClose={() => setQuoteModal(false)} title="Nouvelle Facture Proforma" size="xl">
              <QuoteForm docType="proforma" onSaved={() => saved(() => setQuoteModal(false))} onCancel={() => setQuoteModal(false)} />
            </Modal>
          </>
        ) : tab === 'bl' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <button className="btn-primary" onClick={() => setBlModal(true)}>+ Nouveau Bon de Livraison</button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <InvoicesList key={refreshKey} docType="bl" hideNewButton />
            </div>
            <Modal open={blModal} onClose={() => setBlModal(false)} title="Nouveau Bon de Livraison" size="xl">
              <BLForm onSaved={() => saved(() => setBlModal(false))} onCancel={() => setBlModal(false)} />
            </Modal>
          </>
        ) : (
          <InvoicesList key={refreshKey} docType={tab} />
        )}
      </div>
    </div>
  )
}
