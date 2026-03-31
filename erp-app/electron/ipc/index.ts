import { ipcMain } from 'electron'
import { registerConfigHandlers }    from './config.handler'
import { registerAuthHandlers }      from './auth.handler'
import { registerClientHandlers }    from './clients.handler'
import { registerSupplierHandlers }  from './suppliers.handler'
import { registerProductHandlers }   from './products.handler'
import { registerStockHandlers }     from './stock.handler'
import { registerDocumentHandlers }  from './documents.handler'
import { registerPaymentHandlers }   from './payments.handler'
import { registerAccountingHandlers }from './accounting.handler'
import { registerReportHandlers }    from './reports.handler'
import { registerBackupHandlers }    from './backup.handler'
import { registerProductionHandlers }from './production.handler'
import { registerNotificationsHandlers } from './notifications.handler'
import { registerPdfHandlers }           from './pdf.handler'
import { registerExcelHandlers }         from './excel.handler'
import { registerSettingsHandlers }      from './settings.handler'
import { registerImportHandlers }        from './import.handler'
import { registerAttachmentsHandlers }   from './attachments.handler'
import { registerAuditHandlers }         from './audit.handler'

export function registerAllHandlers(): void {
  registerConfigHandlers()
  registerAuthHandlers()
  registerClientHandlers()
  registerSupplierHandlers()
  registerProductHandlers()
  registerStockHandlers()
  registerDocumentHandlers()
  registerPaymentHandlers()
  registerAccountingHandlers()
  registerReportHandlers()
  registerBackupHandlers()
  registerProductionHandlers()
  registerNotificationsHandlers()
  registerPdfHandlers()
  registerExcelHandlers()
  registerSettingsHandlers()
  registerImportHandlers()
  registerAttachmentsHandlers()
  registerAuditHandlers()
}

// Helper: wrapper موحد لكل handler
export function handle(
  channel: string,
  fn: (...args: any[]) => unknown
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args)
      return { success: true, data: result }
    } catch (err: any) {
      console.error(`[IPC Error] ${channel}:`, err.message)
      return { success: false, error: err.message ?? 'Erreur inconnue' }
    }
  })
}
