import { useState, useEffect } from 'react'
import { UseFormSetValue, UseFieldArrayReturn, Controller } from 'react-hook-form'
import { ProductSelector } from './ProductSelector'
import { fmt, roundAmt } from '../../lib/format'
import NumberInput from './NumberInput'
import type { Product } from '../../types'

export interface LineData {
  product_id?: number
  description?: string
  quantity: number
  unit_price: number
  discount?: number        // نسبة مئوية 0-100
  discount_amount?: number // مبلغ مباشر (اختياري — يُحوَّل إلى نسبة)
  tva_rate?: number
}

interface Props {
  fields: UseFieldArrayReturn<any, 'lines'>['fields']
  lines: LineData[]
  products: Product[]
  register: any
  control: any
  setValue: UseFormSetValue<any>
  onRemove: (i: number) => void
  onAdd: () => void
  showDiscount?: boolean
  showTva?: boolean
  productFilter?: (p: Product) => boolean
  priceLabel?: string
  readonlyPrice?: boolean
  onProductsRefresh?: (products: Product[]) => void
}

const DEFAULT_TVA_KEY = 'erp_last_tva_rate'

function getDefaultTva(): number {
  try {
    const saved = localStorage.getItem(DEFAULT_TVA_KEY)
    if (saved !== null) return Number(saved)
  } catch {}
  return 20
}

function saveDefaultTva(rate: number) {
  try { localStorage.setItem(DEFAULT_TVA_KEY, String(rate)) } catch {}
}

export { getDefaultTva }

function calcLine(l: Partial<LineData>) {
  const qty    = Number(l.quantity)   || 0
  const price  = Number(l.unit_price) || 0
  const disc   = Number(l.discount)   || 0
  const tva    = Number(l.tva_rate)   || 0
  const ht     = roundAmt(qty * price * (1 - disc / 100))
  const tvaAmt = roundAmt(ht * tva / 100)
  const ttc    = roundAmt(ht + tvaAmt)
  return { ht, tvaAmt, ttc }
}

// ─── تعريف الأعمدة — نسب ثابتة تضمن التوافق بين Header و Rows ───────────────
function buildCols(showDiscount: boolean, showTva: boolean, priceLabel: string) {
  return [
    { key: 'product', label: 'Désignation', span: 8,  align: 'left'   },
    { key: 'qty',     label: 'Qté',         span: 3,  align: 'right'  },
    { key: 'price',   label: priceLabel,    span: 4,  align: 'right'  },
    ...(showDiscount ? [{ key: 'disc',   label: 'Rem',   span: 3, align: 'right'  }] : []),
    ...(showTva      ? [{ key: 'tva',    label: 'TVA %', span: 2, align: 'right'  }] : []),
    { key: 'ttc',     label: 'TTC',         span: 3,  align: 'right'  },
    { key: 'del',     label: '',            span: 1,  align: 'center' },
  ]
}

