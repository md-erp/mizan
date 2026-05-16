import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState, useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import { fmt } from '../../lib/format'
import NumberInput from '../ui/NumberInput'
import { Combobox } from '../ui/Combobox'
import ConfirmDialog from '../ui/ConfirmDialog'
import type { Product } from '../../types'

const schema = z.object({
  code:           z.string().min(1, 'Code requis'),
  name:           z.string().min(2, 'Désignation requise'),
  unit:           z.string().min(1, 'Unité requise'),
  type:           z.enum(['raw', 'finished', 'semi_finished']),
  min_stock:      z.coerce.number().min(0).default(0),
  sale_price:     z.coerce.number().min(0).default(0),
  cost_price:     z.coerce.number().min(0).default(0),
  margin_mode:    z.enum(['auto', 'manual']).default('auto'),
  margin_percent: z.coerce.number().min(0).max(500).default(30),
  tva_rate_id:    z.coerce.number().default(5),
  supplier_id:    z.coerce.number().optional(),
  notes:          z.string().optional(),
})

type FormData = z.infer<typeof schema>

const TVA_RATES: Record<string, number> = { '0%': 1, '7%': 2, '10%': 3, '14%': 4, '20%': 5 }

const UNITS_BY_TYPE: Record<string, string[]> = {
  raw:           ['kg', 'g', 'tonne', 'm', 'ml', 'cm', 'm²', 'm³', 'L', 'unité', 'boîte'],
  finished:      ['unité', 'pièce', 'boîte', 'carton', 'kg', 'm', 'm²'],
  semi_finished: ['unité', 'pièce', 'kg', 'm', 'boîte'],
}

function generateCode(name: string, type: string): string {
  const prefix = type === 'raw' ? 'MP' : type === 'semi_finished' ? 'SF' : 'PF'
  const slug = name
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 4)
    .padEnd(3, 'X')
  const num = String(Math.floor(Math.random() * 900) + 100)
  return `${prefix}-${slug}-${num}`
}

