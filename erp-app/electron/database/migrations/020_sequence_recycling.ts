import Database from 'better-sqlite3'

/**
 * Migration 020 — إضافة recycled_seqs لجدول document_sequences
 * يحفظ أرقام المسودات المحذوفة لإعادة استخدامها
 */
export function migration_020_sequence_recycling(db: Database.Database): void {
  db.exec(`
    ALTER TABLE document_sequences ADD COLUMN recycled_seqs TEXT DEFAULT '[]';
  `)
}