export function LinesTable({
  fields, lines, products, register, control, setValue,
  onRemove, onAdd,
  showDiscount = true, showTva = true,
  productFilter, priceLabel = 'Prix HT', readonlyPrice = false,
  onProductsRefresh,
}: Props) {
  const [productSearches, setProductSearches] = useState<string[]>(
    () => lines.map(l => (l as any).description ?? '')
  )
  const [lineProducts, setLineProducts] = useState<(Product | null)[]>(
    () => lines.map(() => null)
  )
  // وضع الخصم لكل سطر: 'pct' = نسبة% | 'amt' = مبلغ مباشر
  const [discModes, setDiscModes] = useState<('pct' | 'amt')[]>(
    () => lines.map(() => 'pct')
  )

  useEffect(() => {
    setProductSearches(prev => {
      const next = lines.map((l, i) => prev[i] !== undefined ? prev[i] : ((l as any).description ?? ''))
      while (next.length < fields.length) next.push('')
      return next.slice(0, fields.length)
    })
    setLineProducts(prev => {
      const next = [...prev]
      while (next.length < fields.length) next.push(null)
      return next.slice(0, fields.length)
    })
    setDiscModes(prev => {
      const next = [...prev]
      while (next.length < fields.length) next.push('pct' as const)
      return next.slice(0, fields.length)
    })
  }, [fields.length])

  // تحديث lineProducts عند تغيير المنتجات أو الخطوط
  useEffect(() => {
    const newLineProducts = lines.map(line => {
      if (!line.product_id) return null
      return products.find(p => p.id === line.product_id) || null
    })
    setLineProducts(newLineProducts)
  }, [lines.map(l => l.product_id).join(','), products.length])

  useEffect(() => {
    setProductSearches(lines.map(l => {
      if ((l as any).description) return (l as any).description
      if ((l as any).product_id) {
        const p = products.find(p => p.id === (l as any).product_id)
        if (p) return p.name
      }
      return ''
    }))
  }, [JSON.stringify(lines.map(l => (l as any).product_id)), products.length])

  const filteredProducts = productFilter ? products.filter(productFilter) : products
  const cols = buildCols(showDiscount, showTva, priceLabel)
  const gridTemplate = cols.map(c => `${c.span}fr`).join(' ')

  function selectProduct(i: number, product: Product) {
    setValue(`lines.${i}.product_id`, product.id)
    setValue(`lines.${i}.unit_price`, product.sale_price)
    setValue(`lines.${i}.tva_rate`, product.tva_rate_value ?? 20)
    setValue(`lines.${i}.description`, product.name)
    const s = [...productSearches]; s[i] = product.name; setProductSearches(s)
    const lp = [...lineProducts]; lp[i] = product; setLineProducts(lp)
  }

  // كلاس مشترك للـ input داخل الجدول — حجم موحد
  const cellInput = [
    'w-full px-2 py-1.5 text-xs text-right rounded-md',
    'border border-gray-200 dark:border-gray-600',
    'bg-white dark:bg-gray-800',
    'focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary',
    'transition-colors',
  ].join(' ')

  return (
    <div>
      {/* ── Titre + bouton ── */}
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Lignes <span className="text-red-500">*</span>
        </label>
        <button type="button" onClick={onAdd} className="btn-secondary btn-sm text-xs">
          + Ligne
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-visible">

        {/* ── Header — même gridTemplate que les rows ── */}
        <div
          className="grid px-2 py-1.5 bg-gray-50 dark:bg-gray-700/60 rounded-t-xl border-b border-gray-200 dark:border-gray-700"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {cols.map(c => (
            <div
              key={c.key}
              className={[
                'text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1',
                c.align === 'right'  ? 'text-right'  :
                c.align === 'center' ? 'text-center' : 'text-left',
              ].join(' ')}
            >
              {c.label}
            </div>
          ))}
        </div>

        {/* ── Rows ── */}
        {fields.map((field, i) => {
          const line      = lines[i] ?? {}
          const { ttc }   = calcLine(line)
          const isAmt     = discModes[i] === 'amt'

          return (
            <div
              key={field.id}
              className="grid px-2 py-2 border-t border-gray-100 dark:border-gray-700/60 items-center hover:bg-gray-50/40 dark:hover:bg-gray-700/20 transition-colors"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {/* Désignation */}
              <div className="pr-1">
                <ProductSelector
                  products={filteredProducts}
                  value={productSearches[i] ?? ''}
                  onChange={v => {
                    const s = [...productSearches]; s[i] = v; setProductSearches(s)
                    setValue(`lines.${i}.product_id`, undefined)
                    setValue(`lines.${i}.description`, v)
                  }}
                  onSelect={p => selectProduct(i, p)}
                  onProductCreated={(product, allProducts) => {
                    selectProduct(i, product)
                    if (onProductsRefresh) onProductsRefresh(allProducts)
                  }}
                />
              </div>

              {/* Qté */}
              <div className="relative px-0.5">
                <Controller
                  name={`lines.${i}.quantity`}
                  control={control}
                  render={({ field }) => (
                    <NumberInput
                      {...field}
                      className={cellInput}
                      min="0.01" decimals={2}
                    />
                  )}
                />
                {(() => {
                  const p     = lineProducts[i]
                  if (!p) return null
                  const q     = Number(lines[i]?.quantity) || 0
                  const stock = p.stock_quantity ?? 0
                  const unit  = p.unit ? ` ${p.unit}` : ''
                  
                  // عرض الكمية دائماً مع تلوين حسب الحالة
                  if (stock <= 0)
                    return <div className="absolute -bottom-3.5 right-1 text-[9px] text-red-500 whitespace-nowrap font-medium">⚠ épuisé</div>
                  if (q > stock)
                    return <div className="absolute -bottom-3.5 right-1 text-[9px] text-red-500 whitespace-nowrap font-medium">⚠ Stock: {stock}{unit}</div>
                  if (p.min_stock > 0 && stock <= p.min_stock)
                    return <div className="absolute -bottom-3.5 right-1 text-[9px] text-amber-500 whitespace-nowrap font-medium">⚠ Stock: {stock}{unit}</div>
                  
                  // عرض الكمية بشكل عادي (أخضر)
                  return <div className="absolute -bottom-3.5 right-1 text-[9px] text-green-600 whitespace-nowrap font-medium">✓ Stock: {stock}{unit}</div>
                })()}
              </div>

              {/* Prix HT */}
              <div className="px-0.5">
                <Controller
                  name={`lines.${i}.unit_price`}
                  control={control}
                  render={({ field }) => (
                    <NumberInput
                      {...field}
                      className={cellInput}
                      min="0" decimals={2}
                      readOnly={readonlyPrice}
                    />
                  )}
                />
              </div>

              {/* Remise — % ou montant, avec toggle discret */}
              {showDiscount && (
                <div className="px-0.5">
                  <div className="flex items-center gap-0.5">
                    {isAmt ? (
                      // ── Mode montant fixe: تحديث فوري عند الكتابة ──
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        className={`${cellInput} flex-1 min-w-0`}
                        placeholder="0"
                        defaultValue=""
                        onKeyDown={e => {
                          const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','Home','End']
                          if (allowed.includes(e.key)) return
                          if ((e.ctrlKey || e.metaKey) && ['a','c','v','x','z'].includes(e.key.toLowerCase())) return
                          if (/^\d$/.test(e.key)) return
                          if (e.key === '.' && !(e.currentTarget.value.includes('.'))) return
                          e.preventDefault()
                        }}
                        onChange={e => {
                          const raw = Number(e.target.value) || 0
                          const ht  = roundAmt((Number(lines[i]?.quantity) || 0) * (Number(lines[i]?.unit_price) || 0))
                          const capped = Math.min(raw, ht)
                          const pct = ht > 0 ? roundAmt((capped / ht) * 100) : 0
                          setValue(`lines.${i}.discount`, pct)
                        }}
                        onBlur={e => {
                          const raw = Number(e.target.value) || 0
                          const ht  = roundAmt((Number(lines[i]?.quantity) || 0) * (Number(lines[i]?.unit_price) || 0))
                          const capped = Math.min(raw, ht)
                          if (raw > ht && ht > 0) e.target.value = String(capped)
                        }}
                      />
                    ) : (
                      // ── Mode pourcentage: تحديث فوري ──
                      <NumberInput
                        {...register(`lines.${i}.discount`)}
                        className={`${cellInput} flex-1 min-w-0`}
                        min="0"
                        max="100"
                        decimals={2}
                        placeholder="0"
                      />
                    )}
                    {/* toggle % / MAD */}
                    <button
                      type="button"
                      title={isAmt ? 'Montant fixe — cliquer pour %' : '% — cliquer pour montant fixe'}
                      onClick={() => {
                        const next = isAmt ? 'pct' : 'amt'
                        const d = [...discModes]; d[i] = next; setDiscModes(d)
                        setValue(`lines.${i}.discount`, 0)
                      }}
                      className={[
                        'shrink-0 w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold transition-colors border',
                        isAmt
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-400 hover:text-primary hover:border-primary/30',
                      ].join(' ')}
                    >
                      {isAmt ? 'M' : '%'}
                    </button>
                  </div>
                </div>
              )}

              {/* TVA % */}
              {showTva && (
                <div className="px-0.5">
                  <Controller
                    name={`lines.${i}.tva_rate`}
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        {...field}
                        className={cellInput}
                        min="0" max="100" decimals={2}
                        placeholder="20"
                        onChange={e => {
                          field.onChange(e)
                          const val = Number(e.target.value)
                          if (!isNaN(val) && val >= 0 && val <= 100) saveDefaultTva(val)
                        }}
                      />
                    )}
                  />
                </div>
              )}

              {/* TTC */}
              <div className="text-right text-xs font-semibold text-gray-800 dark:text-gray-100 px-1 tabular-nums">
                {fmt(ttc)}
              </div>

              {/* Supprimer */}
              <div className="flex justify-center">
                {fields.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-base leading-none"
                    title="Supprimer"
                  >
                    ×
                  </button>
                ) : <span />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Totaux réutilisables ────────────────────────────────────────────────────
export function LinesTotals({
  lines,
  currency = 'MAD',
  globalDiscount = 0,
}: {
  lines: LineData[]
  currency?: string
  globalDiscount?: number
}) {
  // تقييد الخصم الإجمالي بين 0 و 100
  const validDiscount = Math.min(Math.max(globalDiscount || 0, 0), 100)
  
  const raw = lines.reduce((acc, l) => {
    const { ht, tvaAmt, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tvaAmt, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const discAmt   = roundAmt(raw.ht * validDiscount / 100)
  const htNet     = roundAmt(raw.ht - discAmt)
  const tvaNet    = roundAmt(raw.tva * (raw.ht > 0 ? htNet / raw.ht : 1))
  const ttcNet    = roundAmt(htNet + tvaNet)

  return (
    <div className="flex justify-end mt-1">
      <div className="w-72 space-y-0.5 text-sm">
        <div className="flex justify-between py-1 text-gray-500">
          <span>Total HT</span>
          <span className="font-medium tabular-nums">{fmt(raw.ht)} {currency}</span>
        </div>
        {validDiscount > 0 && (
          <div className="flex justify-between py-1 text-orange-500">
            <span>Remise globale ({validDiscount}%)</span>
            <span className="font-medium tabular-nums">− {fmt(discAmt)} {currency}</span>
          </div>
        )}
        <div className="flex justify-between py-1 text-gray-500">
          <span>TVA</span>
          <span className="font-medium tabular-nums">{fmt(tvaNet)} {currency}</span>
        </div>
        <div className="flex justify-between py-2 text-base font-bold border-t-2 border-gray-200 dark:border-gray-600">
          <span>Total TTC</span>
          <span className="text-primary tabular-nums">{fmt(ttcNet)} {currency}</span>
        </div>
      </div>
    </div>
  )
}
