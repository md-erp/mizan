import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { fmtFileSize } from '../../lib/format'

export default function BackupSettings() {
  const [backups, setBackups]     = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [creating, setCreating]   = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmImport, setConfirmImport] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)

  useEffect(() => { loadBackups() }, [])
  useEffect(() => {
    const h = () => loadBackups()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  async function loadBackups() {
    setLoading(true)
    try { setBackups(await api.listBackups() as any[]) }
    finally { setLoading(false) }
  }

  async function handleCreate() {
    setCreating(true)
    try {
      await api.createBackup()
      toast('Sauvegarde créée')
      loadBackups()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleExportFull() {
    setExporting(true)
    try {
      const result = await api.exportFull() as any
      if (!result?.canceled) toast('Export complet réussi ✓')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleImportFull() {
    setImporting(true)
    try {
      const result = await api.importFull() as any
      if (!result?.canceled) {
        toast('Import réussi — Redémarrez l\'application pour appliquer les changements', 'warning')
      }
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setImporting(false)
      setConfirmImport(false)
    }
  }

  async function handleRestore(path: string) {
    try {
      await api.restoreBackup(path)
      toast('Restauration effectuée — Redémarrez l\'application', 'warning')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setRestoreTarget(null)
    }
  }

  const fmtSize = fmtFileSize

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold">Sauvegarde & Restauration</h2>

      {/* ── Export / Import complet ── */}
      <div className="card p-5">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          📦 Sauvegarde complète
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Exporte toutes les données (base de données + pièces jointes) dans un seul fichier ZIP.
          Idéal pour migrer vers un autre poste ou archiver.
        </p>
        <div className="flex gap-3">
          <button onClick={handleExportFull} disabled={exporting}
            className="btn-primary gap-2">
            {exporting ? 'Export...' : '⬇️ Exporter tout'}
          </button>
          <button onClick={() => setConfirmImport(true)} disabled={importing}
            className="btn-secondary gap-2 text-orange-600 border-orange-200 hover:bg-orange-50 dark:hover:bg-orange-900/20">
            {importing ? 'Import...' : '⬆️ Importer depuis fichier'}
          </button>
        </div>
      </div>

      {/* ── Sauvegarde rapide ── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-0.5">
              💾 Sauvegardes rapides (base de données)
            </div>
            <p className="text-xs text-gray-400">Les 30 dernières sont conservées automatiquement.</p>
          </div>
          <button onClick={handleCreate} disabled={creating} className="btn-primary btn-sm">
            {creating ? '...' : '+ Sauvegarder'}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Fichier</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Taille</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400 text-xs">Chargement...</td></tr>
              )}
              {!loading && backups.length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400 text-xs">Aucune sauvegarde</td></tr>
              )}
              {backups.map((b, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{b.name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(b.date).toLocaleString('fr-FR')}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-400">{fmtSize(b.size)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setRestoreTarget(b.path)}
                      className="text-xs text-orange-500 hover:text-orange-700 font-medium">
                      Restaurer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm import complet */}
      <ConfirmDialog
        open={confirmImport}
        title="Importer une sauvegarde complète"
        message="⚠️ Cette action remplacera toutes les données actuelles (base de données et pièces jointes). Une sauvegarde de sécurité sera créée automatiquement avant l'import."
        confirmLabel="Choisir le fichier et importer"
        danger
        onConfirm={handleImportFull}
        onCancel={() => setConfirmImport(false)}
      />

      {/* Confirm restore rapide */}
      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restaurer cette sauvegarde ?"
        message="Les données actuelles seront remplacées. Une sauvegarde de sécurité sera créée automatiquement."
        confirmLabel="Restaurer"
        danger
        onConfirm={() => restoreTarget && handleRestore(restoreTarget)}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  )
}
