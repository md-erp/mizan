import { fmt } from '../../lib/format'
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import InvoiceForm from '../../components/forms/InvoiceForm'
import QuoteForm from './QuoteForm'
import ProformaForm from './ProformaForm'
import BLForm from './BLForm'
import AvoirForm from './AvoirForm'
import DocumentDetail from '../../components/DocumentDetail'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { docRowBg } from '../../lib/rowBg'
import type { Document, PaginatedResponse } from '../../types'

// ─── helpers ────────────────────────────────────────────────────────────────

function daysFromToday(dateStr: string): number {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000)
}

// ─── status config ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon',  cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  confirmed: { label: 'Confirmée', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  partial:   { label: 'Partiel',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  paid:      { label: 'Payée',     cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  delivered: { label: 'Livrée',    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  received:  { label: 'Reçu',      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelled: { label: 'Annulée',   cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
  overdue:   { label: '⚠ Retard',  cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 animate-pulse' },
}

function isOverdue(doc: Document): boolean {
  const inv = doc as any
  if (!inv.due_date) return false
  if (['paid', 'cancelled'].includes(doc.status)) return false
  return daysFromToday(inv.due_date) < 0
}

const DOC_LABELS: Record<string, string> = {
  invoice:          'Facture',
  quote:            'Devis',
  bl:               'Bon de Livraison',
  proforma:         'Proforma',
  avoir:            'Avoir',
  purchase_order:   'Bon de Commande',
  bl_reception:     'Bon de Réception',
  purchase_invoice: 'Facture Fournisseur',
  import_invoice:   'Importation',
}

// ─── filter tabs ─────────────────────────────────────────────────────────────

const FILTER_TABS = [
  { key: 'all',       label: 'Tous' },
  { key: 'draft',     label: 'Brouillons' },
  { key: 'confirmed', label: 'Confirmées' },
  { key: 'partial',   label: 'Partiels' },
  { key: 'paid',      label: 'Payées' },
  { key: 'overdue',   label: '⚠ Retard' },
  { key: 'cancelled', label: 'Annulées' },
]

// ─── props ───────────────────────────────────────────────────────────────────

interface Props {
  docType: string
  hideNewButton?: boolean
}

// ─── component ───────────────────────────────────────────────────────────────

