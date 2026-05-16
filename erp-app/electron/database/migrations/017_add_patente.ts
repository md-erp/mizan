import Database from 'better-sqlite3'

export function migration_017_add_patente(db: Database.Database): void {
  // التحقق من وجود العمود قبل إضافته
  const pragmaResult = db.pragma('table_info(device_config)') as Array<{ name: string }>
  const columns = pragmaResult.map((col) => col.name)
  
  if (!columns.includes('company_patente')) {
    db.exec(`ALTER TABLE device_config ADD COLUMN company_patente TEXT DEFAULT ''`)
    console.log('[Migration 017] Added company_patente column')
  }
}
