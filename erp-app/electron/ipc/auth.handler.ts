import crypto from 'crypto'
import { handle } from './index'
import { getDb } from '../database/connection'
import { logAudit } from '../services/audit.service'

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

export function registerAuthHandlers(): void {
  handle('auth:login', ({ email, password }) => {
    const db = getDb()
    if (!email?.trim() || !password?.trim()) {
      throw new Error('Email et mot de passe requis')
    }
    const user = db.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = 1'
    ).get(email.trim().toLowerCase()) as any

    if (!user) throw new Error('Aucun compte trouvé avec cet email')
    if (user.password_hash !== hashPassword(password)) throw new Error('Mot de passe incorrect')

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)
    logAudit(db, { user_id: user.id, action: 'LOGIN', table_name: 'users', record_id: user.id })

    const { password_hash, ...safeUser } = user
    return safeUser
  })

  handle('users:getAll', () => {
    const db = getDb()
    return db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users').all()
  })

  handle('users:create', ({ name, email, password, role }) => {
    const db = getDb()
    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      throw new Error('Nom, email et mot de passe sont obligatoires')
    }
    if (password.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caractères')
    }
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role ?? 'sales')
    logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'users', record_id: result.lastInsertRowid as number, new_values: { name, email, role } })
    return { id: result.lastInsertRowid }
  })

  handle('users:update', ({ id, name, email, role, is_active, password }) => {
    const db = getDb()
    if (password) {
      db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(name, email, role, is_active, hashPassword(password), id)
    } else {
      db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(name, email, role, is_active, id)
    }
    return { success: true }
  })

  handle('users:delete', (id) => {
    const db = getDb()
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id)
    logAudit(db, { user_id: 1, action: 'DELETE', table_name: 'users', record_id: id })
    return { success: true }
  })

  handle('auth:logout', () => ({ success: true }))
}
