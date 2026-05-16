import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Pagination from '../../components/ui/Pagination'
import Drawer from '../../components/ui/Drawer'

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  CREATE:      { label: 'Création',       color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',   icon: '➕' },
  UPDATE:      { label: 'Modification',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',       icon: '✏️' },
  DELETE:      { label: 'Suppression',    color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           icon: '🗑️' },
  CONFIRM:     { label: 'Confirmation',   color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',   icon: '✅' },
  CANCEL:      { label: 'Annulation',     color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',           icon: '❌' },
  LOGIN:       { label: 'Connexion',      color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',          icon: '🔑' },
  LOGOUT:      { label: 'Déconnexion',    color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',          icon: '🚪' },
  PAYMENT:     { label: 'Paiement',       color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   icon: '💳' },
  APPLY_STOCK: { label: 'Stock appliqué', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: '📦' },
}

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'Facture', quote: 'Devis', bl: 'Bon de Livraison',
  proforma: 'Proforma', avoir: 'Avoir',
  purchase_order: 'Bon de Commande', bl_reception: 'Bon de Réception',
  purchase_invoice: 'Facture Fournisseur', import_invoice: 'Importation',
}

const TABLE_LABELS: Record<string, string> = {
  documents: 'Document', payments: 'Paiement', clients: 'Client',
  suppliers: 'Fournisseur', products: 'Produit', users: 'Utilisateur',
  production_orders: 'Production', bom_templates: 'Nomenclature',
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Statut', amount: 'Montant', method: 'Mode de paiement',
  name: 'Nom', email: 'Email', role: 'Rôle', is_active: 'Actif',
  total_ht: 'Total HT', total_tva: 'TVA', total_ttc: 'Total TTC',
  number: 'Numéro', type: 'Type', date: 'Date', notes: 'Notes',
  party_id: 'Tiers', due_date: 'Échéance', payment_status: 'Statut paiement',
  stock_quantity: 'Quantité stock', sale_price: 'Prix de vente',
  cheque_number: 'N° Chèque', bank: 'Banque',
}

// ── Détail d'une entrée audit ────────────────────────────────────────────────
function AuditDetail({ row }: { row: any }) {
  const cfg = ACTION_LABELS[row.action] ?? { label: row.action, color: 'bg-gray-100 text-gray-600', icon: '•' }

  const fmtDate = (d: string) =>
    new Date(d.endsWith('Z') ? d : d + 'Z')
      .toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

  // بناء قائمة التغييرات المقارنة
  const changes: { field: string; before: any; after: any }[] = []
  if (row.old_values && row.new_values) {
    const allKeys = new Set([...Object.keys(row.old_values), ...Object.keys(row.new_values)])
    allKeys.forEach(k => {
      const before = row.old_values[k]
      const after  = row.new_values[k]
      if (String(before) !== String(after)) {
        changes.push({ field: k, before, after })
      }
    })
  }

  // ✅ عرض مفصّل للقيود المحاسبية
  const renderJournalEntry = (entry: any) => {
    if (!entry || typeof entry !== 'object') return null
    
    return (
      <div className="space-y-3">
        {/* معلومات القيد */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">📋 Écriture comptable</span>
            {entry.reference && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-mono">
                {entry.reference}
              </span>
            )}
          </div>
          {entry.description && (
            <div className="text-sm text-gray-700 dark:text-gray-300">{entry.description}</div>
          )}
          {entry.date && (
            <div className="text-xs text-gray-500">
              📅 {new Date(entry.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderJournalLines = (lines: any[]) => {
    if (!Array.isArray(lines) || lines.length === 0) return null
    
    const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
    const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
    
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
          💰 Écritures comptables ({lines.length})
        </div>
        
        {/* جدول الخطوط */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Compte</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400">Débit</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400">Crédit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800 dark:text-gray-200">
                      {line.account_code && (
                        <span className="font-mono text-primary mr-1.5">{line.account_code}</span>
                      )}
                      {line.account_name}
                    </div>
                    {line.notes && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{line.notes}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {line.debit > 0 ? (
                      <span className="text-green-600 dark:text-green-400 font-semibold">
                        {Number(line.debit).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {line.credit > 0 ? (
                      <span className="text-red-600 dark:text-red-400 font-semibold">
                        {Number(line.credit).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-800 font-semibold">
              <tr>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">Total</td>
                <td className="px-3 py-2 text-right font-mono text-green-600 dark:text-green-400">
                  {totalDebit.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-red-600 dark:text-red-400">
                  {totalCredit.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        {/* تحقق من التوازن */}
        {Math.abs(totalDebit - totalCredit) < 0.01 ? (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <span>✓</span>
            <span>Écriture équilibrée</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <span>⚠</span>
            <span>Déséquilibre: {Math.abs(totalDebit - totalCredit).toFixed(2)} MAD</span>
          </div>
        )}
      </div>
    )
  }

  const fmtVal = (v: any) => {
    if (v === null || v === undefined) return <span className="text-gray-300 italic">—</span>
    if (typeof v === 'boolean') return v ? '✓ Oui' : '✗ Non'
    if (v === 1 || v === 0) return v === 1 ? '✓ Oui' : '✗ Non'
    
    // ✅ إذا كان object أو array → عرض JSON منسق
    if (typeof v === 'object') {
      return (
        <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto max-w-md">
          {JSON.stringify(v, null, 2)}
        </pre>
      )
    }
    
    return String(v)
  }

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex items-start gap-4">
        <div className="text-3xl">{cfg.icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-sm px-3 py-1 rounded-full font-semibold ${cfg.color}`}>
              {cfg.label}
            </span>
            {row.doc_type && (
              <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded font-medium uppercase">
                {DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type}
              </span>
            )}
          </div>
          {/* اسم الوثيقة/السجل — من ref_label أو new_values أو old_values */}
          {(() => {
            const label = row.ref_label
              ?? row.new_values?.number
              ?? row.old_values?.number
              ?? row.new_values?.name
              ?? row.old_values?.name
            return label ? (
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{label}</div>
            ) : null
          })()}
          {row.party_name && (
            <div className="text-sm text-gray-500 mt-0.5">{row.party_name}</div>
          )}
        </div>
      </div>

      {/* Infos de base */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
          <div className="text-xs text-gray-400 mb-1">Date & heure</div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {fmtDate(row.created_at)}
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
          <div className="text-xs text-gray-400 mb-1">Effectué par</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {row.user_name ?? '—'}
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
          <div className="text-xs text-gray-400 mb-1">Module</div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {TABLE_LABELS[row.table_name] ?? row.table_name}
          </div>
        </div>
      </div>

      {/* Changements comparés */}
      {changes.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
            Modifications ({changes.length})
          </div>
          <div className="space-y-2">
            {changes.map((c, i) => (
              <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {FIELD_LABELS[c.field] ?? c.field}
                </div>
                <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700">
                  <div className="px-3 py-2 bg-red-50 dark:bg-red-900/10">
                    <div className="text-[10px] text-red-400 mb-0.5">Avant</div>
                    <div className="text-xs text-red-700 dark:text-red-300 font-medium">{fmtVal(c.before)}</div>
                  </div>
                  <div className="px-3 py-2 bg-green-50 dark:bg-green-900/10">
                    <div className="text-[10px] text-green-400 mb-0.5">Après</div>
                    <div className="text-xs text-green-700 dark:text-green-300 font-medium">{fmtVal(c.after)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Données brutes si pas de comparaison */}
      {changes.length === 0 && (row.new_values || row.old_values) && (() => {
        const data = row.new_values ?? row.old_values ?? {}
        
        // ✅ عرض خاص للقيود المحاسبية المحذوفة
        if (row.action === 'DELETE_JOURNAL_ENTRY' && data.entry && data.lines) {
          return (
            <div className="space-y-4">
              {renderJournalEntry(data.entry)}
              {renderJournalLines(data.lines)}
              
              {/* معلومات إضافية */}
              {(data.total_debit || data.total_credit) && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Débit:</span>
                    <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                      {Number(data.total_debit || 0).toFixed(2)} MAD
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Crédit:</span>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                      {Number(data.total_credit || 0).toFixed(2)} MAD
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        }
        
        // ✅ عرض عادي للبيانات الأخرى
        return (
          <div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Données</div>
            <div className="space-y-3">
              {Object.entries(data).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <span className="text-xs text-gray-500 font-medium">{FIELD_LABELS[k] ?? k}</span>
                  <div className="text-xs text-gray-700 dark:text-gray-200">{fmtVal(v)}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Raison si présente */}
      {row.reason && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <div className="text-xs text-amber-600 font-semibold mb-1">Motif</div>
          <div className="text-sm text-amber-800 dark:text-amber-300">{row.reason}</div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ──────────────────────────────────────────────────────────
export default function AuditSettings() {
  const [rows, setRows]       = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [users, setUsers]     = useState<any[]>([])
  const [filters, setFilters] = useState({ start_date: '', end_date: '', action: '', user_id: '' })
  const [selected, setSelected] = useState<any | null>(null)

  const LIMIT = 50

  useEffect(() => { api.getAuditUsers().then(setUsers).catch(() => {}) }, [])
  useEffect(() => { load() }, [page])
  useEffect(() => {
    const h = () => { api.getAuditUsers().then(setUsers).catch(() => {}); load() }
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await api.getAuditLog({
        ...filters,
        user_id: filters.user_id ? Number(filters.user_id) : undefined,
        page, limit: LIMIT,
      }) as any
      setRows(result.rows ?? [])
      setTotal(result.total ?? 0)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl">
      <h2 className="text-lg font-semibold mb-4">Journal d'Audit</h2>

      {/* Filtres */}
      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Du</label>
          <input type="date" value={filters.start_date}
            onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))}
            className="input w-36" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Au</label>
          <input type="date" value={filters.end_date}
            onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))}
            className="input w-36" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Action</label>
          <select value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            className="input w-40">
            <option value="">Toutes</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Utilisateur</label>
          <select value={filters.user_id}
            onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
            className="input w-40">
            <option value="">Tous</option>
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <button onClick={() => { setPage(1); load() }} className="btn-primary btn-sm">🔍 Filtrer</button>
        <button onClick={() => { setFilters({ start_date: '', end_date: '', action: '', user_id: '' }); setPage(1) }}
          className="btn-secondary btn-sm">✕ Réinitialiser</button>
        <span className="text-xs text-gray-400 ml-auto">{total} entrée(s)</span>
      </div>

      {/* Tableau */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">Chargement...</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <div className="text-3xl mb-2">📋</div>
            <div className="text-sm">Aucune entrée d'audit</div>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utilisateur</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Concerne</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((row: any) => {
                  const cfg = ACTION_LABELS[row.action] ?? { label: row.action, color: 'bg-gray-100 text-gray-600', icon: '•' }
                  const hasDetail = row.new_values || row.old_values || row.reason
                  return (
                    <tr key={row.id}
                      onClick={() => hasDetail && setSelected(row)}
                      className={`transition-colors ${hasDetail ? 'cursor-pointer hover:bg-primary/5 dark:hover:bg-primary/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString('fr-FR')}
                      </td>
                      <td className="px-4 py-3 font-medium text-sm">{row.user_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.ref_label ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              {row.doc_type && (
                                <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">
                                  {DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type}
                                </span>
                              )}
                              <span className="font-semibold text-gray-800 dark:text-gray-100">{row.ref_label}</span>
                              {hasDetail && <span className="text-primary text-[10px] ml-1">→ détails</span>}
                            </div>
                            {row.party_name && (
                              <span className="text-gray-400 text-[11px]">{row.party_name}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">
                            {TABLE_LABELS[row.table_name] ?? row.table_name}
                            {hasDetail && <span className="text-primary ml-1 not-italic">→ détails</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
          </>
        )}
      </div>

      {/* Drawer détail */}
      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Détail de l'événement">
        {selected && <AuditDetail row={selected} />}
      </Drawer>
    </div>
  )
}
