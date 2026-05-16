import { fmt } from '../../lib/format'
import { useState, useEffect } from 'react'
import { Combobox } from './Combobox'
import Modal from './Modal'
import PartyForm from '../forms/PartyForm'
import { api } from '../../lib/api'
import { toast } from './Toast'
import type { Client, Supplier } from '../../types'

interface Props {
  type: 'client' | 'supplier'
  value: number   // party_id
  onChange: (id: number, party: Client | Supplier) => void
  onClear: () => void
  error?: string
  disabled?: boolean
}

export function PartySelector({ type, value, onChange, onClear, error, disabled }: Props) {
  const [parties, setParties] = useState<(Client | Supplier)[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Client | Supplier | null>(null)
  const [newModal, setNewModal] = useState(false)

  const label = type === 'client' ? 'Client' : 'Fournisseur'
  // fmt imported from lib/format

  async function load() {
    const fn = type === 'client' ? api.getClients : api.getSuppliers
    const r = await fn({ limit: 500 }) as any
    setParties(r.rows ?? [])
  }

  useEffect(() => { load() }, [type])

  // sync selected when value changes externally
  useEffect(() => {
    if (value && parties.length > 0) {
      const found = parties.find(p => p.id === value)
      if (found) setSelected(found)
    }
    if (!value) { setSelected(null); setSearch('') }
  }, [value, parties])

  const items = parties.map(p => ({
    id: p.id,
    label: p.name,
    sub: p.ice ? `ICE: ${p.ice}` : p.phone ?? undefined,
    extra: type === 'client' && (p as Client).balance && (p as Client).balance! > 0
      ? `${fmt((p as Client).balance!)} MAD`
      : undefined,
  }))

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="flex-1">
          <Combobox
            items={items}
            value={selected ? selected.name : search}
            onChange={v => { setSearch(v); setSelected(null); onClear() }}
            onSelect={(id, item) => {
              const party = parties.find(p => p.id === id)!
              setSelected(party)
              setSearch(item.label)
              onChange(id, party)
            }}
            placeholder={`Rechercher un ${label.toLowerCase()}...`}
            error={!!error}
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          onClick={() => setNewModal(true)}
          disabled={disabled}
          className="btn-secondary btn-sm shrink-0 whitespace-nowrap"
          title={`Créer un nouveau ${label.toLowerCase()}`}
        >
          + Nouveau
        </button>
      </div>

      {/* Info card */}
      {selected && (
        <div className="flex items-center gap-3 text-xs text-gray-500
          bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800
          rounded-lg px-3 py-2">
          {selected.address && <span className="truncate">📍 {selected.address}</span>}
          {selected.phone && <span>📞 {selected.phone}</span>}
          {selected.ice && <span className="font-mono">ICE: {selected.ice}</span>}
          {type === 'client' && (selected as Client).balance! > 0 && (
            <span className="text-orange-500 font-medium ml-auto shrink-0">
              Solde: {fmt((selected as Client).balance!)} MAD
            </span>
          )}
          <button
            type="button"
            onClick={() => { setSelected(null); setSearch(''); onClear() }}
            className="ml-auto shrink-0 text-gray-300 hover:text-red-500 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <Modal open={newModal} onClose={() => setNewModal(false)} title={`Nouveau ${label}`}>
        <PartyForm
          type={type}
          onSaved={async () => {
            setNewModal(false)
            await load()
            // auto-select newest
            const fn = type === 'client' ? api.getClients : api.getSuppliers
            const r = await fn({ limit: 500 }) as any
            const rows: (Client | Supplier)[] = r.rows ?? []
            setParties(rows)
            const newest = [...rows].sort((a, b) => b.id - a.id)[0]
            if (newest) {
              setSelected(newest)
              setSearch(newest.name)
              onChange(newest.id, newest)
            }
            toast(`${label} créé et sélectionné`)
          }}
          onCancel={() => setNewModal(false)}
        />
      </Modal>
    </div>
  )
}