export default function InvoicesList({
 docType, hideNewButton = false }: Props) {
  const [data, setData]           = useState<PaginatedResponse<Document> | null>(null)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [sortBy, setSortBy]       = useState<'date' | 'number' | 'amount'>('date')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(false)

  const [modalOpen, setModalOpen]         = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [cancelId, setCancelId]           = useState<number | null>(null)
  const [showTotals, setShowTotals]       = useState(false)

  // stats
  const [stats, setStats] = useState({
    total: 0, confirmed: 0, paid: 0, partial: 0, overdue: 0,
    totalAmount: 0, unpaidAmount: 0, overdueAmount: 0,
    accepted: 0, rejected: 0, expired: 0, converted: 0,
    delivered: 0, pendingStock: 0,
    retourAmount: 0, commercialAmount: 0, drafts: 0, draftsAmount: 0,
  })

  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  // ── reset state when docType changes ─────────────────────────────────────
  useEffect(() => {
    setSearch('')
    setStatus('all')
    setDateFrom('')
    setDateTo('')
    setPage(1)
    setSortBy('date')
    setSortDir('desc')
    setSelectedDocId(null)
  }, [docType])

  // ── load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const isOverdueFilter = statusFilter === 'overdue'
      const filters: Record<string, unknown> = {
        type: docType,
        page: isOverdueFilter ? 1 : page,
        limit: isOverdueFilter ? 9999 : 50,
      }
      if (search)    filters.search   = search
      if (dateFrom)  filters.dateFrom = dateFrom
      if (dateTo)    filters.dateTo   = dateTo
      if (statusFilter !== 'all' && !isOverdueFilter) filters.status = statusFilter

      const result = await api.getDocuments(filters) as PaginatedResponse<Document>
      setData(result)

      // compute stats from same result (avoid second API call)
      const allRows = result.rows ?? []
      const activeRows = allRows.filter(d => d.status !== 'cancelled' && d.status !== 'draft')

      setStats({
        total:           activeRows.length,
        confirmed:       activeRows.filter(d => d.status === 'confirmed').length,
        paid:            activeRows.filter(d => d.status === 'paid').length,
        partial:         activeRows.filter(d => d.status === 'partial').length,
        overdue:         activeRows.filter(d => isOverdue(d)).length,
        totalAmount:     activeRows.reduce((s, d) => s + d.total_ttc, 0),
        unpaidAmount:    activeRows.filter(d => ['confirmed', 'partial'].includes(d.status))
                            .reduce((s, d) => s + d.total_ttc, 0),
        overdueAmount:   activeRows.filter(d => isOverdue(d)).reduce((s, d) => s + d.total_ttc, 0),
        drafts:          allRows.filter(d => d.status === 'draft').length,
        draftsAmount:    allRows.filter(d => d.status === 'draft').reduce((s, d) => s + d.total_ttc, 0),
        accepted:        allRows.filter(d => d.status === 'confirmed').length,
        rejected:        allRows.filter(d => d.status === 'cancelled').length,
        expired:         allRows.filter(d => (d as any).validity_date && new Date((d as any).validity_date) < new Date() && d.status === 'draft').length,
        converted:       allRows.filter(d => (d as any).links?.some((l: any) => l.related_type === 'invoice')).length,
        delivered:       allRows.filter(d => d.status === 'delivered').length,
        pendingStock:    allRows.filter(d => (d as any).pending_stock_count > 0).length,
        retourAmount:    activeRows.reduce((s, d) => s + d.total_ttc, 0),
        commercialAmount: 0,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [docType, page, search, statusFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  // debounce search
  function handleSearch(v: string) {
    setSearch(v)
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setPage(1) }, 300)
  }

  // ── sort / filter client-side ─────────────────────────────────────────────

  const rows = (data?.rows ?? [])
    .filter(d => {
      if (statusFilter !== 'cancelled' && d.status === 'cancelled') return false
      if (statusFilter === 'overdue' && !isOverdue(d)) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date')   cmp = a.date.localeCompare(b.date)
      if (sortBy === 'number') cmp = a.number.localeCompare(b.number)
      if (sortBy === 'amount') cmp = a.total_ttc - b.total_ttc
      return sortDir === 'asc' ? cmp : -cmp
    })

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  // ─────────────────────────────────────────────────────────────────────────

  async function handleCancel(id: number) {
    try {
      const result = await api.cancelDocument(id) as any
      if (result?.cancelled && result?.avoirNumber) {
        toast(`✅ Document annulé — Avoir ${result.avoirNumber} créé automatiquement`, 'success')
      } else {
        toast('Document annulé', 'warning')
      }
      load()
    } catch (e: any) {
      const msg = e.message ?? ''
      if (msg.includes('période') || msg.includes('Période') || msg.includes('fermée') || msg.includes('closed')) {
        toast('Période comptable fermée', 'error')
      } else {
        toast(msg, 'error')
      }
    }
    finally { setCancelId(null) }
  }

  // ── sort icon ─────────────────────────────────────────────────────────────

  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return <span className="opacity-30">↕</span>
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        {!hideNewButton ? (
          <button
            className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
            onClick={() => setModalOpen(true)}>
            + Nouveau {DOC_LABELS[docType] ?? 'Document'}
          </button>
        ) : <div />}
      </div>

      {/* ── KPI cards — selon le type ── */}
      {docType === 'invoice' && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
          {[
            { label: 'Total facturé', value: fmt(stats.totalAmount) + ' MAD', sub: `${stats.total} facture(s)`,       color: 'text-primary dark:text-primary-100',    bg: 'bg-primary/5 dark:bg-primary/10' },
            { label: 'Impayé',        value: fmt(stats.unpaidAmount) + ' MAD', sub: 'À encaisser',                    color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', alert: stats.unpaidAmount > 0 },
            { label: 'En retard',     value: String(stats.overdue),            sub: fmt(stats.overdueAmount) + ' MAD', color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-900/20', alert: stats.overdue > 0 },
            { label: 'Confirmées',    value: String(stats.confirmed),           sub: 'En attente de paiement',        color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Brouillons',    value: fmt((stats as any).draftsAmount ?? 0) + ' MAD', sub: `${(stats as any).drafts ?? 0} brouillon(s)`, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-700/30' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg} ${(c as any).alert ? 'border-red-200 dark:border-red-700' : ''}`}>
              <div className="kpi-label">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {docType === 'quote' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
          {[
            { label: 'Total devis',    value: String(stats.total),              sub: fmt(stats.totalAmount) + ' MAD',  color: 'text-primary dark:text-primary-100',    bg: 'bg-primary/5 dark:bg-primary/10' },
            { label: 'Confirmés',      value: String(stats.accepted),           sub: 'Acceptés par le client',         color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
            { label: 'Annulés',        value: String(stats.rejected),           sub: 'Refusés ou annulés',             color: 'text-red-500 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20' },
            { label: 'Taux conversion',value: stats.total > 0 ? Math.round(stats.accepted / stats.total * 100) + '%' : '—', sub: 'Devis → Facture', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="kpi-label">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {docType === 'bl' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
          {[
            { label: 'Total BL',         value: String(stats.total),           sub: fmt(stats.totalAmount) + ' MAD',  color: 'text-primary dark:text-primary-100',    bg: 'bg-primary/5 dark:bg-primary/10' },
            { label: 'Livrés',           value: String(stats.delivered),       sub: 'Livraison confirmée',            color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
            { label: 'En attente',       value: String(stats.confirmed),       sub: 'Confirmés, non livrés',          color: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Stock en attente', value: String(stats.pendingStock),    sub: 'Mouvements non appliqués',       color: stats.pendingStock > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400', bg: stats.pendingStock > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-700/30' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="kpi-label">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {docType === 'proforma' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 shrink-0">
          {[
            { label: 'Total proformas', value: String(stats.total),            sub: fmt(stats.totalAmount) + ' MAD',  color: 'text-primary dark:text-primary-100',    bg: 'bg-primary/5 dark:bg-primary/10' },
            { label: 'Confirmées',      value: String(stats.confirmed),        sub: 'Envoyées au client',             color: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20' },
            { label: 'Brouillons',      value: String(stats.total - stats.confirmed - stats.paid), sub: 'En cours de préparation', color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-700/30' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="kpi-label">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {docType === 'avoir' && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 shrink-0">
          {[
            { label: 'Total avoirs',    value: String(stats.total),            sub: fmt(stats.totalAmount) + ' MAD',  color: 'text-primary dark:text-primary-100',    bg: 'bg-primary/5 dark:bg-primary/10' },
            { label: 'Montant total',   value: fmt(stats.totalAmount) + ' MAD', sub: 'Remboursé / déduit',           color: 'text-red-500 dark:text-red-400',          bg: 'bg-red-50 dark:bg-red-900/20' },
            { label: 'Confirmés',       value: String(stats.confirmed),        sub: 'Avoirs appliqués',               color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="kpi-label">{c.label}</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Recherche + filtre statut + dates ── */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input
          value={search}
          onChange={e => { handleSearch(e.target.value) }}
          className="input max-w-xs text-sm"
          placeholder="Rechercher..."
        />
        <select
          value={statusFilter}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="input w-40 text-sm">
          {FILTER_TABS.map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <input value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="input w-36 text-sm" type="date" title="Date début" />
        <span className="text-gray-400 text-xs">→</span>
        <input value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="input w-36 text-sm" type="date" title="Date fin" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors">✕</button>
        )}
      </div>

      {/* ── table ── */}
      <div className="card overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '65px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '68px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 cursor-pointer hover:text-primary" onClick={() => toggleSort('number')}>
                Numéro <SortIcon field="number" />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 cursor-pointer hover:text-primary" onClick={() => toggleSort('date')}>
                Date <SortIcon field="date" />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Client</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 cursor-pointer hover:text-primary whitespace-nowrap" onClick={() => toggleSort('amount')}>
                Total HT <SortIcon field="amount" />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">TVA</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">Total TTC</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">Statut</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-700 [&_td]:border [&_td]:border-slate-100 dark:[&_td]:border-slate-700">
            {loading && (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-16">
                  <div className="text-4xl mb-3">📄</div>
                  <div className="text-slate-500 dark:text-slate-400 font-medium">Aucun document</div>
                  <div className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                    {statusFilter !== 'all' ? 'Essayez un autre filtre' : `Créez votre premier ${DOC_LABELS[docType]?.toLowerCase()}`}
                  </div>
                </td>
              </tr>
            )}

            {!loading && rows.map(doc => {
              const overdue = isOverdue(doc)
              const isSelected = selectedDocId === doc.id
              const cfg = overdue
                ? STATUS_CFG.overdue
                : (STATUS_CFG[doc.status] ?? STATUS_CFG.draft)

              const payStatus = (doc as any).payment_status
              const isInvoiceType = ['invoice', 'purchase_invoice', 'import_invoice'].includes(doc.type)
              const payBar = isInvoiceType && doc.status !== 'cancelled' ? (
                payStatus === 'paid'    ? 'border-l-4 border-l-emerald-500' :
                payStatus === 'partial' ? 'border-l-4 border-l-amber-400' :
                doc.status === 'confirmed' ? 'border-l-4 border-l-blue-400' : ''
              ) : ''

              return (
                <tr key={doc.id}
                  onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedDocId(doc.id)
                  }}
                  className={`cursor-pointer transition-colors relative
                    ${docRowBg(doc.status, {
                      overdue,
                      pendingStock: (doc as any).pending_stock_count > 0,
                      selected: isSelected,
                    })}
                    ${isInvoiceType && !overdue ? payBar : ''}`}>

                  <td className="px-3 py-3 text-center whitespace-nowrap align-middle">
                    <span className="font-mono text-xs font-semibold text-primary dark:text-primary-100">{doc.number}</span>
                    {(doc as any).pending_stock_count > 0 && (
                      <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                        ⚠ Stock
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-3 text-center text-xs whitespace-nowrap align-middle text-slate-500 dark:text-slate-400">
                    {new Date(doc.date).toLocaleDateString('fr-FR')}
                  </td>

                  <td className="px-3 py-3 text-center font-medium truncate align-middle text-slate-800 dark:text-slate-200">
                    {doc.party_name ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
                  </td>

                  <td className="px-3 py-3 text-center whitespace-nowrap align-middle text-slate-600 dark:text-slate-300">
                    {fmt(doc.total_ht)} MAD
                  </td>

                  <td className="px-3 py-3 text-center text-xs whitespace-nowrap align-middle text-slate-500 dark:text-slate-400">
                    {fmt(doc.total_tva)} MAD
                  </td>

                  <td className="px-3 py-3 text-center font-semibold whitespace-nowrap align-middle text-slate-800 dark:text-slate-100">
                    {fmt(doc.total_ttc)} MAD
                  </td>

                  <td className="px-3 py-3 text-center align-middle">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                      {isInvoiceType && payStatus === 'partial' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          💰
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>

        </table>
      </div>

      {!loading && rows.length > 0 && (
        <button
          onClick={() => setShowTotals(true)}
          className="shrink-0 flex items-center justify-between px-4 py-2.5 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer w-full text-left">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Total — {rows.length} document{rows.length > 1 ? 's' : ''} &nbsp;
            <span className="text-xs text-gray-400">cliquer pour détails →</span>
          </span>
          <span className="text-base font-bold text-primary whitespace-nowrap" style={{ marginRight: "calc(90px + 72px)" }}>
            {fmt(rows.reduce((s, d) => s + d.total_ttc, 0))} MAD
          </span>
        </button>
      )}

      {/* ── pagination ── */}
      {data && data.total > 50 && (
        <div className="flex items-center justify-between shrink-0 text-xs text-slate-500 dark:text-slate-400">
          <span>{data.total} document(s)</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200">
              {page} / {Math.ceil(data.total / 50)}
            </span>
            <button disabled={page >= Math.ceil(data.total / 50)} onClick={() => setPage(p => p + 1)}
              className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      {/* ── Totals Modal ── */}
      <Modal open={showTotals} onClose={() => setShowTotals(false)}
        title={`📊 Récapitulatif — ${DOC_LABELS[docType] ?? 'Documents'}`} size="md">
        <div className="p-6 space-y-5">

          {/* Montants */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total HT',  value: rows.reduce((s,d) => s + d.total_ht,  0), color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30' },
              { label: 'Total TVA', value: rows.reduce((s,d) => s + d.total_tva, 0), color: 'text-gray-500',                    bg: 'bg-gray-50 dark:bg-gray-700/30' },
              ...(docType === 'invoice' ? [
                { label: 'Impayé',    value: stats.unpaidAmount,  color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/10' },
                { label: 'En retard', value: stats.overdueAmount, color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/10' },
              ] : []),
            ].map(r => (
              <div key={r.label} className={`rounded-xl p-4 ${r.bg}`}>
                <div className="text-xs text-gray-400 mb-1">{r.label}</div>
                <div className={`text-lg font-bold ${r.color}`}>{fmt(r.value)} MAD</div>
              </div>
            ))}
          </div>

          {/* Statuts */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Répartition par statut</div>
            <div className="space-y-1.5">
              {(() => {
                const statusGroups: Record<string, { label: string; color: string }> = {
                  draft:     { label: 'Brouillons',  color: 'text-gray-500' },
                  confirmed: { label: 'Confirmés',   color: 'text-blue-600' },
                  paid:      { label: 'Payés',       color: 'text-green-600' },
                  partial:   { label: 'Partiels',    color: 'text-amber-600' },
                  delivered: { label: 'Livrés',      color: 'text-green-600' },
                  cancelled: { label: 'Annulés',     color: 'text-gray-400' },
                }
                const allRows = data?.rows ?? []
                return Object.entries(statusGroups).map(([status, cfg]) => {
                  const count = allRows.filter(d => d.status === status).length
                  if (count === 0) return null
                  const amount = allRows.filter(d => d.status === status).reduce((s,d) => s + d.total_ttc, 0)
                  const pct = rows.length > 0 ? (count / allRows.length) * 100 : 0
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <div className="text-xs text-gray-500 w-20 shrink-0">{cfg.label}</div>
                      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className={`text-xs font-semibold w-6 text-right ${cfg.color}`}>{count}</div>
                      <div className="text-xs text-gray-400 w-28 text-right">{fmt(amount)} MAD</div>
                    </div>
                  )
                }).filter(Boolean)
              })()}
            </div>
          </div>

          {/* Total final */}
          <div className="flex items-center justify-between pt-3 border-t-2 border-primary/20">
            <span className="font-bold text-gray-700 dark:text-gray-200">TOTAL TTC GÉNÉRAL</span>
            <span className="text-xl font-bold text-primary">{fmt(rows.reduce((s,d) => s + d.total_ttc, 0))} MAD</span>
          </div>
        </div>
      </Modal>

      {/* ── modals ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={`Nouveau ${DOC_LABELS[docType] ?? 'Document'}`}
        size={docType === 'avoir' ? 'lg' : 'xl'}>
        {docType === 'quote'    && <QuoteForm    docType="quote"    onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />}
        {docType === 'proforma' && <ProformaForm                   onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />}
        {docType === 'bl'       && <BLForm                         onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />}
        {docType === 'avoir'    && <AvoirForm                      onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />}
        {(docType === 'invoice' || !['quote','proforma','bl','avoir'].includes(docType)) &&
          <InvoiceForm docType={docType} onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
        }
      </Modal>

      <Drawer open={selectedDocId !== null} onClose={() => setSelectedDocId(null)}
        title="Détails du document">
        {selectedDocId !== null && (
          <DocumentDetail docId={selectedDocId}
            onClose={() => setSelectedDocId(null)}
            onUpdated={load} />
        )}
      </Drawer>

      <ConfirmDialog
        open={cancelId !== null}
        title="Annuler ce document"
        message="Le document sera marqué comme annulé. Cette action ne peut pas être défaite."
        confirmLabel="Annuler le document"
        danger
        onConfirm={() => cancelId && handleCancel(cancelId)}
        onCancel={() => setCancelId(null)}
      />
    </div>
  )
}
