import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { toast } from './ui/Toast'
import { fmtFileSize } from '../lib/format'

interface Attachment {
  name: string
  originalName: string
  path: string
  size: number
  ext: string
  date: Date
}

interface Props {
  entityType: 'document' | 'client' | 'supplier' | 'payment'
  entityId: number
}

const EXT_ICONS: Record<string, string> = {
  pdf: '📄', jpg: '🖼️', jpeg: '🖼️', png: '🖼️',
  xlsx: '📊', xls: '📊', doc: '📝', docx: '📝',
}

export default function AttachmentsPanel({ entityType, entityId }: Props) {
  const [files, setFiles] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await api.attachmentsList({ entityType, entityId }) as Attachment[]
      setFiles(result ?? [])
    } catch { /* silencieux */ }
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    setLoading(true)
    try {
      const added = await api.attachmentsAdd({ entityType, entityId }) as string[]
      if (added && added.length > 0) {
        toast(`${added.length} fichier(s) joint(s)`)
        load()
      }
    } catch (e: any) { toast(e.message, 'error') }
    finally { setLoading(false) }
  }

  async function handleOpen(path: string) {
    try { await api.attachmentsOpen(path) }
    catch (e: any) { toast(e.message, 'error') }
  }

  async function handleDelete(path: string, name: string) {
    if (!confirm(`Supprimer "${name}" ?`)) return
    try {
      await api.attachmentsDelete(path)
      toast('Fichier supprimé', 'warning')
      load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const fmtSize = fmtFileSize

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Pièces jointes {files.length > 0 && `(${files.length})`}
        </span>
        <button onClick={handleAdd} disabled={loading}
          className="btn-secondary btn-sm text-xs">
          {loading ? '...' : '📎 Joindre'}
        </button>
      </div>

      {files.length === 0 ? (
        <div className="text-xs text-gray-400 py-2 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          Aucune pièce jointe
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg group">
              <span className="text-base">{EXT_ICONS[f.ext] ?? '📎'}</span>
              <div className="flex-1 min-w-0">
                <button onClick={() => handleOpen(f.path)}
                  className="text-xs font-medium text-primary hover:underline truncate block text-left w-full">
                  {f.originalName}
                </button>
                <div className="text-xs text-gray-400">{fmtSize(f.size)}</div>
              </div>
              <button onClick={() => handleDelete(f.path, f.originalName)}
                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
