import { handle } from './index'
import { getDb } from '../database/connection'
import { createDocument, confirmDocument, smartEditDocument, recycleDocumentNumber, getNextRecycledNumber } from '../services/document.service'
import { deleteAccountingEntriesForCancelledDocument, checkPeriodOpen, createAccountingEntry } from '../services/accounting.service'
import { logAudit } from '../services/audit.service'

export function registerDocumentHandlers(): void {
  handle('documents:getAll', (filters?: {
    type?: string; status?: string; party_id?: number;
    search?: string; page?: number; limit?: number
  }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit
    const params: any[] = []

    let query = `
      SELECT d.*,
        CASE d.party_type
          WHEN 'client'   THEN c.name
          WHEN 'supplier' THEN s.name
        END as party_name,
        (SELECT COUNT(*) FROM stock_movements sm WHERE sm.document_id = d.id AND sm.applied = 0) as pending_stock_count,
        COALESCE(di.due_date, dpi.due_date) as due_date,
        COALESCE(di.payment_status, dpi.payment_status, dii.payment_status) as payment_status
      FROM documents d
      LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
      LEFT JOIN doc_invoices di ON di.document_id = d.id AND d.type = 'invoice'
      LEFT JOIN doc_purchase_invoices dpi ON dpi.document_id = d.id AND d.type = 'purchase_invoice'
      LEFT JOIN doc_import_invoices dii ON dii.document_id = d.id AND d.type = 'import_invoice'
      WHERE d.is_deleted = 0
    `

    if (filters?.type) { query += ' AND d.type = ?'; params.push(filters.type) }
    if (filters?.status) { query += ' AND d.status = ?'; params.push(filters.status) }
    if (filters?.party_id) { query += ' AND d.party_id = ?'; params.push(filters.party_id) }
    if (filters?.search) {
      query += ' AND (d.number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s, s)
    }

    query += ' ORDER BY d.date DESC, d.id DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    // COUNT مع نفس الفلاتر
    let countQuery = `SELECT COUNT(*) as c FROM documents d WHERE d.is_deleted = 0`
    const countParams: any[] = []
    if (filters?.type)    { countQuery += ' AND d.type = ?';    countParams.push(filters.type) }
    if (filters?.status)  { countQuery += ' AND d.status = ?';  countParams.push(filters.status) }
    if (filters?.party_id){ countQuery += ' AND d.party_id = ?';countParams.push(filters.party_id) }
    const total = (db.prepare(countQuery).get(...countParams) as any).c
    return { rows, total, page, limit }
  })

  handle('documents:getOne', (id: number) => {
    const db = getDb()
    const doc = db.prepare(`
      SELECT d.*,
        CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
        di.due_date,
        di.payment_status,
        di.payment_method,
        di.currency,
        di.exchange_rate,
        di.global_discount        as inv_global_discount,
        dq.global_discount        as quote_global_discount,
        dbl.global_discount       as bl_global_discount,
        dp.global_discount        as proforma_global_discount,
        dav.global_discount       as avoir_global_discount,
        dpi.global_discount       as pi_global_discount,
        imp.currency              as imp_currency,
        imp.exchange_rate         as imp_exchange_rate,
        imp.invoice_amount,
        imp.customs,
        imp.transitaire,
        imp.tva_import,
        imp.other_costs,
        imp.total_cost
      FROM documents d
      LEFT JOIN clients   c   ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s   ON s.id = d.party_id AND d.party_type = 'supplier'
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      LEFT JOIN doc_quotes dq ON dq.document_id = d.id
      LEFT JOIN doc_bons_livraison dbl ON dbl.document_id = d.id
      LEFT JOIN doc_proformas dp ON dp.document_id = d.id
      LEFT JOIN doc_avoirs dav ON dav.document_id = d.id
      LEFT JOIN doc_purchase_invoices dpi ON dpi.document_id = d.id
      LEFT JOIN doc_import_invoices imp ON imp.document_id = d.id
      WHERE d.id = ? AND d.is_deleted = 0
    `).get(id) as any
    if (!doc) throw new Error('Document introuvable')
    
    // ✅ Normalize global_discount based on document type
    doc.global_discount = 
      doc.inv_global_discount ?? 
      doc.quote_global_discount ?? 
      doc.bl_global_discount ?? 
      doc.proforma_global_discount ?? 
      doc.avoir_global_discount ?? 
      doc.pi_global_discount ?? 
      0
    
    // Clean up temporary fields
    delete doc.inv_global_discount
    delete doc.quote_global_discount
    delete doc.bl_global_discount
    delete doc.proforma_global_discount
    delete doc.avoir_global_discount
    delete doc.pi_global_discount
    
    // 🔍 DEBUG: تتبع global_discount المُحمّل
    console.log('📥 [documents:getOne] doc loaded:', {
      id: doc.id,
      type: doc.type,
      global_discount: doc.global_discount,
    })

    // Normalize import invoice extra fields
    if (doc.type === 'import_invoice') {
      doc.currency       = doc.imp_currency       ?? doc.currency       ?? 'EUR'
      doc.exchange_rate  = doc.imp_exchange_rate  ?? doc.exchange_rate  ?? 1
    }
    delete doc.imp_currency
    delete doc.imp_exchange_rate

    const lines = db.prepare(`
      SELECT dl.*, p.name as product_name, p.code as product_code, p.unit
      FROM document_lines dl
      LEFT JOIN products p ON p.id = dl.product_id
      WHERE dl.document_id = ?
    `).all(id)

    const links = db.prepare(`
      SELECT dl.*, d.number as related_number, d.type as related_type, d.status as related_status
      FROM document_links dl
      JOIN documents d ON d.id = CASE WHEN dl.parent_id = ? THEN dl.child_id ELSE dl.parent_id END
      WHERE dl.parent_id = ? OR dl.child_id = ?
    `).all(id, id, id)

    const pendingMovements = db.prepare(`
      SELECT sm.*, p.name as product_name, p.unit, p.stock_quantity
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.document_id = ? AND sm.applied = 0
    `).all(id)

    return { ...doc, lines, links, pendingMovements }
  })

  handle('documents:create', (data) => {
    const result = createDocument(data)
    const db = getDb()
    logAudit(db, { user_id: data.created_by ?? 1, action: 'CREATE', table_name: 'documents', record_id: result.id, new_values: { type: data.type, number: result.number } })
    return result
  })

  handle('documents:confirm', (data: number | { id: number; userId?: number }) => {
    const id     = typeof data === 'number' ? data : data.id
    const userId = typeof data === 'number' ? 1    : (data.userId ?? 1)
    confirmDocument(id, userId)
    const db = getDb()
    const confirmedDoc = db.prepare('SELECT number, type FROM documents WHERE id = ?').get(id) as any
    logAudit(db, { user_id: userId, action: 'CONFIRM', table_name: 'documents', record_id: id, new_values: { number: confirmedDoc?.number, type: confirmedDoc?.type } })

    // Si c'est un BR, vérifier si le BC parent est entièrement reçu
    const confirmed = db.prepare('SELECT type FROM documents WHERE id = ?').get(id) as any
    if (confirmed?.type === 'bl_reception') {
      const poLink = db.prepare(`
        SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'
      `).get(id) as any
      if (poLink) {
        const poId = poLink.parent_id
        const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
        const brIds = (db.prepare(`
          SELECT dl.child_id as id FROM document_links dl
          JOIN documents d ON d.id = dl.child_id
          WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
        `).all(poId) as any[]).map((r: any) => r.id)

        const received: Record<string, number> = {}
        for (const brId of brIds) {
          const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
          for (const l of brLines) {
            const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
            received[key] = (received[key] ?? 0) + Number(l.quantity)
          }
        }
        const fullyReceived = poLines.every((l: any) => {
          const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
          return (received[key] ?? 0) >= Number(l.quantity)
        })
        if (fullyReceived) {
          db.prepare(`UPDATE documents SET status = 'received', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('confirmed','partial')`).run(poId)
        } else if (brIds.length > 0) {
          db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'`).run(poId)
        }
      }
    }

    return { success: true }
  })

  handle('documents:cancel', (id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')
    if (doc.status === 'cancelled') throw new Error('Document déjà annulé')
    if (doc.status === 'paid') throw new Error('Impossible d\'annuler un document payé')

    // ✅ المشكلة 3: التحقق من الفترة المحاسبية قبل أي تعديل
    checkPeriodOpen(db, doc.date)

    // Bloquer si mouvements de stock déjà appliqués
    const appliedMov = db.prepare(`SELECT COUNT(*) as c FROM stock_movements WHERE document_id = ? AND applied = 1`).get(id) as any
    if (appliedMov?.c > 0)
      throw new Error('Ce document a des mouvements de stock appliqués. Créez un document de retour pour annuler son effet.')

    // Si paiements liés confirmés → créer automatiquement un avoir d'annulation
    const linkedPay = db.prepare(`SELECT COUNT(*) as c FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.document_id = ? AND p.status = 'cleared'`).get(id) as any
    if (linkedPay?.c > 0) {
      const txAvoir = db.transaction(() => {
        const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(id) as any[]
        
        const avoirDoc = createDocument({
          type: 'avoir',
          date: new Date().toISOString().split('T')[0],
          party_id: doc.party_id,
          party_type: doc.party_type,
          lines: lines.map((l: any) => ({
            product_id: l.product_id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount: l.discount ?? 0,
            tva_rate: l.tva_rate,
          })),
          notes: `Avoir d'annulation automatique pour ${doc.number}`,
          extra: { 
            avoir_type: 'annulation', 
            affects_stock: false, 
            reason: `Annulation automatique du document ${doc.number}`,
            global_discount: 0 
          },
          created_by: 1,
        })

        db.prepare(`
          INSERT INTO document_links (parent_id, child_id, link_type, created_at)
          VALUES (?, ?, 'invoice_to_avoir', CURRENT_TIMESTAMP)
        `).run(id, avoirDoc.id)

        confirmDocument(avoirDoc.id, 1)

        return {
          success: true,
          message: `Document annulé avec succès. Un avoir d'annulation (${avoirDoc.number}) a été créé automatiquement pour inverser les écritures comptables et les paiements.`,
          avoirId: avoirDoc.id,
          avoirNumber: avoirDoc.number,
          cancelled: true
        }
      })
      return txAvoir()
    }

    // ✅ المشكلة 2: كل العملية في transaction واحدة — إلغاء + حذف القيود لا يتجزآن
    const tx = db.transaction(() => {
      // Annuler les mouvements de stock en attente liés à ce document
      db.prepare(`UPDATE stock_movements SET applied = -1 WHERE document_id = ? AND applied = 0`).run(id)

      // ✅ Si c'est un avoir → traiter selon le type
      if (doc.type === 'avoir') {
        const avoirData = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(id) as any
        
        // ═══════════════════════════════════════════════════════════════════
        // CAS 1: Avoir d'Annulation (Smart Edit)
        // ═══════════════════════════════════════════════════════════════════
        if (avoirData?.avoir_type === 'annulation') {
          // Trouver la facture originale annulée
          const link = db.prepare(`
            SELECT dl.parent_id, d.number as parent_number, d.type as parent_type
            FROM document_links dl
            JOIN documents d ON d.id = dl.parent_id
            WHERE dl.child_id = ? AND dl.link_type = 'smart_edit_avoir'
          `).get(id) as any
          
          if (link?.parent_id) {
            const originalDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(link.parent_id) as any
            
            // 1. Restaurer la facture originale à l'état "confirmed"
            db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id)
            
            // 2. Recréer les écritures comptables de la facture originale
            const originalLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(link.parent_id) as any[]
            createAccountingEntry(db, originalDoc, originalLines, 1)
            
            // 3. Trouver et supprimer la nouvelle facture draft créée par Smart Edit
            const newDraft = db.prepare(`
              SELECT dl2.child_id, d2.number
              FROM document_links dl2
              JOIN documents d2 ON d2.id = dl2.child_id
              WHERE dl2.parent_id = ? AND dl2.link_type = 'smart_edit_replacement'
            `).get(link.parent_id) as any
            
            if (newDraft?.child_id) {
              db.prepare('UPDATE documents SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newDraft.child_id)
              logAudit(db, {
                user_id: 1,
                action: 'DELETE',
                table_name: 'documents',
                record_id: newDraft.child_id,
                old_values: { number: newDraft.number, reason: 'Smart Edit annulé' },
              })
            }
            
            logAudit(db, {
              user_id: 1,
              action: 'RESTORE',
              table_name: 'documents',
              record_id: link.parent_id,
              new_values: { 
                status: 'confirmed', 
                reason: `Annulation de l'avoir ${doc.number} — restauration de ${link.parent_number}` 
              },
            })
          }
        }
        // ═══════════════════════════════════════════════════════════════════
        // CAS 2: Avoir Commercial/Retour
        // ═══════════════════════════════════════════════════════════════════
        else {
          const avoirPayments = db.prepare(`
            SELECT p.id, pa.document_id as invoice_id
            FROM payments p
            JOIN payment_allocations pa ON pa.payment_id = p.id
            WHERE p.method = 'avoir'
              AND p.document_id = ?
              AND p.status != 'cancelled'
          `).all(id) as any[]

          for (const ap of avoirPayments) {
            db.prepare(`UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ap.id)
            db.prepare(`DELETE FROM payment_allocations WHERE payment_id = ?`).run(ap.id)
            if (ap.invoice_id) {
              const invDoc = db.prepare('SELECT total_ttc, type, status FROM documents WHERE id = ?').get(ap.invoice_id) as any
              if (invDoc && invDoc.status !== 'cancelled') {
                const paid = (db.prepare(`
                  SELECT COALESCE(SUM(pa2.amount), 0) as total
                  FROM payment_allocations pa2
                  JOIN payments p2 ON p2.id = pa2.payment_id
                  WHERE pa2.document_id = ? AND p2.status != 'cancelled'
                `).get(ap.invoice_id) as any).total

                let newStatus = 'confirmed'
                if (paid >= invDoc.total_ttc - 0.005) newStatus = 'paid'
                else if (paid > 0) newStatus = 'partial'

                db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, ap.invoice_id)

                const subTable = invDoc.type === 'invoice' ? 'doc_invoices'
                  : invDoc.type === 'purchase_invoice' ? 'doc_purchase_invoices'
                  : invDoc.type === 'import_invoice' ? 'doc_import_invoices' : null
                if (subTable) {
                  const payStatus = newStatus === 'paid' ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
                  db.prepare(`UPDATE ${subTable} SET payment_status = ? WHERE document_id = ?`).run(payStatus, ap.invoice_id)
                }
              }
            }
          }
        }
      }

      // تحديث حالة المستند إلى ملغي
      db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)

      // ✅ إنشاء قيود عكسية (contre-passation) بدلاً من الحذف
      deleteAccountingEntriesForCancelledDocument(db, doc.type, id, doc.number, 1)

      logAudit(db, { user_id: 1, action: 'CANCEL', table_name: 'documents', record_id: id, old_values: { status: doc?.status, number: doc?.number, type: doc?.type } })

      // ✅ المشكلة 2: إعادة حساب حالة الفاتورة عند إلغاء BL
      if (doc.type === 'bl') {
        const invoiceLink = db.prepare(`
          SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%invoice%'
        `).get(id) as any
        if (invoiceLink) {
          const invId = invoiceLink.parent_id
          const invDoc = db.prepare(`SELECT status FROM documents WHERE id = ?`).get(invId) as any
          if (invDoc && !['cancelled', 'paid'].includes(invDoc.status)) {
            const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(invId) as any[]
            const blIds = (db.prepare(`
              SELECT dl.child_id as id FROM document_links dl
              JOIN documents d ON d.id = dl.child_id
              WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
            `).all(invId) as any[]).map((r: any) => r.id)

            if (blIds.length === 0) {
              // لا يوجد BL نشط → إعادة إلى confirmed
              db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invId)
            } else {
              // حساب الكميات المُسلَّمة
              const delivered: Record<string, number> = {}
              for (const blId of blIds) {
                const blLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId) as any[]
                for (const l of blLines) {
                  const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                  delivered[key] = (delivered[key] ?? 0) + Number(l.quantity)
                }
              }
              const fullyDelivered = invLines.every((l: any) => {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                return (delivered[key] ?? 0) >= Number(l.quantity)
              })
              db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
                fullyDelivered ? 'delivered' : 'partial', invId
              )
            }
          }
        }
      }

      // Si c'est un BR, recalculer la statut du BC parent
      if (doc.type === 'bl_reception') {
        const poLink = db.prepare(`SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'`).get(id) as any
        if (poLink) {
          const poId = poLink.parent_id
          const poDoc = db.prepare(`SELECT status FROM documents WHERE id = ?`).get(poId) as any
          if (poDoc && poDoc.status !== 'cancelled') {
            const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
            const brIds = (db.prepare(`
              SELECT dl.child_id as id FROM document_links dl
              JOIN documents d ON d.id = dl.child_id
              WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
            `).all(poId) as any[]).map((r: any) => r.id)

            if (brIds.length === 0) {
              db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(poId)
            } else {
              const received: Record<string, number> = {}
              for (const brId of brIds) {
                const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
                for (const l of brLines) {
                  const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                  received[key] = (received[key] ?? 0) + Number(l.quantity)
                }
              }
              const fullyReceived = poLines.every((l: any) => {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                return (received[key] ?? 0) >= Number(l.quantity)
              })
              db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
                fullyReceived ? 'received' : 'partial', poId
              )
            }
          }
        }
      }
    })

    tx()
    return { success: true }
  })


  // ── Analyse l'impact d'une annulation ───────────────────────────────────
  handle('documents:getCancelImpact', (id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')

    const impacts: { type: string; description: string; reversible: boolean; key: string }[] = []

    // 1. Mouvements de stock appliqués
    const appliedMovements = db.prepare(`
      SELECT sm.*, p.name as product_name, p.unit
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.document_id = ? AND sm.applied = 1
    `).all(id) as any[]
    if (appliedMovements.length > 0) {
      const details = appliedMovements.map((m: any) =>
        `${m.type === 'in' ? '+' : '-'}${m.quantity} ${m.unit} ${m.product_name}`
      ).join(', ')
      impacts.push({
        type: 'stock',
        description: `Mouvements de stock appliqués: ${details}`,
        reversible: true,
        key: 'reverse_stock',
      })
    }

    // 2. Écriture comptable
    try {
      const accounting = db.prepare(`SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ?`).get(doc.type, id) as any
      if (accounting) {
        impacts.push({
          type: 'accounting',
          description: 'Écriture comptable générée — une contre-passation sera créée',
          reversible: true,
          key: 'reverse_accounting',
        })
      }
    } catch (_) { /* table may not exist */ }

    // 3. Paiements liés
    const payments = db.prepare(`
      SELECT p.id, p.amount, p.method, p.status FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE pa.document_id = ? AND p.status != 'cancelled'
    `).all(id) as any[]
    if (payments.length > 0) {
      const total = payments.reduce((s: number, p: any) => s + p.amount, 0)
      impacts.push({
        type: 'payments',
        description: `${payments.length} paiement(s) lié(s) — total: ${total.toFixed(2)} MAD`,
        reversible: true,
        key: 'cancel_payments',
      })
    }

    // 4. Documents liés (BR, BL, etc.)
    const linkedDocs = db.prepare(`
      SELECT d.id, d.number, d.type, d.status FROM document_links dl
      JOIN documents d ON d.id = CASE WHEN dl.parent_id = ? THEN dl.child_id ELSE dl.parent_id END
      WHERE (dl.parent_id = ? OR dl.child_id = ?) AND d.status != 'cancelled'
    `).all(id, id, id) as any[]
    if (linkedDocs.length > 0) {
      const nums = linkedDocs.map((d: any) => d.number).join(', ')
      impacts.push({
        type: 'linked_docs',
        description: `Documents liés actifs: ${nums}`,
        reversible: false,
        key: 'info_linked',
      })
    }

    // 5. ✅ CAS SPÉCIAL: Avoir d'Annulation (Smart Edit)
    if (doc.type === 'avoir') {
      const avoirData = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(id) as any
      if (avoirData?.avoir_type === 'annulation') {
        // Trouver la facture originale et la nouvelle draft
        const originalLink = db.prepare(`
          SELECT dl.parent_id, d.number as parent_number, d.status as parent_status
          FROM document_links dl
          JOIN documents d ON d.id = dl.parent_id
          WHERE dl.child_id = ? AND dl.link_type = 'smart_edit_avoir'
        `).get(id) as any
        
        const newDraft = db.prepare(`
          SELECT dl2.child_id, d2.number as draft_number
          FROM document_links dl2
          JOIN documents d2 ON d2.id = dl2.child_id
          WHERE dl2.parent_id = ? AND dl2.link_type = 'smart_edit_replacement' AND d2.is_deleted = 0
        `).get(originalLink?.parent_id) as any
        
        if (originalLink) {
          impacts.push({
            type: 'smart_edit_reversal',
            description: `⚠️ SMART EDIT: Annuler cet avoir restaurera la facture originale ${originalLink.parent_number} (actuellement ${originalLink.parent_status === 'cancelled' ? 'annulée' : originalLink.parent_status})${newDraft ? ` et supprimera la nouvelle facture ${newDraft.draft_number}` : ''}`,
            reversible: true,
            key: 'reverse_smart_edit',
          })
        }
      }
    }

    return { impacts, docType: doc.type, docStatus: doc.status }
  })

  // ── Annulation avec options de reversement ───────────────────────────────
  handle('documents:cancelWithOptions', ({ id, options, userId, confirmPartial }: {
    id: number
    options: {
      reverse_stock?: boolean
      reverse_accounting?: boolean
      cancel_payments?: boolean
    }
    userId?: number
    // ✅ المشكلة 1: تأكيد صريح مطلوب لإلغاء وثيقة بها مدفوعات جزئية
    confirmPartial?: boolean
  }) => {
    const db = getDb()
    const effectiveUserId = userId ?? 1
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')
    if (doc.status === 'cancelled') throw new Error('Document déjà annulé')

    // ✅ المشكلة 1: منع إلغاء الوثيقة المدفوعة كاملاً — نفس الحماية الموجودة في documents:cancel
    if (doc.status === 'paid') {
      logAudit(db, {
        user_id: effectiveUserId,
        action: 'CANCEL',
        table_name: 'documents',
        record_id: id,
        old_values: { status: doc.status, number: doc.number, type: doc.type },
        reason: 'REFUS — tentative d\'annulation d\'un document entièrement payé',
      })
      throw new Error(
        `Impossible d'annuler le document ${doc.number} — il est entièrement payé. Créez un avoir pour régulariser.`
      )
    }

    // ✅ المشكلة 1: تحذير + تأكيد إضافي للوثيقة بها مدفوعات جزئية
    if (doc.status === 'partial') {
      const partialPaid = (db.prepare(`
        SELECT COALESCE(SUM(pa.amount), 0) as total
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE pa.document_id = ? AND p.status != 'cancelled'
      `).get(id) as any).total

      if (partialPaid > 0 && !confirmPartial) {
        // نسجّل محاولة الإلغاء في audit_log
        logAudit(db, {
          user_id: effectiveUserId,
          action: 'CANCEL',
          table_name: 'documents',
          record_id: id,
          old_values: { status: doc.status, number: doc.number, type: doc.type },
          reason: `AVERTISSEMENT — annulation document avec paiements partiels (${partialPaid.toFixed(2)} MAD) — confirmation requise`,
        })
        // نرجع خطأ خاص يحمل علامة requiresConfirmation ليعرف الـ frontend أنه يحتاج تأكيداً
        const err = new Error(
          `⚠️ Ce document a des paiements partiels enregistrés (${partialPaid.toFixed(2)} MAD). ` +
          `L'annulation créera un déséquilibre comptable. ` +
          `Relancez avec confirmPartial: true pour confirmer.`
        ) as any
        err.requiresConfirmation = true
        err.partialAmount = partialPaid
        throw err
      }

      if (partialPaid > 0 && confirmPartial) {
        // تسجيل الإلغاء المؤكد للوثيقة الجزئية
        logAudit(db, {
          user_id: effectiveUserId,
          action: 'CANCEL',
          table_name: 'documents',
          record_id: id,
          old_values: { status: doc.status, number: doc.number, type: doc.type },
          reason: `إلغاء وثيقة بها مدفوعات جزئية (${partialPaid.toFixed(2)} MAD) — تأكيد صريح من المستخدم`,
        })
      }
    }

    // ✅ المشكلة 3: التحقق من الفترة المحاسبية قبل أي تعديل
    checkPeriodOpen(db, doc.date)

    // ✅ المشكلة 2: كل العملية في transaction واحدة — إلغاء + حذف القيود لا يتجزآن
    const tx = db.transaction(() => {
      // 1. Annuler mouvements en attente
      db.prepare(`UPDATE stock_movements SET applied = -1 WHERE document_id = ? AND applied = 0`).run(id)

      // 2. Reverser mouvements de stock appliqués
      if (options.reverse_stock) {
        const appliedMovements = db.prepare(`
          SELECT sm.*, p.cmup_price FROM stock_movements sm
          JOIN products p ON p.id = sm.product_id
          WHERE sm.document_id = ? AND sm.applied = 1
        `).all(id) as any[]
        for (const m of appliedMovements) {
          const reverseType = m.type === 'in' ? 'out' : 'in'
          if (reverseType === 'out') {
            const product = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(m.product_id) as any
            if (product && product.stock_quantity < m.quantity) {
              throw new Error(`Stock insuffisant pour annuler le mouvement de ${m.product_id}: disponible ${product.stock_quantity}, requis ${m.quantity}`)
            }
          }
          const cmup = (db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(m.product_id) as any)?.cmup_price ?? m.unit_cost
          const insertResult = db.prepare(`
            INSERT INTO stock_movements (product_id, type, quantity, unit_cost, document_id, date, applied, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)
          `).run(m.product_id, reverseType, m.quantity, cmup, id, new Date().toISOString().split('T')[0], `Annulation ${doc.number ?? ''}`)
          const movId = insertResult.lastInsertRowid as number

          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(m.product_id) as any
          const cmupBefore = product.cmup_price ?? 0
          let newQty: number, newCmup: number
          if (reverseType === 'in') {
            const totalVal = (product.stock_quantity * cmupBefore) + (m.quantity * cmup)
            newQty  = product.stock_quantity + m.quantity
            newCmup = newQty > 0 ? totalVal / newQty : cmup
          } else {
            newQty  = product.stock_quantity - m.quantity
            newCmup = cmupBefore
          }
          db.prepare(`UPDATE products SET stock_quantity = ?, cmup_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newQty, newCmup, m.product_id)
          db.prepare(`UPDATE stock_movements SET applied = 1, cmup_before = ?, cmup_after = ? WHERE id = ?`).run(cmupBefore, newCmup, movId)
          db.prepare(`UPDATE stock_movements SET applied = -1 WHERE id = ?`).run(m.id)
        }
      }

      // 3. Contre-passation comptable (خيار يدوي — بديل عن deleteAccountingEntries)
      if (options.reverse_accounting) {
        const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type = ? AND source_id = ?`).get(doc.type, id) as any
        if (entry) {
          const lines = db.prepare(`SELECT * FROM journal_lines WHERE entry_id = ?`).all(entry.id) as any[]
          const reverseEntry = db.prepare(`
            INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
            VALUES (?, ?, ?, 1, ?, ?, ?)
          `).run(new Date().toISOString().split('T')[0], `ANNUL-${doc.number}`, `Contre-passation: ${entry.description ?? doc.number}`, doc.type, id, effectiveUserId)
          const newEntryId = reverseEntry.lastInsertRowid as number
          for (const l of lines) {
            db.prepare(`
              INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes)
              VALUES (?, ?, ?, ?, ?)
            `).run(newEntryId, l.account_id, l.credit, l.debit, `Annulation: ${l.notes ?? ''}`)
          }
        }
      }

      // 4. Annuler paiements liés + créer qiuds comptables inverses
      if (options.cancel_payments) {
        const payIds = (db.prepare(`SELECT payment_id FROM payment_allocations WHERE document_id = ?`).all(id) as any[]).map((r: any) => r.payment_id)
        for (const payId of payIds) {
          const pay = db.prepare('SELECT * FROM payments WHERE id = ? AND status != ?').get(payId, 'cancelled') as any
          if (!pay) continue
          db.prepare(`UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(payId)
          // قيد عكسي للقيد المحاسبي للدفعة
          const payEntry = db.prepare(`SELECT id FROM journal_entries WHERE source_type = 'payment' AND source_id = ?`).get(payId) as any
          if (payEntry) {
            const entryLines = db.prepare(`SELECT account_id, debit, credit, notes FROM journal_lines WHERE entry_id = ?`).all(payEntry.id) as any[]
            const reverseEntry = db.prepare(`
              INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
              VALUES (?, ?, ?, 1, 'payment', ?, ?)
            `).run(new Date().toISOString().split('T')[0], `ANNUL-${pay.reference ?? `P-${payId}`}`, `Annulation paiement: ${pay.reference ?? `P-${payId}`}`, payId, effectiveUserId)
            const newEntryId = reverseEntry.lastInsertRowid as number
            for (const line of entryLines) {
              db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)`).run(
                newEntryId, line.account_id, line.credit, line.debit, `Annulation: ${line.notes ?? ''}`
              )
            }
          }
        }
        db.prepare(`DELETE FROM payment_allocations WHERE document_id = ?`).run(id)
      }

      // 5. Annuler le document
      db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)

      // ✅ المشكلة 2: حذف القيود يرمي exception إذا فشل — يُلغي الـ transaction كاملة
      // لا نستدعي deleteAccountingEntries إذا اختار المستخدم reverse_accounting يدوياً
      if (!options.reverse_accounting) {
        deleteAccountingEntriesForCancelledDocument(db, doc.type, id, doc.number, effectiveUserId)
      }

      logAudit(db, { user_id: effectiveUserId, action: 'CANCEL', table_name: 'documents', record_id: id, old_values: { status: doc.status, number: doc.number, type: doc.type } })

      // 6. Recalculer statut BC parent si BR
      if (doc.type === 'bl_reception') {
        const poLink = db.prepare(`SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'`).get(id) as any
        if (poLink) {
          const poId = poLink.parent_id
          const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
          const brIds = (db.prepare(`
            SELECT dl.child_id as id FROM document_links dl
            JOIN documents d ON d.id = dl.child_id
            WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
          `).all(poId) as any[]).map((r: any) => r.id)
          if (brIds.length === 0) {
            db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(poId)
          } else {
            const received: Record<string, number> = {}
            for (const brId of brIds) {
              for (const l of db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]) {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                received[key] = (received[key] ?? 0) + Number(l.quantity)
              }
            }
            const full = poLines.every((l: any) => (received[l.product_id ? `p_${l.product_id}` : `d_${l.description}`] ?? 0) >= Number(l.quantity))
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(full ? 'received' : 'partial', poId)
          }
        }
      }
    })

    tx()
    return { success: true }
  })

  handle('documents:convert', ({ sourceId, targetType, extra }) => {
    const db = getDb()
    const source = db.prepare('SELECT * FROM documents WHERE id = ?').get(sourceId) as any
    if (!source) throw new Error('Document source introuvable')

    // منع تحويل Devis لفاتورة أكثر من مرة
    if (source.type === 'quote' && targetType === 'invoice') {
      const existing = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.child_id
        WHERE dl.parent_id = ? AND d.type = 'invoice' AND d.status != 'cancelled'
      `).get(sourceId)
      if (existing) throw new Error('Ce devis a déjà été converti en facture')
    }

    // منع تحويل Proforma لفاتورة أكثر من مرة
    if (source.type === 'proforma' && targetType === 'invoice') {
      const existing = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.child_id
        WHERE dl.parent_id = ? AND d.type = 'invoice' AND d.status != 'cancelled'
      `).get(sourceId)
      if (existing) throw new Error('Cette proforma a déjà été convertie en facture')
    }

    const sourceLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(sourceId) as any[]

    // Réception partielle: si extra.lines fourni, utiliser ces quantités
    const linesToUse = (extra?.lines && Array.isArray(extra.lines) && extra.lines.length > 0)
      ? sourceLines.map((l: any) => {
          const override = extra.lines.find((el: any) => el.id === l.id)
          return { ...l, quantity: override ? Number(override.quantity) : l.quantity }
        }).filter((l: any) => l.quantity > 0)
      : sourceLines

    const newDoc = createDocument({
      type: targetType,
      date: new Date().toISOString().split('T')[0],
      party_id: source.party_id,
      party_type: source.party_type,
      lines: linesToUse.map((l: any) => ({
        product_id: l.product_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tva_rate: l.tva_rate,
      })),
      notes: source.notes,
      extra: extra ?? {},
      created_by: 1,
    })

    // ربط المستندين
    db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(
      sourceId, newDoc.id, `${source.type}_to_${targetType}`
    )

    return newDoc
  })

  handle('documents:update', (data) => {
    const db = getDb()
    
    // 🔍 DEBUG: تتبع البيانات المستلمة
    console.log('📥 [documents:update] data received:', JSON.stringify({
      id: data.id,
      global_discount: data.global_discount,
      date: data.date,
      party_id: data.party_id,
      total_ttc: data.total_ttc,
    }))

    // ✅ FIX 1: التحقق من وجود العميل/المورد قبل الحفظ
    if (data.party_id) {
      const partyTable = data.party_type === 'supplier' ? 'suppliers' : 'clients'
      const party = db.prepare(`SELECT id FROM ${partyTable} WHERE id = ?`).get(data.party_id)
      if (!party) {
        throw new Error(`${data.party_type === 'supplier' ? 'Fournisseur' : 'Client'} introuvable (ID: ${data.party_id})`)
      }
    }

    // تحديث الحقول الأساسية للمسودة
    const result = db.prepare(`
      UPDATE documents
      SET date=?, party_id=?, total_ht=?, total_tva=?, total_ttc=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='draft'
    `).run(
      data.date ?? null,
      data.party_id ?? null,
      data.total_ht ?? 0,
      data.total_tva ?? 0,
      data.total_ttc ?? 0,
      data.notes ?? null,
      data.id
    )
    console.log('[UPDATE DRAFT] rows changed:', result.changes)

    // تحديث الخطوط إذا أُرسلت
    if (Array.isArray(data.lines)) {
      db.prepare(`DELETE FROM document_lines WHERE document_id = ?`).run(data.id)
      for (const line of data.lines) {
        const totalHt  = (line.quantity ?? 1) * (line.unit_price ?? 0) * (1 - (line.discount ?? 0) / 100)
        const totalTva = totalHt * (line.tva_rate ?? 0) / 100
        db.prepare(`
          INSERT INTO document_lines (document_id, product_id, description, quantity, unit_price, discount, tva_rate, total_ht, total_tva, total_ttc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          data.id,
          line.product_id ?? null,
          line.description ?? null,
          line.quantity ?? 1,
          line.unit_price ?? 0,
          line.discount ?? 0,
          line.tva_rate ?? 0,
          totalHt,
          totalTva,
          totalHt + totalTva
        )
      }
    }

    // ✅ FIX 2: تحديث global_discount في الجداول الفرعية حسب نوع الوثيقة
    const doc = db.prepare('SELECT type FROM documents WHERE id = ?').get(data.id) as any
    if (doc) {
      console.log('📄 [documents:update] doc.type:', doc.type)
      
      const subTableMap: Record<string, string> = {
        invoice:          'doc_invoices',
        quote:            'doc_quotes',
        bl:               'doc_bons_livraison',
        proforma:         'doc_proformas',
        avoir:            'doc_avoirs',
        purchase_invoice: 'doc_purchase_invoices',
      }
      
      const subTable = subTableMap[doc.type]
      console.log('📊 [documents:update] subTable:', subTable, 'global_discount:', data.global_discount)
      
      if (subTable && data.global_discount !== undefined) {
        const updateResult = db.prepare(`UPDATE ${subTable} SET global_discount = ? WHERE document_id = ?`)
          .run(data.global_discount ?? 0, data.id)
        console.log('✅ [documents:update] global_discount updated, rows changed:', updateResult.changes)
      } else {
        console.log('⚠️ [documents:update] Skipped global_discount update:', {
          hasSubTable: !!subTable,
          hasGlobalDiscount: data.global_discount !== undefined,
        })
      }
    }

    // تحديث الحقول الإضافية (due_date, payment_method, currency...)
    if (data.due_date !== undefined || data.payment_method !== undefined || data.currency !== undefined) {
      db.prepare(`
        INSERT INTO doc_invoices (document_id, due_date, payment_method, currency, exchange_rate)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          due_date=excluded.due_date,
          payment_method=excluded.payment_method,
          currency=excluded.currency,
          exchange_rate=excluded.exchange_rate
      `).run(
        data.id,
        data.due_date ?? null,
        data.payment_method ?? 'cash',
        data.currency ?? 'MAD',
        data.exchange_rate ?? 1
      )
    }

    // ✅ FIX 3: تسجيل التعديل في audit_log
    logAudit(db, {
      user_id: data.updated_by ?? 1,
      action: 'UPDATE',
      table_name: 'documents',
      record_id: data.id,
      new_values: {
        date: data.date,
        party_id: data.party_id,
        total_ttc: data.total_ttc,
        global_discount: data.global_discount,
        lines_count: data.lines?.length,
      },
    })

    return { success: true }
  })
  // يمر عبر Avoir تلقائي شفاف للمستخدم (امتثال قانون 9.88 / CGNC)
  handle('documents:smartEdit', (data: { id: number; userId?: number }) => {
    const userId = data.userId ?? 1
    const result = smartEditDocument(data.id, userId)
    return {
      success: true,
      avoirId:      result.avoirId,
      newDocId:     result.newDocId,
      newDocNumber: result.newDocNumber,
      warning:      result.warning ?? null,
    }
  })

  // ── Update Safe Fields — تعديل الحقول الآمنة مباشرة ──────────────────────
  // يسمح بتعديل الحقول التي لا تؤثر على المحاسبة أو المخزون
  handle('documents:updateSafeFields', (data: { 
    id: number; 
    notes?: string; 
    due_date?: string;
    delivery_address?: string;
    userId?: number 
  }) => {
    const db = getDb()
    const userId = data.userId ?? 1
    
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(data.id) as any
    if (!doc) throw new Error('Document introuvable')
    
    // التحقق من الفترة المحاسبية (حتى للحقول الآمنة)
    checkPeriodOpen(db, doc.date)
    
    const tx = db.transaction(() => {
      const oldValues: any = {}
      
      // تحديث الملاحظات (آمن لجميع أنواع المستندات)
      if (data.notes !== undefined) {
        oldValues.notes = doc.notes
        db.prepare('UPDATE documents SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(data.notes, data.id)
      }
      
      // تحديث تاريخ الاستحقاق (للفواتير فقط)
      if (data.due_date !== undefined && ['invoice', 'purchase_invoice'].includes(doc.type)) {
        const subTable = doc.type === 'invoice' ? 'doc_invoices' : 'doc_purchase_invoices'
        const oldDueDate = db.prepare(`SELECT due_date FROM ${subTable} WHERE document_id = ?`).get(data.id) as any
        oldValues.due_date = oldDueDate?.due_date
        
        db.prepare(`UPDATE ${subTable} SET due_date = ? WHERE document_id = ?`)
          .run(data.due_date || null, data.id)
      }
      
      // تحديث عنوان التسليم (للـ BL فقط)
      if (data.delivery_address !== undefined && doc.type === 'bl') {
        const oldAddr = db.prepare('SELECT delivery_address FROM doc_bons_livraison WHERE document_id = ?').get(data.id) as any
        oldValues.delivery_address = oldAddr?.delivery_address
        
        db.prepare('UPDATE doc_bons_livraison SET delivery_address = ? WHERE document_id = ?')
          .run(data.delivery_address || null, data.id)
      }
      
      // تسجيل في audit_log
      logAudit(db, {
        user_id: userId,
        action: 'UPDATE_SAFE_FIELDS',
        table_name: 'documents',
        record_id: data.id,
        old_values: oldValues,
        new_values: {
          notes: data.notes,
          due_date: data.due_date,
          delivery_address: data.delivery_address,
        },
      })
    })
    
    tx()
    return { success: true }
  })

  handle('documents:link', ({ parentId, childId, linkType }) => {
    const db = getDb()
    db.prepare('INSERT OR IGNORE INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(parentId, childId, linkType)
    return { success: true }
  })

  // ── Timeline d'un document ───────────────────────────────────────────────
  handle('documents:getTimeline', (docId: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as any
    if (!doc) throw new Error('Document introuvable')

    const events: { date: string; type: string; label: string; detail?: string; icon: string }[] = []

    // 1. Création
    events.push({
      date: doc.created_at,
      type: 'created',
      label: 'Document créé',
      detail: `N° ${doc.number}`,
      icon: '📝',
    })

    // 2. Confirmation (via audit_log)
    const confirmLog = db.prepare(`
      SELECT created_at, user_id FROM audit_log
      WHERE table_name = 'documents' AND record_id = ? AND action = 'CONFIRM'
      ORDER BY created_at ASC LIMIT 1
    `).get(docId) as any
    if (confirmLog) {
      events.push({
        date: confirmLog.created_at,
        type: 'confirmed',
        label: 'Document confirmé',
        icon: '✅',
      })
    }

    // 3. Paiements
    const payments = db.prepare(`
      SELECT p.date, p.amount, p.method, p.status, p.created_at
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE pa.document_id = ?
      ORDER BY p.created_at ASC
    `).all(docId) as any[]
    const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)
    const methodLabel: Record<string, string> = { cash: 'Espèces', bank: 'Virement', cheque: 'Chèque', lcn: 'LCN', avoir: 'Avoir' }
    for (const p of payments) {
      events.push({
        date: p.created_at,
        type: 'payment',
        label: `Paiement — ${fmt(p.amount)} MAD`,
        detail: methodLabel[p.method] ?? p.method,
        icon: '💰',
      })
    }

    // 4. BL liés (livraisons)
    const bls = db.prepare(`
      SELECT d.number, d.date, d.created_at, d.status FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
      ORDER BY d.created_at ASC
    `).all(docId) as any[]
    for (const bl of bls) {
      events.push({
        date: bl.created_at,
        type: 'delivery',
        label: `Bon de livraison — ${bl.number}`,
        detail: bl.status === 'delivered' ? 'Stock appliqué' : 'En attente',
        icon: '🚚',
      })
    }

    // 5. Avoirs liés
    const avoirs = db.prepare(`
      SELECT d.number, d.date, d.created_at, d.total_ttc FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'avoir' AND d.status != 'cancelled'
      ORDER BY d.created_at ASC
    `).all(docId) as any[]
    for (const av of avoirs) {
      events.push({
        date: av.created_at,
        type: 'avoir',
        label: `Avoir — ${av.number}`,
        detail: `${fmt(av.total_ttc)} MAD`,
        icon: '↩️',
      })
    }

    // 6. Annulation
    const cancelLog = db.prepare(`
      SELECT created_at FROM audit_log
      WHERE table_name = 'documents' AND record_id = ? AND action = 'CANCEL'
      ORDER BY created_at ASC LIMIT 1
    `).get(docId) as any
    if (cancelLog) {
      events.push({
        date: cancelLog.created_at,
        type: 'cancelled',
        label: 'Document annulé',
        icon: '🚫',
      })
    }

    // ترتيب زمني
    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  })

  // ── Résumé réception partielle pour un BC ────────────────────────────────
  handle('documents:getPOReceiptStatus', (poId: number) => {
    const db = getDb()
    const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
    const brIds = (db.prepare(`
      SELECT dl.child_id as id FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
    `).all(poId) as any[]).map((r: any) => r.id)
    const received: Record<string, number> = {}
    for (const brId of brIds) {
      const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
      for (const l of brLines) {
        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
        received[key] = (received[key] ?? 0) + Number(l.quantity)
      }
    }
    const summary = poLines.map((l: any) => {
      const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
      const qtyOrdered  = Number(l.quantity)
      const qtyReceived = received[key] ?? 0
      return { id: l.id, product_id: l.product_id, description: l.description, unit_price: l.unit_price, discount: l.discount, tva_rate: l.tva_rate, qty_ordered: qtyOrdered, qty_received: qtyReceived, qty_remaining: Math.max(0, qtyOrdered - qtyReceived) }
    })
    const fullyReceived = summary.every((l: any) => l.qty_remaining <= 0)
    return { summary, fullyReceived, brCount: brIds.length }
  })

  // ── Résumé livraison partielle pour une Facture ─────────────────────────
  handle('documents:getBLDeliveryStatus', (invoiceId: number) => {
    const db = getDb()
    const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(invoiceId) as any[]

    // Tous les BL liés à cette facture (non annulés)
    const blIds = (db.prepare(`
      SELECT dl.child_id as id FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
    `).all(invoiceId) as any[]).map((r: any) => r.id)

    // Quantités déjà livrées
    const delivered: Record<string, number> = {}
    for (const blId of blIds) {
      const blLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId) as any[]
      for (const l of blLines) {
        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
        delivered[key] = (delivered[key] ?? 0) + Number(l.quantity)
      }
    }

    const summary = invLines.map((l: any) => {
      const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
      const qtyOrdered   = Number(l.quantity)
      const qtyDelivered = delivered[key] ?? 0
      const qtyRemaining = Math.max(0, qtyOrdered - qtyDelivered)
      return {
        id:            l.id,
        product_id:    l.product_id,
        description:   l.description,
        unit_price:    l.unit_price,
        discount:      l.discount,
        tva_rate:      l.tva_rate,
        qty_ordered:   qtyOrdered,
        qty_delivered: qtyDelivered,
        qty_remaining: qtyRemaining,
      }
    })

    const fullyDelivered = summary.every((l: any) => l.qty_remaining <= 0)
    return { summary, fullyDelivered, blCount: blIds.length }
  })

  // ── Suppression définitive d'un brouillon ───────────────────────────────
  // Seuls les brouillons (draft) peuvent être supprimés définitivement.
  // Les documents confirmés ne peuvent qu'être annulés (principe CGNC).
  handle('documents:deleteDraft', (id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT id, status, type, number FROM documents WHERE id = ? AND is_deleted = 0').get(id) as any
    if (!doc) throw new Error('Document introuvable')
    if (doc.status !== 'draft') throw new Error('Seuls les brouillons peuvent être supprimés définitivement. Utilisez l\'annulation pour les documents confirmés.')

    // Vérifier qu'il n'y a pas de mouvements de stock (ne devrait pas exister pour un draft, mais par sécurité)
    const movCount = (db.prepare('SELECT COUNT(*) as c FROM stock_movements WHERE document_id = ?').get(id) as any).c
    if (movCount > 0) throw new Error('Ce brouillon a des mouvements de stock associés. Annulez-le plutôt.')

    const tx = db.transaction(() => {
      // Supprimer les lignes du document (CASCADE devrait le faire, mais explicite par sécurité)
      db.prepare('DELETE FROM document_lines WHERE document_id = ?').run(id)

      // Supprimer les tables filles selon le type
      const subTables: Record<string, string> = {
        invoice:          'doc_invoices',
        quote:            'doc_quotes',
        bl:               'doc_bons_livraison',
        bl_reception:     'doc_bons_reception',
        proforma:         'doc_proformas',
        avoir:            'doc_avoirs',
        purchase_invoice: 'doc_purchase_invoices',
        import_invoice:   'doc_import_invoices',
        purchase_order:   'doc_purchase_orders',
      }
      const subTable = subTables[doc.type]
      if (subTable) {
        db.prepare(`DELETE FROM ${subTable} WHERE document_id = ?`).run(id)
      }

      // Supprimer les liens
      db.prepare('DELETE FROM document_links WHERE parent_id = ? OR child_id = ?').run(id, id)

      // Supprimer le document principal
      db.prepare('DELETE FROM documents WHERE id = ?').run(id)

      // Audit
      logAudit(db, {
        user_id: 1,
        action: 'DELETE',
        table_name: 'documents',
        record_id: id,
        old_values: { number: doc.number, type: doc.type, status: doc.status },
      })
    })

    tx()
    // إعادة تدوير الرقم إذا كان رقماً حقيقياً (ليس BRO-)
    recycleDocumentNumber(doc.type, doc.number)
    return { success: true }
  })

  // جلب أصغر رقم معاد تدويره
  handle('sequences:getRecycled', (docType: string) => {
    return getNextRecycledNumber(docType)
  })
}
