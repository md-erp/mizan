import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api'

interface Notification {
  id: string
  type: 'cheque' | 'stock' | 'invoice'
  severity: 'error' | 'warning' | 'info'
  title: string
  message: string
  date: string
  ref_id: number
}

const ICONS = { cheque: '🏦', stock: '📦', invoice: '📄' }

const SEVERITY_COLORS = {
  error:   'border-l-red-500 bg-red-50 dark:bg-red-900/10',
  warning: 'border-l-orange-400 bg-orange-50 dark:bg-orange-900/10',
  info:    'border-l-blue-400 bg-blue-50 dark:bg-blue-900/10',
}

export default function NotificationCenter() {
  const [open, setOpen]                   = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [dismissed, setDismissed]         = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function loadNotifications() {
    try {
      const result = await api.getNotifications() as Notification[]
      setNotifications(result ?? [])
    } catch { /* silencieux */ }
  }

  function dismiss(id: string) {
    setDismissed(prev => new Set([...prev, id]))
    api.markNotificationRead(id as any).catch(() => {})
  }

  function dismissAll() {
    const ids = new Set(visible.map(n => n.id))
    setDismissed(prev => new Set([...prev, ...ids]))
  }

  const visible      = notifications.filter(n => !dismissed.has(n.id))
  const errorCount   = visible.filter(n => n.severity === 'error').length
  const warningCount = visible.filter(n => n.severity === 'warning').length
  const totalCount   = visible.length
  const badgeColor   = errorCount > 0 ? 'bg-red-500' : warningCount > 0 ? 'bg-orange-400' : 'bg-blue-500'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 text-primary-100 transition-colors"
      >
        🔔
        {totalCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${badgeColor}`}>
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="font-semibold text-sm">Notifications</span>
            <div className="flex items-center gap-2">
              {totalCount > 0 && (
                <>
                  <span className="text-xs text-gray-400">{totalCount} alerte(s)</span>
                  <button onClick={dismissAll}
                    className="text-xs text-primary hover:underline">
                    Tout effacer
                  </button>
                </>
              )}
              <button onClick={loadNotifications} className="text-gray-400 hover:text-primary text-xs" title="Actualiser">↻</button>
            </div>
          </div>

          {/* Liste */}
          <div className="max-h-96 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-sm">Aucune alerte</div>
              </div>
            ) : (
              visible.map(n => (
                <div key={n.id}
                  className={`flex gap-3 px-4 py-3 border-l-4 border-b border-gray-50 dark:border-gray-700/50 ${SEVERITY_COLORS[n.severity]}`}>
                  <span className="text-lg shrink-0 mt-0.5">{ICONS[n.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">{n.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</div>
                  </div>
                  <button onClick={() => dismiss(n.id)}
                    className="text-gray-300 hover:text-gray-500 text-lg leading-none shrink-0 mt-0.5"
                    title="Ignorer">×</button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {visible.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-center">
              <span className="text-xs text-gray-400">
                {errorCount > 0 && <span className="text-red-500 font-medium">{errorCount} critique(s) </span>}
                {warningCount > 0 && <span className="text-orange-500 font-medium">{warningCount} avertissement(s)</span>}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