// مكوّن إدخال حر مع اقتراحات
function InputSuggestions({
  value, onChange, suggestions, placeholder, suffix, type: inputType = 'text', min, max,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  suffix?: string
  type?: string
  min?: number
  max?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions

  return (
    <div ref={ref} className="relative">
      <input
        type={inputType}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={`input w-full ${suffix ? 'pr-8' : ''}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
          {suffix}
        </span>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary/5 dark:hover:bg-primary/10
                border-b border-gray-50 dark:border-gray-700/50 last:border-0 font-medium text-gray-800 dark:text-gray-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  initial?: Partial<Product>
  onSaved: (createdId?: number) => void
  onCancel: () => void
}

export default function ProductForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial?.id

  const { register, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      code:           initial?.code ?? '',
      name:           initial?.name ?? '',
      unit:           initial?.unit ?? '',
      type:           initial?.type ?? 'finished',
      min_stock:      initial?.min_stock ?? 0,
      sale_price:     initial?.sale_price ?? 0,
      cost_price:     (initial as any)?.cost_price ?? (initial as any)?.cmup_price ?? 0,
      margin_mode:    'auto',
      margin_percent: 30,
      tva_rate_id:    initial?.tva_rate_id ?? 5,
      supplier_id:    (initial as any)?.supplier_id ?? undefined,
      notes:          initial?.notes ?? '',
    },
  })

  const type       = watch('type')
  const costPrice  = watch('cost_price')
  const marginMode = watch('margin_mode')
  const marginPct  = watch('margin_percent')
  const salePrice  = watch('sale_price')

  // حالة حقول الاقتراحات
  const [tvaValue, setTvaValue]   = useState(() => {
    if (initial?.tva_rate_id) return Object.entries(TVA_RATES).find(([, id]) => id === initial.tva_rate_id)?.[0] ?? '20%'
    return localStorage.getItem('last_tva') ?? '20%'
  })
  const [unitValue, setUnitValue] = useState(initial?.unit ?? '')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    api.getSuppliers({ limit: 200 }).then((r: any) => setSuppliers(r.rows ?? []))
  }, [])

  const units = UNITS_BY_TYPE[type] ?? UNITS_BY_TYPE.finished

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (!isEdit && e.target.value.length >= 3) {
      const current = watch('code')
      if (!current) setValue('code', generateCode(e.target.value, type))
    }
  }

  useEffect(() => {
    if (marginMode === 'auto' && costPrice > 0) {
      const price = costPrice * (1 + marginPct / 100)
      setValue('sale_price', Math.round(price * 100) / 100)
    }
  }, [costPrice, marginPct, marginMode])

  const actualMargin = costPrice > 0 && salePrice > 0
    ? (salePrice - costPrice) / costPrice * 100
    : null

  function handleTvaChange(v: string) {
    const num = parseFloat(v.replace('%', ''))
    if (!isNaN(num)) {
      const clamped = Math.min(100, Math.max(0, num))
      const display = v.endsWith('%') ? `${clamped}%` : v
      setTvaValue(display)
      localStorage.setItem('last_tva', display)
      const match = TVA_RATES[display]
      setValue('tva_rate_id', match ?? 5)
    } else {
      setTvaValue(v)
    }
  }

  function handleUnitChange(v: string) {
    setUnitValue(v)
    setValue('unit', v)
  }

  async function onSubmit(data: FormData) {
    try {
      if (isEdit) {
        await api.updateProduct({ ...data, id: initial!.id })
        toast('Produit modifié')
        onSaved()
      } else {
        const res = (await api.createProduct(data)) as any
        toast('Produit créé')
        onSaved(res?.id)
      }
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="space-y-4">

      {/* Type */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'raw',           label: 'Matière première', desc: 'Utilisée en production',  color: 'peer-checked:border-blue-500 peer-checked:bg-blue-50 dark:peer-checked:bg-blue-900/20' },
            { value: 'finished',      label: 'Produit fini',     desc: 'Vendu aux clients',        color: 'peer-checked:border-green-500 peer-checked:bg-green-50 dark:peer-checked:bg-green-900/20' },
            { value: 'semi_finished', label: 'Semi-fini',        desc: 'Acheté ou en cours',       color: 'peer-checked:border-orange-400 peer-checked:bg-orange-50 dark:peer-checked:bg-orange-900/20' },
          ] as const).map(t => (
            <label key={t.value} className="cursor-pointer">
              <input {...register('type')} type="radio" value={t.value} className="peer hidden" />
              <div className={`p-3 rounded-lg border-2 border-gray-200 text-center transition-all ${t.color}`}>
                <div className="font-medium text-sm">{t.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Désignation + Code */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <FormField label="Désignation" required error={errors.name?.message}>
            <input
              {...register('name')}
              onBlur={handleNameBlur}
              className={`input ${errors.name ? 'input-error' : ''}`}
              placeholder="Nom du produit"
              autoFocus
            />
          </FormField>
        </div>
        <FormField label="Code" required error={errors.code?.message}>
          <input
            {...register('code')}
            className={`input font-mono ${errors.code ? 'input-error' : ''}`}
            placeholder="Auto"
          />
        </FormField>
      </div>

      {/* Unité + Stock minimum */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Unité" required error={errors.unit?.message}>
          <InputSuggestions
            value={unitValue}
            onChange={handleUnitChange}
            suggestions={units}
            placeholder="unité, kg, m..."
          />
        </FormField>
        <FormField label="Stock minimum">
          <NumberInput {...register('min_stock')} className="input"
            min="0" decimals={2} placeholder="0 = pas d'alerte" />
        </FormField>
      </div>

      {/* Prix — selon le type */}
      {type === 'raw' || type === 'semi_finished' ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prix d'achat (MAD HT)">
            <NumberInput {...register('cost_price')} className="input" min="0" decimals={2} />
          </FormField>
          <FormField label="TVA" required>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                value={tvaValue.replace('%', '')}
                onChange={e => handleTvaChange(e.target.value + '%')}
                className="input pr-8"
                placeholder="20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
            </div>
          </FormField>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prix de revient (MAD HT)">
              <NumberInput {...register('cost_price')} className="input" min="0" decimals={2} />
            </FormField>
            <FormField label="TVA de vente" required>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={tvaValue.replace('%', '')}
                  onChange={e => handleTvaChange(e.target.value + '%')}
                  className="input pr-8"
                  placeholder="20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
              </div>
            </FormField>
          </div>

          {costPrice > 0 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Marge bénéficiaire</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
                  {(['auto', 'manual'] as const).map(m => (
                    <label key={m}
                      className={`px-3 py-1.5 cursor-pointer transition-all
                        ${marginMode === m
                          ? 'bg-primary text-white'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
                      <input {...register('margin_mode')} type="radio" value={m} className="hidden" />
                      {m === 'auto' ? 'Auto (%)' : 'Manuel'}
                    </label>
                  ))}
                </div>
              </div>

              {marginMode === 'auto' ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <input {...register('margin_percent')} className="input" type="number"
                      min="0" max="500" step="1" placeholder="30" />
                  </div>
                  <span className="text-gray-400">%</span>
                  <div className="flex-1 text-right">
                    <div className="text-xs text-gray-400">Prix de vente</div>
                    <div className="text-base font-bold text-primary">
                      {salePrice > 0 ? `${fmt(salePrice)} MAD` : '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <FormField label="Prix de vente (MAD HT)">
                  <NumberInput {...register('sale_price')} className="input" min="0" decimals={2} />
                </FormField>
              )}

              {actualMargin !== null && (
                <div className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2
                  ${actualMargin >= 20 ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : actualMargin >= 10 ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  <span>{actualMargin >= 20 ? '✅' : actualMargin >= 10 ? '⚠️' : '❌'}</span>
                  <span>
                    Marge réelle: <strong>{actualMargin.toFixed(1)}%</strong>
                    {' '}— Bénéfice: <strong>{fmt(salePrice - costPrice)} MAD</strong> par unité
                  </span>
                </div>
              )}
            </div>
          )}

          {costPrice === 0 && (
            <FormField label="Prix de vente (MAD HT)">
              <NumberInput {...register('sale_price')} className="input" min="0" decimals={2} />
            </FormField>
          )}
        </div>
      )}

      {/* Fournisseur habituel */}
      <FormField label="Fournisseur habituel">
        <Combobox
          items={suppliers.map(s => ({ id: s.id, label: s.name, sub: s.ice ?? '' }))}
          value={supplierSearch || (suppliers.find(s => s.id === watch('supplier_id'))?.name ?? '')}
          onChange={v => { setSupplierSearch(v); if (!v) setValue('supplier_id', undefined) }}
          onSelect={(id, item) => { setValue('supplier_id', id); setSupplierSearch(item.label) }}
          placeholder="Rechercher un fournisseur..."
        />
      </FormField>

      {/* Notes */}
      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="Fournisseur habituel, référence, remarques..." />
      </FormField>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">
          Annuler
        </button>
        {isEdit && (
          <button type="button" onClick={() => setDeleteConfirm(true)}
            className="btn-secondary text-red-500 border-red-200 hover:bg-red-50 px-4">
            🗑️
          </button>
        )}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => handleSubmit(onSubmit)()}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? 'Enregistrement...' : isEdit ? '💾 Modifier' : '✅ Créer'}
        </button>
      </div>

      <ConfirmDialog
        open={deleteConfirm}
        title="Supprimer ce produit ?"
        message={`Le produit "${initial?.name}" sera archivé. Cette action est irréversible.`}
        confirmLabel="Supprimer" danger
        onConfirm={async () => {
          try {
            await api.deleteProduct(initial!.id!)
            toast('Produit supprimé')
            onSaved()
          } catch (e: any) { toast(e.message, 'error') }
          finally { setDeleteConfirm(false) }
        }}
        onCancel={() => setDeleteConfirm(false)}
      />
    </div>
  )
}
