import { fmt } from '../../lib/format'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import PrintPreviewModal from '../../components/ui/PrintPreviewModal'

export default function BalanceView() {

  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  // Default: start of current year → today
  const today = new Date()
  const defaultStart = `${today.getFullYear()}-01-01`
  const defaultEnd = today.toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)

  async function load() {
    setLoading(true)
    try {
      const result = await api.getBalance({ start_date: startDate || undefined, end_date: endDate || undefined }) as any[]
      setRows(result.filter((r: any) => r.total_debit > 0 || r.total_credit > 0))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  // fmt imported from lib/format

  const totalDebit  = rows.reduce((s, r) => s + r.total_debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.total_credit, 0)

  const CLASS_LABELS: Record<number, string> = {
    1: 'Financement permanent', 2: 'Actif immobilisé', 3: 'Actif circulant',
    4: 'Passif circulant', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits',
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-3">
        <input value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" type="date" />
        <input value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" type="date" />
        <button onClick={load} className="btn-primary">Actualiser</button>
        <button className="btn-secondary btn-sm ml-auto" onClick={async () => {
          try {
            await api.excelExportBalance({ start_date: startDate || undefined, end_date: endDate || undefined })
            toast('✅ Fichier Excel enregistré')
          } catch (e: any) { toast(e.message, 'error') }
        }}>📥 Excel</button>
        <button className="btn-secondary btn-sm" onClick={() => {
          const rows_html = rows.map(r => {
            const solde = r.total_debit - r.total_credit
            return `<tr>
              <td style="font-family:monospace;font-weight:bold;color:#1E3A5F">${r.code}</td>
              <td>${r.name}</td>
              <td style="text-align:right">${fmt(r.total_debit)}</td>
              <td style="text-align:right">${fmt(r.total_credit)}</td>
              <td style="text-align:right;color:#15803d">${solde > 0 ? fmt(solde) : ''}</td>
              <td style="text-align:right;color:#dc2626">${solde < 0 ? fmt(Math.abs(solde)) : ''}</td>
            </tr>`
          }).join('')
          const html = `<!DOCTYPE html><html><head><title>Balance Comptable</title>
            <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
            h2{color:#1E3A5F}table{width:100%;border-collapse:collapse}
            th{background:#1E3A5F;color:white;padding:8px;text-align:left}
            td{padding:6px 8px;border-bottom:1px solid #eee}
            tfoot td{font-weight:bold;background:#f0f4f8;border-top:2px solid #1E3A5F}
            @page{size:A4;margin:15mm}
            </style></head><body>
            <h2>Balance Comptable</h2>
            <p style="color:#666;font-size:11px">Période: ${startDate || '—'} → ${endDate || '—'} | Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
            <table><thead><tr><th>Code</th><th>Intitulé</th><th style="text-align:right">Total Débit</th><th style="text-align:right">Total Crédit</th><th style="text-align:right">Solde Débiteur</th><th style="text-align:right">Solde Créditeur</th></tr></thead>
            <tbody>${rows_html}</tbody>
            <tfoot><tr><td colspan="2" style="text-align:right">TOTAUX</td>
            <td style="text-align:right">${fmt(totalDebit)}</td>
            <td style="text-align:right">${fmt(totalCredit)}</td>
            <td style="text-align:right;color:#15803d">${totalDebit > totalCredit ? fmt(totalDebit - totalCredit) : ''}</td>
            <td style="text-align:right;color:#dc2626">${totalCredit > totalDebit ? fmt(totalCredit - totalDebit) : ''}</td>
            </tr></tfoot></table></body></html>`
          setPreviewHtml(html)
        }}>📄 PDF</button>
      </div>

      <div className="card overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-left font-medium text-gray-600 w-24">Code</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-left font-medium text-gray-600">Intitulé</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-right font-medium text-gray-600">Total Débit</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-right font-medium text-gray-600">Total Crédit</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-right font-medium text-gray-600">Solde Débiteur</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-right font-medium text-gray-600">Solde Créditeur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16"></div></td>
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-40"></div></td>
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 ml-auto"></div></td>
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 ml-auto"></div></td>
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 ml-auto"></div></td>
                  <td className="px-4 py-2"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 ml-auto"></div></td>
                </tr>
              ))
            )}
            {rows.map(r => {
              const solde = r.total_debit - r.total_credit
              return (
                <tr key={r.code} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-2 font-mono text-xs font-bold text-primary">{r.code}</td>
                  <td className="px-4 py-2">
                    <div>{r.name}</div>
                    <div className="text-xs text-gray-400">{CLASS_LABELS[r.class]}</div>
                  </td>
                  <td className="px-4 py-2 text-right">{fmt(r.total_debit)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.total_credit)}</td>
                  <td className="px-4 py-2 text-right font-medium text-green-700">{solde > 0 ? fmt(solde) : ''}</td>
                  <td className="px-4 py-2 text-right font-medium text-red-600">{solde < 0 ? fmt(Math.abs(solde)) : ''}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-primary/5 font-bold border-t-2 border-primary/20 sticky bottom-0 z-10">
            <tr>
              <td colSpan={2} className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">TOTAUX</td>
              <td className="px-4 py-3 text-right text-green-700">{fmt(totalDebit)}</td>
              <td className="px-4 py-3 text-right text-red-600">{fmt(totalCredit)}</td>
              <td className="px-4 py-3 text-right text-green-700">
                {totalDebit > totalCredit ? fmt(totalDebit - totalCredit) : ''}
              </td>
              <td className="px-4 py-3 text-right text-red-600">
                {totalCredit > totalDebit ? fmt(totalCredit - totalDebit) : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {previewHtml && (
        <PrintPreviewModal
          html={previewHtml}
          title="Balance Comptable"
          filename={`Balance-${startDate}-${endDate}.pdf`}
          onClose={() => setPreviewHtml(null)}
        />
      )}
    </div>
  )
}
