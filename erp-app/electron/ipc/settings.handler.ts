import { handle } from './index'
import { getDb } from '../database/connection'
import { checkLocalUpdate, installLocalUpdate } from '../services/updater.service'
import { dialog } from 'electron'

export function registerSettingsHandlers(): void {
  handle('settings:get', (key?: string) => {
    const db = getDb()
    if (key) {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any
      return row?.value ?? null
    }
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as any[]
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })

  handle('settings:set', ({ key, value }: { key: string; value: string }) => {
    const PROTECTED_KEYS = ['api_key']
    if (PROTECTED_KEYS.includes(key)) {
      throw new Error('Action non autorisée: modification des clés système restreintes.');
    }
    const db = getDb()
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `).run(key, value, value)
    return { success: true }
  })

  handle('settings:setMany', (settings: Record<string, string>) => {
    const PROTECTED_KEYS = ['api_key']
    const db = getDb()
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        if (PROTECTED_KEYS.includes(key)) continue // Ignore silently protected keys
        db.prepare(`
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `).run(key, value, value)
      }
    })
    tx()
    return { success: true }
  })

  // تحديث محلي مباشر
  handle('update:selectLocalFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le fichier de mise à jour',
      filters: [
        { name: 'Installateurs', extensions: ['exe', 'msi', 'dmg', 'appimage'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Aucun fichier sélectionné' }
    }

    const filePath = result.filePaths[0]
    const checkResult = checkLocalUpdate(filePath)
    
    if (!checkResult.success) {
      return checkResult
    }

    return { success: true, filePath, version: checkResult.version, fileSize: checkResult.fileSize }
  })

  handle('update:installLocal', ({ filePath }: { filePath: string }) => {
    return installLocalUpdate(filePath)
  })

  // ── Document Sequences ──────────────────────────────────────────────────
  handle('sequences:getAll', () => {
    const db = getDb()
    const year = new Date().getFullYear() % 100
    const rows = db.prepare(`
      SELECT doc_type, year, last_seq
      FROM document_sequences
      ORDER BY doc_type, year DESC
    `).all() as any[]
    return rows
  })

  handle('sequences:set', ({ doc_type, year, last_seq }: { doc_type: string; year: number; last_seq: number }) => {
    const db = getDb()
    if (last_seq < 0) throw new Error('Le numéro de séquence doit être positif')
    db.prepare(`
      INSERT INTO document_sequences (doc_type, year, last_seq)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_type, year) DO UPDATE SET last_seq = ?
    `).run(doc_type, year, last_seq, last_seq)
    return { success: true }
  })

  handle('sequences:check', ({ doc_type, seq }: { doc_type: string; seq: number }) => {
    const db = getDb()

    if (doc_type === 'payment') {
      const year = new Date().getFullYear() % 100
      const padded = `P-${year}-${seq}`
      const plain  = `P-${seq}`
      const oldPadded = `P-${String(seq).padStart(4, '0')}`
      const exists = db.prepare(
        'SELECT id FROM payments WHERE reference = ? OR reference = ? OR reference = ?'
      ).get(padded, plain, oldPadded) as any
      if (exists) {
        let suggestion = seq + 1
        const allRefs = db.prepare("SELECT reference FROM payments WHERE reference LIKE 'P-%'").all() as any[]
        const usedSet = new Set(allRefs.map((r: any) => {
          const parts = (r.reference as string).split('-')
          return parseInt(parts[parts.length - 1] ?? '0', 10)
        }).filter((n: number) => !isNaN(n)))
        while (usedSet.has(suggestion)) suggestion++
        return { available: false, suggestion }
      }
      return { available: true }
    }

    // مستندات
    const prefix: Record<string, string> = {
      invoice: 'F', quote: 'D', bl: 'BL', proforma: 'PRO', avoir: 'AV',
      purchase_order: 'BC', bl_reception: 'BR', purchase_invoice: 'FF', import_invoice: 'IMP',
    }
    const p = prefix[doc_type] ?? 'DOC'
    const year = new Date().getFullYear() % 100
    const candidate = `${p}-${year}-${seq}`
    const exists = db.prepare(
      'SELECT id FROM documents WHERE number = ? AND is_deleted = 0'
    ).get(candidate) as any
    if (exists) {
      let suggestion = seq + 1
      while (true) {
        const c = `${p}-${year}-${suggestion}`
        const e = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(c) as any
        if (!e) break
        suggestion++
      }
      return { available: false, suggestion }
    }
    return { available: true }
  })

  handle('sequences:getNext', ({ doc_type }: { doc_type: string }) => {
    const db = getDb()

    // المدفوعات — بصيغة P-YY-XXXX
    if (doc_type === 'payment') {
      const allRefs = db.prepare(
        "SELECT reference FROM payments WHERE reference LIKE 'P-%'"
      ).all() as any[]

      let maxSeq = 0
      for (const row of allRefs) {
        const parts = (row.reference as string).split('-')
        const num = parseInt(parts[parts.length - 1] ?? '0', 10)
        if (!isNaN(num) && num > maxSeq) maxSeq = num
      }

      let next = maxSeq + 1
      const usedSet = new Set(
        allRefs.map((r: any) => {
          const parts = (r.reference as string).split('-')
          return parseInt(parts[parts.length - 1] ?? '0', 10)
        }).filter((n: number) => !isNaN(n))
      )
      while (usedSet.has(next)) next++

      const year = new Date().getFullYear() % 100
      return { next, year }
    }

    // المستندات — نجد أصغر رقم متاح >= last_seq+1
    const year = new Date().getFullYear() % 100
    const prefix: Record<string, string> = {
      invoice: 'F', quote: 'D', bl: 'BL', proforma: 'PRO', avoir: 'AV',
      purchase_order: 'BC', bl_reception: 'BR', purchase_invoice: 'FF', import_invoice: 'IMP',
    }
    const p = prefix[doc_type] ?? 'DOC'

    const row = db.prepare(
      'SELECT last_seq FROM document_sequences WHERE doc_type = ? AND year = ?'
    ).get(doc_type, year) as any
    let next = (row?.last_seq ?? 0) + 1

    // نتحقق أن الرقم غير مستخدم فعلاً
    while (true) {
      const candidate = `${p}-${year}-${next}`
      const exists = db.prepare(
        'SELECT id FROM documents WHERE number = ? AND is_deleted = 0'
      ).get(candidate) as any
      if (!exists) break
      next++
    }

    return { next, year }
  })
}
