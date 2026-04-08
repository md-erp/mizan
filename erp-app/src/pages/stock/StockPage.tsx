import { useState } from 'react'
import ProductsList from './ProductsList'
import MovementsList from './MovementsList'
import TransformationList from '../production/TransformationList'

const TABS = [
  { id: 'all',       label: 'Produits' },
  { id: 'movements', label: '🔄 Mouvements' },
  { id: 'transform', label: '⚙️ Transformation' },
] as const

export default function StockPage() {
  const [tab, setTab] = useState<'all' | 'movements' | 'transform'>('all')
  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
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
        {tab === 'all'       && <ProductsList />}
        {tab === 'movements' && <MovementsList />}
        {tab === 'transform' && <TransformationList />}
      </div>
    </div>
  )
}
