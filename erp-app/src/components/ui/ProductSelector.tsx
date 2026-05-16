import { useState, useRef } from 'react'
import { Combobox } from './Combobox'
import Modal from './Modal'
import ProductForm from '../forms/ProductForm'
import { api } from '../../lib/api'
import { toast } from './Toast'
import { fmt } from '../../lib/format'
import type { Product } from '../../types'

interface Props {
  products: Product[]
  value: string
  onChange: (v: string) => void
  onSelect: (product: Product) => void
  onProductCreated: (product: Product, allProducts: Product[]) => void
  placeholder?: string
}

export function ProductSelector({
  products,
  value,
  onChange,
  onSelect,
  onProductCreated,
  placeholder = 'Produit ou description...',
}: Props) {
  const [newModal, setNewModal] = useState(false)
  const pendingNameRef = useRef<string>('')

  const items = products.map(p => ({
    id: p.id,
    label: p.name,
    sub: `${p.code} · ${p.unit}`,
    extra:
      p.sale_price > 0
        ? `${fmt(p.sale_price)} MAD`
        : undefined,
    badge:
      p.stock_quantity <= (p.min_stock ?? 0) && p.min_stock > 0 ? '⚠' : undefined,
  }))

  function handleOpenNew() {
    pendingNameRef.current = value
    setNewModal(true)
  }

  async function handleSaved(createdId?: number) {
    setNewModal(false)
    try {
      const result = (await api.getProducts({ limit: 2000 })) as any
      const rows: Product[] = result.rows ?? result ?? []
      // Use the returned ID directly, fallback to newest by id
      const created = createdId
        ? rows.find(p => p.id === createdId)
        : [...rows].sort((a, b) => b.id - a.id)[0]
      if (created) {
        onProductCreated(created, rows)
        toast(`Produit "${created.name}" créé et sélectionné`)
      }
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <>
      <div className="flex gap-1">
        <div className="flex-1 min-w-0">
          <Combobox
            items={items}
            value={value}
            onChange={onChange}
            onSelect={(_, item) => {
              const p = products.find(p => p.id === item.id)
              if (p) onSelect(p)
            }}
            placeholder={placeholder}
          />
        </div>
        <button
          type="button"
          onClick={handleOpenNew}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded-lg
            border border-gray-200 dark:border-gray-600
            text-gray-400 hover:text-primary hover:border-primary
            bg-white dark:bg-gray-800 transition-all text-base leading-none"
          title="Créer un nouveau produit"
        >
          +
        </button>
      </div>

      <Modal
        open={newModal}
        onClose={() => setNewModal(false)}
        title="Nouveau produit"
        size="lg"
      >
        <div className="p-6">
          <ProductForm
            initial={pendingNameRef.current ? { name: pendingNameRef.current } : undefined}
            onSaved={(createdId) => handleSaved(createdId)}
            onCancel={() => setNewModal(false)}
          />
        </div>
      </Modal>
    </>
  )
}
