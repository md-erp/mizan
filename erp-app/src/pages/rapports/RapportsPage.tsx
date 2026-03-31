import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store/app.store'
import { toast } from '../../components/ui/Toast'

const REPORTS = [
  { id: 'overview',       icon: '🏠', label: 'Vue d\'ensemble', desc: '' },
  { id: 'sales',          icon: '💰', label: 'Ventes',          desc: 'Par période, client, produit' },
  { id: 'purchases',      icon: '🛒', label: 'Achats',          desc: 'Par période, fournisseur' },
  { id: 'stock',          icon: '📦', label: 'Stock',           desc: 'Inventaire avec valeurs CMUP' },
  { id: 'stock_movements',icon: '🔄', label: 'Mouvements',      desc: 'Entrées et sorties' },
  { id: 'receivables',    icon: '📋', label: 'Créances',        desc: 'Clients débiteurs' },
  { id: 'cheques',        icon: '🏦', label: 'Chèques & LCN',   desc: 'Échéances à venir' },
  { id: 'tva_detail',     icon: '🧾', label: 'TVA',             desc: 'Par taux et période' },
  { id: 'profit_loss',    icon: '📈', label: 'P&L',             desc: 'Produits vs Charges' },
  { id: 'payments',       icon: '💳', label: 'Paiements',       desc: 'Historique règlements' },
  { id: 'payables',       icon: '🏭', label: 'Dettes Fourn.',    desc: 'Fournisseurs créditeurs' },
]

interface KpiStats {
  invoices_total: number; invoices_count: number; unpaid_total: number
  clients_count: number; products_low_stock: number; cheques_due_soon: number
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', confirmed: 'badge-blue', partial: 'badge-orange',
  paid: 'badge-green', cancelled: 'badge-red',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', confirmed: 'Confirmée', partial: 'Partiel',
  paid: 'Payée', cancelled: 'Annulée',
}

