import { fmt } from '../../lib/format'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { Account } from '../../types'
import PrintPreviewModal from '../../components/ui/PrintPreviewModal'

export default function GrandLivreView() {

  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState<number>(0)
  const [lines, setLines] = useState<any[]>([])

  // Default: start of current year → today
  const _today = new Date()
  const [startDate, setStartDate] = useState(`${_today.getFullYear()}-01-01`)
  const [endDate, setEndDate] = useState(_today.toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [showAnnulations, setShowAnnulations] = useState(true)

  useEffect(() => {
    api.getAccounts().then((r: any) => setAccounts(r ?? []))
  }, [])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [selectedAccount, startDate, endDate])

  async function load(showAnn = showAnnulations) {
    if (!selectedAccount) return
    setLoading(true)
    try {
      const result = await api.getGrandLivre({
        account_id: selectedAccount,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        hide_annulations: !showAnn,
      } as any) as any[]
      setLines(result)
    } finally { setLoading(false) }
  }

  function handleToggle(val: boolean) {
    setShowAnnulations(val)
    load(val)
  }

  // fmt imported from lib/format
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={selectedAccount} onChange={e => setSelectedAccount(Number(e.target.value))} className="input w-64">
          <option value={0}>— Choisir un compte —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        <input value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" type="date" placeholder="Du" />
        <input value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" type="date" placeholder="Au" />
        <button onClick={() => load()} disabled={!selectedAccount} className="btn-primary">Afficher</button>

        {/* Toggle إظهار/إخفاء الإلغاءات */}
        <label className="flex items-center gap-2 cursor-pointer select-none ml-2">
          <div
            onClick={() => handleToggle(!showAnnulations)}
            className={`relative w-9 h-5 rounded-full transition-colors ${showAnnulations ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showAnnulations ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
            Afficher les annulations
          </span>
        </label>
        {lines.length > 0 && (
          <button onClick={() => {
            const account = accounts.find(a => a.id === selectedAccount)
            const rows_html = lines.map(l => `<tr>
              <td>${new Date(l.date).toLocaleDateString('fr-FR')}</td>
              <td style="font-family:monospace;color:#1E3A5F">${l.reference ?? ''}</td>
              <td>${l.description}</td>
              <td style="text-align:right;color:#15803d">${l.debit > 0 ? fmt(l.debit) : ''}</td>
              <td style="text-align:right;color:#dc2626">${l.credit > 0 ? fmt(l.credit) : ''}</td>
              <td style="text-align:right;font-weight:bold;color:${l.balance >= 0 ? '#15803d' : '#dc2626'}">${fmt(Math.abs(l.balance))} ${l.balance >= 0 ? 'D' : 'C'}</td>
            </tr>`).join('')
            const html = `<!DOCTYPE html><html><head><title>Grand Livre</title>
              <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
              h2{color:#1E3A5F}table{width:100%;border-collapse:collapse}
              th{background:#1E3A5F;color:white;padding:8px;text-align:left}
              td{padding:6px 8px;border-bottom:1px solid #eee}
              tfoot td{font-weight:bold;background:#f0f4f8;border-top:2px solid #1E3A5F}
              @page{size:A4;margin:15mm}
              </style></head><body>
              <h2>Grand Livre — ${account?.code} ${account?.name}</h2>
              <p style="color:#666;font-size:11px">Période: ${startDate || '—'} → ${endDate || '—'} | Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
              <table><thead><tr><th>Date</th><th>Référence</th><th>Description</th><th style="text-align:right">Débit</th><th style="text-align:right">Crédit</th><th style="text-align:right">Solde</th></tr></thead>
              <tbody>${rows_html}</tbody>
              <tfoot><tr><td colspan="3" style="text-align:right">Totaux</td>
              <td style="text-align:right;color:#15803d">${fmt(totalDebit)}</td>
              <td style="text-align:right;color:#dc2626">${fmt(totalCredit)}</td>
              <td style="text-align:right">${fmt(Math.abs(totalDebit - totalCredit))} ${totalDebit >= totalCredit ? 'D' : 'C'}</td>
              </tr></tfoot></table></body></html>`
            setPreviewHtml(html)
          }} className="btn-secondary btn-sm ml-auto">📄 PDF</button>
        )}
      </div>

      {loading && (
        <div className="card animate-pulse p-4 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded flex-1"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            </div>
          ))}
        </div>
      )}
      {lines.length > 0 && (
        <div className="card overflow-y-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '110px' }} />
              <col style={{ width: '130px' }} />
              <col />
              <col style={{ width: '130px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '130px' }} />
            </colgroup>
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Date</th>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Référence</th>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Description</th>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Débit</th>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Crédit</th>
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center align-middle font-medium text-gray-600">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
              {lines.map((l, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-center align-middle text-gray-500 text-xs">{new Date(l.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-2 text-center align-middle font-mono text-xs text-primary">{l.reference}</td>
                  <td className="px-4 py-2 text-center align-middle text-gray-600">{l.description}</td>
                  <td className="px-4 py-2 text-center align-middle text-green-700 font-medium">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                  <td className="px-4 py-2 text-center align-middle text-red-600 font-medium">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                  <td className={`px-4 py-2 text-center align-middle font-bold ${l.balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {fmt(Math.abs(l.balance))} {l.balance >= 0 ? 'D' : 'C'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-700/50 font-bold border-t-2 border-gray-200 sticky bottom-0 z-10">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-center align-middle">Totaux</td>
                <td className="px-4 py-3 text-center align-middle text-green-700">{fmt(totalDebit)}</td>
                <td className="px-4 py-3 text-center align-middle text-red-600">{fmt(totalCredit)}</td>
                <td className={`px-4 py-3 text-center align-middle ${totalDebit - totalCredit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(Math.abs(totalDebit - totalCredit))} {totalDebit - totalCredit >= 0 ? 'D' : 'C'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && lines.length === 0 && selectedAccount > 0 && (
        <div className="card p-12 text-center text-gray-400">Aucun mouvement pour ce compte</div>
      )}

      {previewHtml && (
        <PrintPreviewModal
          html={previewHtml}
          title={`Grand Livre — ${accounts.find(a => a.id === selectedAccount)?.code ?? ''} ${accounts.find(a => a.id === selectedAccount)?.name ?? ''}`}
          filename={`Grand-Livre-${accounts.find(a => a.id === selectedAccount)?.code ?? 'compte'}-${startDate}-${endDate}.pdf`}
          onClose={() => setPreviewHtml(null)}
        />
      )}
    </div>
  )
}
