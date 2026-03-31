import { handle } from './index'
import { getDb } from '../database/connection'
import { getAuditLog } from '../services/audit.service'

export function registerAuditHandlers(): void {
  handle('audit:getLog', (filters?: any) => {
    const db = getDb()
    return getAuditLog(db, filters ?? {})
  })

  handle('audit:getUsers', () => {
    const db = getDb()
    return db.prepare('SELECT id, name FROM users ORDER BY name ASC').all()
  })
}
