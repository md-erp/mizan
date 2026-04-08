import { useState } from 'react'
import PurchaseOrdersList from './PurchaseOrdersList'
import ReceptionsList from './ReceptionsList'
import PurchaseInvoicesList from './PurchaseInvoicesList'
import ImportInvoicesList from './ImportInvoicesList'

const TABS = [
  { id: 'orders',     label: 'Bons de Commande' },
  { id: 'receptions', label: 'Bons de Réception' },
  { id: 'invoices',   label: 'Factures Fournisseurs' },
  { id: 'imports',    label: 'Importations' },
] as const

export default function AchatsPage() {
  const [tab, setTab] = useState<string>('orders')
  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        {tab === 'orders'     && <PurchaseOrdersList />}
        {tab === 'receptions' && <ReceptionsList />}
        {tab === 'invoices'   && <PurchaseInvoicesList />}
        {tab === 'imports'    && <ImportInvoicesList />}
      </div>
    </div>
  )
}
