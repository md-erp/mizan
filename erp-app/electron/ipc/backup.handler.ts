import { handle } from './index'
import { app, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { copyFileSync, readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import AdmZip from 'adm-zip'
import { closeDatabase, initDatabase, getDb } from '../database/connection'

export function registerBackupHandlers(): void {
  handle('backup:create', () => {
    const userData = app.getPath('userData')
    const backupDir = join(userData, 'backups')
    mkdirSync(backupDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(backupDir, `erp-backup-${timestamp}.db`)

    // استخدام VACUUM INTO لدمج WAL وإنشاء نسخة نظيفة ومكتملة
    getDb().exec(`VACUUM INTO '${backupPath}'`)

    // الاحتفاظ بآخر 30 نسخة فقط
    const backups = readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, time: statSync(join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)

    if (backups.length > 30) {
      backups.slice(30).forEach(b => unlinkSync(join(backupDir, b.name)))
    }

    return { path: backupPath, timestamp }
  })

  handle('backup:list', () => {
    const backupDir = join(app.getPath('userData'), 'backups')
    try {
      return readdirSync(backupDir)
        .filter(f => f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: join(backupDir, f),
          size: statSync(join(backupDir, f)).size,
          date: statSync(join(backupDir, f)).mtime,
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
    } catch {
      return []
    }
  })

  handle('backup:restore', (backupPath: string) => {
    const userData = app.getPath('userData')
    const dbPath = join(userData, 'erp.db')
    const safetyPath = join(userData, `erp-before-restore-${Date.now()}.db`)
    copyFileSync(dbPath, safetyPath)
    copyFileSync(backupPath, dbPath)

    // إغلاق الاتصال القديم وإعادة تهيئة قاعدة البيانات المستعادة
    closeDatabase()
    initDatabase()

    // إعادة تحميل النافذة
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.reload()

    return { success: true, safetyBackup: safetyPath }
  })

  // ── Export complet (DB + pièces jointes) → ZIP ──────────────────────────
  handle('backup:exportFull', async () => {
    const userData = app.getPath('userData')

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Exporter la sauvegarde complète',
      defaultPath: `erp-export-${new Date().toISOString().slice(0,10)}.zip`,
      filters: [{ name: 'Archive ERP', extensions: ['zip'] }],
    })
    if (canceled || !filePath) return { canceled: true }

    const zip = new AdmZip()

    // 1. Base de données — استخدام VACUUM INTO لدمج WAL وضمان نسخة مكتملة
    const dbPath = join(userData, 'erp.db')
    if (existsSync(dbPath)) {
      const tmpDb = join(userData, `erp-export-tmp-${Date.now()}.db`)
      getDb().exec(`VACUUM INTO '${tmpDb}'`)
      zip.addLocalFile(tmpDb, '', 'erp.db')
      unlinkSync(tmpDb)
    }

    // 2. Pièces jointes
    const attachDir = join(userData, 'attachments')
    if (existsSync(attachDir)) zip.addLocalFolder(attachDir, 'attachments')

    // 3. Métadonnées
    const meta = JSON.stringify({
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      platform: process.platform,
    })
    zip.addFile('meta.json', Buffer.from(meta, 'utf8'))

    zip.writeZip(filePath)
    return { success: true, path: filePath }
  })

  // ── Import complet depuis ZIP ────────────────────────────────────────────
  handle('backup:importFull', async () => {
    const userData = app.getPath('userData')

    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Importer une sauvegarde complète',
      filters: [{ name: 'Archive ERP', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return { canceled: true }

    const zip = new AdmZip(filePaths[0])
    const entries = zip.getEntries().map(e => e.entryName)

    // Vérifier que c'est bien une archive ERP
    if (!entries.includes('erp.db')) {
      throw new Error('Fichier invalide — ce n\'est pas une archive ERP valide')
    }

    // Sauvegarde de sécurité avant import
    const dbPath = join(userData, 'erp.db')
    if (existsSync(dbPath)) {
      const safetyDir = join(userData, 'backups')
      mkdirSync(safetyDir, { recursive: true })
      copyFileSync(dbPath, join(safetyDir, `erp-before-import-${Date.now()}.db`))
    }

    // Extraire la DB
    zip.extractEntryTo('erp.db', userData, false, true)

    // Extraire les pièces jointes si présentes
    const attachEntries = entries.filter(e => e.startsWith('attachments/'))
    if (attachEntries.length > 0) {
      zip.extractEntryTo('attachments/', userData, false, true)
    }

    // إغلاق الاتصال القديم وإعادة تهيئة قاعدة البيانات الجديدة
    closeDatabase()
    initDatabase()

    // إعادة تحميل النافذة لتطبيق البيانات الجديدة
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.reload()

    return { success: true }
  })
}