export default function RapportsPage() {
  const [selected, setSelected] = useState('overview')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [kpi, setKpi] = useState<KpiStats | null>(null)
  const [kpiLoading, setKpiLoading] = useState(true)
  const [recentDocs, setRecentDocs] = useState<any[]>([])
  const { config } = useAppStore()
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set())
  const [showExportPicker, setShowExportPicker] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    async function loadKpi() {
      setKpiLoading(true)
      try {
        const [recentResult, clients, products, notifications] = await Promise.all([
          api.getDocuments({ type: 'invoice', limit: 5 }) as Promise<any>,
          api.getClients({ limit: 1 }) as Promise<any>,
          api.getProducts({ limit: 500 }) as Promise<any>,
          api.getNotifications() as Promise<any[]>,
        ])
        const allDocs = await api.getDocuments({ type: 'invoice', limit: 1000 }) as any
        const invoices = allDocs.rows ?? []
        const unpaid = invoices.filter((d: any) => d.status === 'confirmed' || d.status === 'partial')
        const lowStock = (products.rows ?? []).filter((p: any) => p.stock_quantity <= p.min_stock && p.min_stock > 0)
        setKpi({
          invoices_total:     invoices.reduce((s: number, d: any) => s + d.total_ttc, 0),
          invoices_count:     invoices.length,
          unpaid_total:       unpaid.reduce((s: number, d: any) => s + d.total_ttc, 0),
          clients_count:      clients.total ?? 0,
          products_low_stock: lowStock.length,
          cheques_due_soon:   ((notifications ?? []).filter((n: any) => n.type === 'cheque')).length,
        })
        setRecentDocs(recentResult.rows ?? [])
      } catch (_) { /* silently ignore */ }
      finally { setKpiLoading(false) }
    }
    loadKpi()
  }, [])

  async function loadReport(type: string) {
    if (type === 'overview') { setSelected('overview'); return }
    setSelected(type)
    setLoading(true)
    try {
      const result = await api.getReport({ type, filters: { start_date: startDate, end_date: endDate } }) as any
      if (type === 'profit_loss') {
        setData([
          ...(result.revenues ?? []).map((r: any) => ({ ...r, _section: 'Produits' })),
          ...(result.expenses ?? []).map((r: any) => ({ ...r, _section: 'Charges' })),
        ])
      } else {
        setData(Array.isArray(result) ? result : [])
      }
    } catch (e: any) { toast(e.message, 'error') }
    finally { setLoading(false) }
  }

  async function handleExportCurrent() {
    if (selected === 'overview' || data.length === 0) return
    try {
      await api.excelExportReport({ type: selected, rows: data, filters: { start_date: startDate, end_date: endDate } })
      toast('✅ Fichier Excel enregistré')
    } catch (e: any) { toast(e.message, 'error') }
  }

  async function handleMultiExport() {
    if (exportSelected.size === 0) return
    setExporting(true)
    setShowExportPicker(false)
    try {
      // جمع كل البيانات أولاً
      const reportsData: Array<{ type: string; label: string; rows: any[] }> = []

      for (const reportId of exportSelected) {
        const report = REPORTS.find(r => r.id === reportId)
        if (!report) continue
        const result = await api.getReport({ type: reportId, filters: { start_date: startDate, end_date: endDate } }) as any
        let rows: any[] = []
        if (reportId === 'profit_loss') {
          rows = [...(result.revenues ?? []), ...(result.expenses ?? [])]
        } else {
          rows = Array.isArray(result) ? result : []
        }
        reportsData.push({ type: reportId, label: report.label, rows })
      }

      // Exporter tout dans un seul fichier avec onglets séparés
      const result = await api.excelExportMultiple({ reports: reportsData }) as any
      if (result?.canceled) return
      toast(`✅ ${reportsData.length} rapport(s) exportés dans un seul fichier`)
      setExportSelected(new Set())
    } catch (e: any) { toast(e.message, 'error') }
    finally { setExporting(false) }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)
  const currentReport = REPORTS.find(r => r.id === selected)

  return (
    <div className="h-full flex flex-col">
      {/* Tabs navigation */}
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-0.5 py-1.5 overflow-x-auto">
          {REPORTS.map(r => (
            <button key={r.id} onClick={() => loadReport(r.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all
                ${selected === r.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
              <span>{r.icon}</span>
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="text-sm text-gray-500">Période:</span>
        <input value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" type="date" />
        <span className="text-gray-400 text-sm">→</span>
        <input value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" type="date" />
        {selected !== 'overview' && (
          <button onClick={() => loadReport(selected)} className="btn-primary btn-sm">↻ Actualiser</button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Export rapport actuel */}
          {selected !== 'overview' && data.length > 0 && (
            <button onClick={handleExportCurrent} className="btn-secondary btn-sm">
              📥 Excel
            </button>
          )}

          {/* Export multiple */}
          <div className="relative">
            <button
              onClick={() => setShowExportPicker(p => !p)}
              className="btn-secondary btn-sm flex items-center gap-1">
              📦 Export groupé
              <span className="text-xs">▾</span>
            </button>

            {showExportPicker && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl w-64 p-3">
                <div className="text-xs font-semibold text-gray-500 mb-2">Sélectionnez les rapports à exporter</div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {REPORTS.filter(r => r.id !== 'overview').map(r => (
                    <label key={r.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                      <input type="checkbox"
                        checked={exportSelected.has(r.id)}
                        onChange={() => {
                          setExportSelected(prev => {
                            const next = new Set(prev)
                            next.has(r.id) ? next.delete(r.id) : next.add(r.id)
                            return next
                          })
                        }}
                        className="w-4 h-4"
                      />
                      <span>{r.icon}</span>
                      <span className="text-sm">{r.label}</span>
                    </label>
                  ))}
                </div>
                <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-2 flex gap-2">
                  <button onClick={() => setShowExportPicker(false)} className="btn-secondary btn-sm flex-1 justify-center">
                    Annuler
                  </button>
                  <button
                    onClick={handleMultiExport}
                    disabled={exportSelected.size === 0 || exporting}
                    className="btn-primary btn-sm flex-1 justify-center">
                    {exporting ? '...' : `📥 Exporter (${exportSelected.size})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-auto">
        {/* Vue d'ensemble — Dashboard */}
        {selected === 'overview' && (
          <div className="p-6 space-y-6">
            {/* Greeting */}
            <div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-white">
                {new Date().getHours() < 12 ? 'Bonjour' : new Date().getHours() < 18 ? 'Bon après-midi' : 'Bonsoir'}, {config?.company_name ?? 'Bienvenue'} 👋
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>

            {/* KPI Cards */}
            {kpiLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="card p-5 animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-2/3 mb-3"></div>
                    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Facturé', value: fmt(kpi?.invoices_total ?? 0) + ' MAD', sub: `${kpi?.invoices_count ?? 0} facture(s)`, icon: '💰', color: 'text-primary', bg: 'bg-primary/5', alert: false },
                  { label: 'Impayé', value: fmt(kpi?.unpaid_total ?? 0) + ' MAD', sub: 'À encaisser', icon: '⏳', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/10', alert: (kpi?.unpaid_total ?? 0) > 0 },
                  { label: 'Clients', value: String(kpi?.clients_count ?? 0), sub: 'Clients actifs', icon: '👥', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/10', alert: false },
                  { label: 'Alertes', value: String((kpi?.products_low_stock ?? 0) + (kpi?.cheques_due_soon ?? 0)), sub: `${kpi?.products_low_stock ?? 0} stock · ${kpi?.cheques_due_soon ?? 0} chèques`, icon: '🔔', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/10', alert: ((kpi?.products_low_stock ?? 0) + (kpi?.cheques_due_soon ?? 0)) > 0 },
                ].map(card => (
                  <div key={card.label} className={`card p-5 ${card.bg} ${card.alert ? 'border-orange-200 dark:border-orange-800' : ''}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-gray-500">{card.label}</span>
                      <span className="text-2xl">{card.icon}</span>
                    </div>
                    <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
                    <div className="text-xs text-gray-400 mt-1">{card.sub}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dernières factures */}
              <div className="card">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300">Dernières factures</h3>
                  <span className="text-xs text-gray-400">5 dernières</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {recentDocs.length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-sm">Aucune facture</div>
                  )}
                  {recentDocs.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <div>
                        <div className="font-mono text-xs font-bold text-primary">{doc.number}</div>
                        <div className="text-sm text-gray-600">{doc.party_name ?? '—'}</div>
                        <div className="text-xs text-gray-400">{new Date(doc.date).toLocaleDateString('fr-FR')}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{fmt(doc.total_ttc)} MAD</div>
                        <span className={`text-xs ${STATUS_BADGE[doc.status] ?? 'badge-gray'}`}>
                          {STATUS_LABEL[doc.status] ?? doc.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions rapides */}
              <div className="card">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300">Actions rapides</h3>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  {[
                    { icon: '📄', label: 'Nouvelle Facture' },
                    { icon: '👤', label: 'Nouveau Client' },
                    { icon: '📦', label: 'Nouveau Produit' },
                    { icon: '🛒', label: 'Bon de Commande' },
                    { icon: '📊', label: 'Balance Comptable' },
                    { icon: '💾', label: 'Sauvegarder' },
                  ].map(item => (
                    <button key={item.label}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all text-left group">
                      <span className="text-xl">{item.icon}</span>
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-primary">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rapport en chargement */}
        {selected !== 'overview' && loading && (
          <div className="flex items-center justify-center h-64 text-gray-400">Chargement...</div>
        )}

        {/* Rapport vide */}
        {selected !== 'overview' && !loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <div className="text-4xl mb-3">{currentReport?.icon}</div>
            <div className="font-medium">{currentReport?.label}</div>
            <div className="text-sm mt-1">Aucune donnée — ajustez la période et actualisez</div>
          </div>
        )}

        {/* Tableau de données */}
        {selected !== 'overview' && !loading && data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                {Object.keys(data[0]).filter(k => !k.startsWith('_')).map(k => (
                  <th key={k} className="px-4 py-3 text-left font-medium text-gray-600 capitalize whitespace-nowrap">
                    {k.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  {Object.entries(row).filter(([k]) => !k.startsWith('_')).map(([, val]: [string, any], j) => (
                    <td key={j} className="px-4 py-2 whitespace-nowrap">
                      {typeof val === 'number'
                        ? <span className="font-medium">{fmt(val)}</span>
                        : typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)
                          ? new Date(val).toLocaleDateString('fr-FR')
                          : String(val ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
