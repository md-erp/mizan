import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface TvaRate {
  id: number
  rate: number
  label: string
  is_active: boolean
}

export default function TvaSettings() {
  const [rates, setRates] = useState<TvaRate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(api as any).getTvaRates()
      .then((r: TvaRate[]) => setRates(r ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-6">Taux de TVA</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Taux</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Libellé</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                <td className="px-4 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12"></div></td>
                <td className="px-4 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div></td>
                <td className="px-4 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16 mx-auto"></div></td>
              </tr>
            ))}
            {!loading && rates.map(r => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-bold text-primary">{r.rate}%</td>
                <td className="px-4 py-3">{r.label}</td>
                <td className="px-4 py-3 text-center">
                  <span className={r.is_active ? 'badge-green' : 'badge-gray'}>
                    {r.is_active ? '✓ Actif' : '✗ Inactif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3">
        Taux conformes au Code Général des Impôts marocain (CGI) — Art. 98 à 100.
      </p>
    </div>
  )
}
