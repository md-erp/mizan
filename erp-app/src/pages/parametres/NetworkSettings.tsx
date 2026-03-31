import { useState } from 'react'
import { useAppStore } from '../../store/app.store'

export default function NetworkSettings() {
  const { config } = useAppStore()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function testConnection() {
    if (!config?.server_ip || !config?.server_port) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`http://${config.server_ip}:${config.server_port}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        setTestResult({ ok: true, message: `✅ Connecté — serveur actif depuis ${data.timestamp ?? ''}` })
      } else {
        setTestResult({ ok: false, message: `❌ Serveur répond avec erreur ${res.status}` })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: `❌ Connexion impossible — ${e.message}` })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold mb-6">Configuration réseau</h2>
      <div className="card p-5 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Mode de fonctionnement</span>
          <span className={`badge ${config?.mode === 'standalone' ? 'badge-green' : 'badge-blue'}`}>
            {config?.mode === 'standalone' ? '🖥️ Poste unique' :
             config?.mode === 'master'     ? '🌐 Serveur réseau' : '💻 Client réseau'}
          </span>
        </div>
        {config?.mode !== 'standalone' && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Serveur</span>
              <span className="font-mono text-sm">{config?.server_ip}:{config?.server_port}</span>
            </div>
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={testConnection}
                disabled={testing}
                className="btn-secondary btn-sm w-full justify-center">
                {testing ? '⏳ Test en cours...' : '🔌 Tester la connexion'}
              </button>
              {testResult && (
                <div className={`mt-2 text-sm px-3 py-2 rounded-lg ${
                  testResult.ok
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                }`}>
                  {testResult.message}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        Pour modifier le mode réseau, relancez le wizard de configuration depuis les paramètres avancés.
      </p>
    </div>
  )
}
