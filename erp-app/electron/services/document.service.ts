import Database from 'better-sqlite3'
import { getDb } from '../database/connection'
import { createAccountingEntry, deleteAccountingEntriesForCancelledDocument, checkPeriodOpen } from './accounting.service'
import { createStockMovement } from './stock.service'
import { logAudit, type AuditAction } from './audit.service'

// ==========================================
// UTILITAIRES DE PRÉCISION NUMÉRIQUE
// ==========================================

/** Arrondit à N décimales (ROUND_HALF_UP) */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** Arrondit une quantité à 4 décimales */
function roundQty(value: number): number {
  return round(value, 4)
}

/** Arrondit un montant financier à 2 décimales */
function roundAmt(value: number): number {
  return round(value, 2)
}

/** Epsilon pour comparaisons financières (0.005 MAD) */
const FINANCIAL_EPSILON = 0.005

// ==========================================
// DOCUMENT NUMBERING
// ==========================================
const DOC_PREFIXES: Record<string, string> = {
  invoice:          'F',
  quote:            'D',
  bl:               'BL',
  proforma:         'PRO',
  avoir:            'AV',
  purchase_order:   'BC',
  bl_reception:     'BR',
  purchase_invoice: 'FF',
  import_invoice:   'IMP',
}

export function generateDocumentNumber(docType: string, customSeq?: number): string {
  const db = getDb()
  const year = new Date().getFullYear() % 100
  const prefix = DOC_PREFIXES[docType] ?? 'DOC'

  const tx = db.transaction(() => {
    // نحاول قراءة recycled_seqs — قد لا يكون موجوداً في قواعد بيانات قديمة
    let row: any
    try {
      row = db.prepare(
        'SELECT last_seq, recycled_seqs FROM document_sequences WHERE doc_type = ? AND year = ?'
      ).get(docType, year)
    } catch {
      row = db.prepare(
        'SELECT last_seq FROM document_sequences WHERE doc_type = ? AND year = ?'
      ).get(docType, year)
    }

    const lastSeq: number = row?.last_seq ?? 0
    let recycled: number[] = []
    try { recycled = JSON.parse(row?.recycled_seqs ?? '[]') } catch { recycled = [] }
    let seq: number

    if (customSeq !== undefined) {
      // رقم مخصص من المستخدم — نتحقق أنه غير مستخدم
      const candidate = `${prefix}-${year}-${customSeq}`
      const exists = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(candidate) as any
      if (exists) {
        let suggestion = customSeq + 1
        while (true) {
          const c = `${prefix}-${year}-${suggestion}`
          const e = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(c) as any
          if (!e) break
          suggestion++
        }
        throw new Error(`Le numéro ${candidate} est déjà utilisé. Prochain disponible: ${prefix}-${year}-${suggestion}`)
      }
      seq = customSeq
    } else {
      // رقم تلقائي — التالي في التسلسل (last_seq + 1)
      seq = lastSeq + 1
      // تأكد أن الرقم غير مستخدم (حالة نادرة)
      while (true) {
        const candidate = `${prefix}-${year}-${seq}`
        const exists = db.prepare('SELECT id FROM documents WHERE number = ? AND is_deleted = 0').get(candidate) as any
        if (!exists) break
        seq++
      }
    }

    // تحديث last_seq وإزالة الرقم من recycled إذا كان موجوداً
    const newLastSeq = Math.max(lastSeq, seq)
    const newRecycled = recycled.filter(r => r !== seq)

    try {
      db.prepare(`
        INSERT INTO document_sequences (doc_type, year, last_seq, recycled_seqs)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(doc_type, year) DO UPDATE SET
          last_seq = ?,
          recycled_seqs = ?
      `).run(docType, year, newLastSeq, JSON.stringify(newRecycled), newLastSeq, JSON.stringify(newRecycled))
    } catch {
      // fallback: بدون recycled_seqs (قاعدة بيانات قديمة)
      db.prepare(`
        INSERT INTO document_sequences (doc_type, year, last_seq)
        VALUES (?, ?, ?)
        ON CONFLICT(doc_type, year) DO UPDATE SET last_seq = ?
      `).run(docType, year, newLastSeq, newLastSeq)
    }

    return `${prefix}-${year}-${seq}`
  })

  return tx()
}

// إضافة رقم لقائمة الأرقام المعاد تدويرها عند حذف مسودة
export function recycleDocumentNumber(docType: string, number: string): void {
  const db = getDb()
  const year = new Date().getFullYear() % 100
  const prefix = DOC_PREFIXES[docType] ?? 'DOC'
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`)
  const match = number.match(pattern)
  if (!match) return // ليس رقماً حقيقياً (BRO- مثلاً)

  const seq = parseInt(match[1])
  let row: any
  try {
    row = db.prepare(
      'SELECT last_seq, recycled_seqs FROM document_sequences WHERE doc_type = ? AND year = ?'
    ).get(docType, year)
  } catch {
    return // العمود غير موجود — تجاهل
  }
  if (!row) return

  let recycled: number[] = []
  try { recycled = JSON.parse(row.recycled_seqs ?? '[]') } catch { recycled = [] }

  if (!recycled.includes(seq)) {
    recycled.push(seq)
    recycled.sort((a, b) => a - b) // ترتيب تصاعدي
    db.prepare('UPDATE document_sequences SET recycled_seqs = ? WHERE doc_type = ? AND year = ?')
      .run(JSON.stringify(recycled), docType, year)
  }
}

// جلب أصغر رقم معاد تدويره (للعرض في الواجهة)
export function getNextRecycledNumber(docType: string): string | null {
  const db = getDb()
  const year = new Date().getFullYear() % 100
  const prefix = DOC_PREFIXES[docType] ?? 'DOC'
  let row: any
  try {
    row = db.prepare(
      'SELECT recycled_seqs FROM document_sequences WHERE doc_type = ? AND year = ?'
    ).get(docType, year)
  } catch {
    return null
  }
  if (!row) return null

  let recycled: number[] = []
  try { recycled = JSON.parse(row.recycled_seqs ?? '[]') } catch { recycled = [] }
  if (recycled.length === 0) return null

  return `${prefix}-${year}-${recycled[0]}`
}

// ==========================================
// CREATE DOCUMENT
// ==========================================
export function createDocument(data: {
  type: string
  date: string
  party_id?: number
  party_type?: string
  lines: Array<{
    product_id?: number
    description?: string
    quantity: number
    unit_price: number
    discount?: number
    tva_rate?: number
  }>
  notes?: string
  extra?: Record<string, unknown>
  created_by: number
  custom_seq?: number  // رقم تسلسلي مخصص اختياري
}): { id: number; number: string } {
  const db = getDb()

  // ✅ Validation: party_id obligatoire pour les documents qui nécessitent un tiers
  const requiresParty = ['invoice', 'quote', 'bl', 'avoir', 'purchase_invoice', 'purchase_order', 'bl_reception', 'import_invoice']
  if (requiresParty.includes(data.type) && !data.party_id) {
    throw new Error('party_id est obligatoire pour ce type de document')
  }

  // المسودة تأخذ رقمها الحقيقي مباشرة
  const number = generateDocumentNumber(data.type, data.custom_seq)

  // حساب الإجماليات
  let total_ht = 0
  let total_tva = 0

  const computedLines = data.lines.map(line => {
    if (line.quantity <= 0) throw new Error(`La quantité doit être supérieure à 0`)
    if (line.unit_price < 0) throw new Error(`Le prix unitaire ne peut pas être négatif`)
    if ((line.discount ?? 0) < 0 || (line.discount ?? 0) > 100) throw new Error(`La remise doit être entre 0 et 100%`)

    const qty       = roundQty(line.quantity)
    const price     = roundAmt(line.unit_price)
    const discount  = round(line.discount ?? 0, 4)
    const tva_rate  = line.tva_rate ?? 20

    const ht  = roundAmt(qty * price * (1 - discount / 100))
    const tva = roundAmt(ht * (tva_rate / 100))
    const ttc = roundAmt(ht + tva)

    total_ht  = roundAmt(total_ht + ht)
    total_tva = roundAmt(total_tva + tva)

    return { ...line, quantity: qty, unit_price: price, discount, total_ht: ht, total_tva: tva, total_ttc: ttc }
  })

  const total_ttc = roundAmt(total_ht + total_tva)

  // التحقق من الأوفر: لا يمكن أن يتجاوز قيمة الفاتورة الأصلية
  if (data.type === 'avoir' && data.extra?.source_invoice_id) {
    const sourceInvoice = db.prepare('SELECT total_ttc FROM documents WHERE id = ? AND is_deleted = 0').get(data.extra.source_invoice_id as number) as any
    if (sourceInvoice && total_ttc > sourceInvoice.total_ttc + FINANCIAL_EPSILON) {
      throw new Error(`L'avoir (${total_ttc.toFixed(2)} MAD) ne peut pas dépasser la facture source (${sourceInvoice.total_ttc.toFixed(2)} MAD)`)
    }
  }

  // ✅ استثناء خاص: Smart Edit Avoir يمكن أن يتجاوز المبلغ الأصلي (لأنه يعكس الوثيقة كاملة)
  const isSmartEditAvoir = data.type === 'avoir' && data.extra?.avoir_type === 'annulation' && data.extra?.source_invoice_id

  const tx = db.transaction(() => {
    // إدراج المستند الرئيسي
    const docResult = db.prepare(`
      INSERT INTO documents (type, number, date, party_id, party_type, status,
        total_ht, total_tva, total_ttc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `).run(
      data.type, number, data.date,
      data.party_id ?? null, data.party_type ?? null,
      total_ht, total_tva, total_ttc,
      data.notes ?? null, data.created_by
    )

    const docId = docResult.lastInsertRowid as number

    // إدراج السطور
    for (const line of computedLines) {
      db.prepare(`
        INSERT INTO document_lines
          (document_id, product_id, description, quantity, unit_price, discount,
           tva_rate, total_ht, total_tva, total_ttc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        docId,
        line.product_id ?? null,
        line.description ?? null,
        line.quantity, line.unit_price,
        line.discount ?? 0, line.tva_rate ?? 20,
        line.total_ht, line.total_tva, line.total_ttc
      )
    }

    // إدراج الجدول الفرعي حسب النوع
    insertSubTable(db, data.type, docId, data.extra ?? {})

    return { id: docId, number }
  })

  return tx()
}

// ==========================================
// CONFIRM DOCUMENT — القلب المحاسبي
// ==========================================
export function confirmDocument(id: number, userId: number): void {
  const db = getDb()

  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(id) as any
  if (!doc) throw new Error('Document introuvable')
  if (doc.status !== 'draft') throw new Error('Document déjà confirmé')

  // ✅ التحقق من أن تاريخ الوثيقة يقع في فترة محاسبية مفتوحة
  checkPeriodOpen(db, doc.date)

  const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(id) as any[]

  const tx = db.transaction(() => {
    // تحديث الحالة
    db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)

    // إنشاء القيد المحاسبي التلقائي
    createAccountingEntry(db, doc, lines, userId)

    // إنشاء حركات المخزون المعلقة
    if (doc.type === 'bl') {
      // التحقق من المخزون الكافي قبل التأكيد
      for (const line of lines) {
        if (!line.product_id) continue
        const product = db.prepare('SELECT name, stock_quantity, unit FROM products WHERE id = ?').get(line.product_id) as any
        if (product && product.stock_quantity < line.quantity) {
          throw new Error(`Stock insuffisant pour "${product.name}": disponible ${product.stock_quantity} ${product.unit}, demandé ${line.quantity} ${product.unit}`)
        }
      }
      // BL بيع → خروج مخزون
      for (const line of lines) {
        if (!line.product_id) continue
        createStockMovement(db, {
          product_id: line.product_id,
          type: 'out',
          quantity: line.quantity,
          unit_cost: line.unit_price,
          document_id: id,
          date: doc.date,
          applied: false,
          created_by: userId,
        })
      }

      // تحديث حالة الفاتورة المرتبطة إذا وجدت
      const linkedInvoice = db.prepare(`
        SELECT d.id, d.total_ttc FROM document_links dl
        JOIN documents d ON d.id = dl.parent_id
        WHERE dl.child_id = ? AND d.type = 'invoice' AND d.status IN ('confirmed','partial')
      `).get(id) as any
      if (linkedInvoice) {
        // حساب الكميات المُسلَّمة مقابل المطلوبة
        const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(linkedInvoice.id) as any[]
        const blIds = (db.prepare(`
          SELECT dl.child_id as id FROM document_links dl
          JOIN documents d ON d.id = dl.child_id
          WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
        `).all(linkedInvoice.id) as any[]).map((r: any) => r.id)
        const delivered: Record<string, number> = {}
        for (const blId of blIds) {
          for (const l of db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId) as any[]) {
            const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
            delivered[key] = (delivered[key] ?? 0) + Number(l.quantity)
          }
        }
        const fullyDelivered = invLines.every((l: any) => {
          const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
          return (delivered[key] ?? 0) >= Number(l.quantity)
        })
        // نحافظ على حالة الدفع — إذا كانت paid تبقى paid
        const currentStatus = db.prepare('SELECT status FROM documents WHERE id = ?').get(linkedInvoice.id) as any
        if (currentStatus?.status === 'paid') {
          // مدفوعة بالكامل — لا نغير الحالة
        } else if (!['cancelled'].includes(currentStatus?.status)) {
          db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
            fullyDelivered ? 'delivered' : 'partial', linkedInvoice.id
          )
        }
      }
    } else if (doc.type === 'bl_reception') {
      // Bon de réception → دخول مخزون
      for (const line of lines) {
        if (!line.product_id) continue
        createStockMovement(db, {
          product_id: line.product_id,
          type: 'in',
          quantity: line.quantity,
          unit_cost: line.unit_price,
          document_id: id,
          date: doc.date,
          applied: false,
          created_by: userId,
        })
      }

      // Recalculer statut BC parent (partiel ou reçu)
      const linkedBC = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.parent_id
        WHERE dl.child_id = ? AND d.type = 'purchase_order' AND d.status IN ('confirmed','partial')
      `).get(id) as any
      if (linkedBC) {
        const poId = linkedBC.id
        const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
        const brIds = (db.prepare(`
          SELECT dl2.child_id as id FROM document_links dl2
          JOIN documents d2 ON d2.id = dl2.child_id
          WHERE dl2.parent_id = ? AND d2.type = 'bl_reception' AND d2.status != 'cancelled'
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
        db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          fullyReceived ? 'received' : 'partial', poId
        )
      }
    } else if (doc.type === 'avoir') {
      // Avoir: فقط retour يؤثر على المخزون
      const avoir = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(id) as any
      if (avoir?.affects_stock || avoir?.avoir_type === 'retour') {
        for (const line of lines) {
          if (!line.product_id) continue
          createStockMovement(db, {
            product_id: line.product_id,
            type: 'in', // إرجاع = دخول مخزون
            quantity: line.quantity,
            unit_cost: line.unit_price,
            document_id: id,
            date: doc.date,
            applied: false,
            created_by: userId,
          })
        }
      }

      // ① Annulation → marquer la facture source comme annulée
      if (avoir?.avoir_type === 'annulation') {
        const link = db.prepare(`
          SELECT dl.parent_id FROM document_links dl
          JOIN documents d ON d.id = dl.parent_id
          WHERE dl.child_id = ? AND d.type = 'invoice'
        `).get(id) as any
        if (link?.parent_id) {
          // تحديث حالة الفاتورة إلى ملغية
          db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id)
          
          // ✅ حذف القيود المحاسبية للفاتورة الملغية (مبدأ الحيطة والحذر - CGNC)
          const cancelledDoc = db.prepare('SELECT number, type FROM documents WHERE id = ?').get(link.parent_id) as any
          if (cancelledDoc) {
            deleteAccountingEntriesForCancelledDocument(db, cancelledDoc.type, link.parent_id, cancelledDoc.number, userId)
          }
        }
      }

      // ② Commercial / Retour → imputer l'avoir sur la facture source
      if (avoir?.avoir_type === 'commercial' || avoir?.avoir_type === 'retour') {
        const link = db.prepare(`
          SELECT dl.parent_id FROM document_links dl
          JOIN documents d ON d.id = dl.parent_id
          WHERE dl.child_id = ? AND d.type = 'invoice'
        `).get(id) as any
        if (link?.parent_id) {
          // نُنشئ payment record من نوع 'avoir' لتمثيل التخفيض
          const payResult = db.prepare(`
            INSERT INTO payments (party_id, party_type, amount, method, date, status, document_id, notes, created_by)
            VALUES (?, ?, ?, 'avoir', ?, 'cleared', ?, ?, 1)
          `).run(doc.party_id, doc.party_type, doc.total_ttc, doc.date, link.parent_id, `Avoir ${doc.number}`)
          const payId = payResult.lastInsertRowid as number

          db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(
            payId, link.parent_id, doc.total_ttc
          )
          const invDoc = db.prepare('SELECT total_ttc, type FROM documents WHERE id = ?').get(link.parent_id) as any
          const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(link.parent_id) as any).total
          if (paid >= invDoc.total_ttc - FINANCIAL_EPSILON) {
            db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id)
            db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run('paid', link.parent_id)
          } else if (paid > 0) {
            db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id)
            db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run('partial', link.parent_id)
          }
        }
      }
    }
  })

  tx()
}

// ==========================================
// SMART EDIT — التعديل الذكي للوثائق المؤكدة
// ==========================================

/**
 * التعديل الذكي: يسمح بتعديل وثيقة مؤكدة عبر إنشاء Avoir تلقائي شفاف
 * 
 * الخطوات:
 * 1. إنشاء Avoir رسمي مرقّم يعكس الوثيقة الأصلية بالكامل
 * 2. تغيير حالة الوثيقة الأصلية إلى cancelled
 * 3. إنشاء وثيقة جديدة بحالة draft قابلة للتعديل
 * 
 * الاستثناءات:
 * - وثيقة نوعها avoir أو credit_note → رفض
 * - وثيقة بها مدفوعات جزئية → تحذير
 * - وثيقة في فترة مقفلة → رفض تلقائياً
 * 
 * @returns { avoirId, newDocId, newDocNumber, warning? }
 */
export function smartEditDocument(
  docId: number,
  userId: number
): { avoirId: number; newDocId: number; newDocNumber: string; warning?: string } {
  const db = getDb()

  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(docId) as any
  if (!doc) throw new Error('Document introuvable')
  if (doc.status !== 'confirmed') throw new Error('Seuls les documents confirmés peuvent être modifiés via Smart Edit')

  // ✅ استثناء 1: منع تعديل Avoir
  if (doc.type === 'avoir' || doc.type === 'credit_note') {
    throw new Error("Impossible de modifier un avoir — les avoirs ne peuvent pas être modifiés")
  }

  // ✅ استثناء 2: تحذير إذا كانت هناك مدفوعات جزئية
  let warning: string | undefined
  const payments = db.prepare(`
    SELECT COALESCE(SUM(pa.amount), 0) as total
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.document_id = ? AND p.status != 'cancelled'
  `).get(docId) as any

  if (payments && payments.total > FINANCIAL_EPSILON) {
    warning = `⚠️ Cette facture a des paiements enregistrés (${payments.total.toFixed(2)} MAD). Le nouveau document créera une différence de solde à régulariser.`
  }

  // ✅ استثناء 3: التحقق من الفترة المحاسبية (checkPeriodOpen يرفض تلقائياً)
  checkPeriodOpen(db, doc.date)

  const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(docId) as any[]

  const tx = db.transaction(() => {
    // ═══════════════════════════════════════════════════════════════════════
    // الخطوة 1: إنشاء Avoir رسمي مرقّم يعكس الوثيقة الأصلية
    // ═══════════════════════════════════════════════════════════════════════
    const avoirResult = createDocument({
      type: 'avoir',
      date: new Date().toISOString().split('T')[0],
      party_id: doc.party_id,
      party_type: doc.party_type,
      lines: lines.map((l: any) => ({
        product_id: l.product_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tva_rate: l.tva_rate,
      })),
      notes: `Avoir automatique — Smart Edit de ${doc.number}`,
      extra: {
        avoir_type: 'annulation',
        affects_stock: false,
        source_invoice_id: docId,
        reason: `Modification intelligente du document ${doc.number}`,
      },
      created_by: userId,
    })

    // ربط الـ Avoir بالوثيقة الأصلية
    db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(
      docId, avoirResult.id, 'smart_edit_avoir'
    )

    // تأكيد الـ Avoir تلقائياً (ينشئ القيود المحاسبية المعكوسة)
    confirmDocument(avoirResult.id, userId)

    logAudit(db, {
      user_id: userId,
      action: 'SMART_EDIT_AVOIR' as AuditAction,
      table_name: 'documents',
      record_id: avoirResult.id,
      new_values: { 
        source_doc: doc.number, 
        avoir_number: avoirResult.number,
        reason: 'Smart Edit — Annulation automatique'
      },
    })

    // ═══════════════════════════════════════════════════════════════════════
    // الخطوة 2: تغيير حالة الوثيقة الأصلية إلى cancelled
    // ═══════════════════════════════════════════════════════════════════════
    db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(docId)

    // حذف القيود المحاسبية للوثيقة الأصلية (مع تسجيل كامل في audit_log)
    deleteAccountingEntriesForCancelledDocument(db, doc.type, docId, doc.number, userId)

    logAudit(db, {
      user_id: userId,
      action: 'SMART_EDIT_CANCEL' as AuditAction,
      table_name: 'documents',
      record_id: docId,
      old_values: { status: 'confirmed', number: doc.number },
      new_values: { status: 'cancelled', reason: 'Smart Edit — Document remplacé' },
    })

    // ═══════════════════════════════════════════════════════════════════════
    // الخطوة 3: إنشاء وثيقة جديدة بحالة draft قابلة للتعديل
    // ═══════════════════════════════════════════════════════════════════════
    
    // جلب البيانات الإضافية من الجدول الفرعي
    const extra = getSubTableData(db, doc.type, docId)

    const newDocResult = createDocument({
      type: doc.type,
      date: doc.date, // نحتفظ بنفس التاريخ الأصلي
      party_id: doc.party_id,
      party_type: doc.party_type,
      lines: lines.map((l: any) => ({
        product_id: l.product_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tva_rate: l.tva_rate,
      })),
      notes: doc.notes,
      extra: {
        ...extra,
        original_document_id: docId, // مرجع للوثيقة الأصلية
      },
      created_by: userId,
    })

    // ربط الوثيقة الجديدة بالأصلية
    db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(
      docId, newDocResult.id, 'smart_edit_replacement'
    )

    logAudit(db, {
      user_id: userId,
      action: 'SMART_EDIT_CREATE' as AuditAction,
      table_name: 'documents',
      record_id: newDocResult.id,
      new_values: {
        original_doc: doc.number,
        new_doc: newDocResult.number,
        status: 'draft',
        reason: 'Smart Edit — Nouveau document modifiable',
      },
    })

    return { avoirId: avoirResult.id, newDocId: newDocResult.id, newDocNumber: newDocResult.number }
  })

  const result = tx()
  return { ...result, warning }
}

/**
 * جلب البيانات الإضافية من الجدول الفرعي حسب نوع الوثيقة
 */
function getSubTableData(db: Database.Database, type: string, docId: number): Record<string, unknown> {
  switch (type) {
    case 'invoice': {
      const row = db.prepare('SELECT * FROM doc_invoices WHERE document_id = ?').get(docId) as any
      return row ? {
        currency: row.currency,
        exchange_rate: row.exchange_rate,
        payment_method: row.payment_method,
        due_date: row.due_date,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'quote': {
      const row = db.prepare('SELECT * FROM doc_quotes WHERE document_id = ?').get(docId) as any
      return row ? {
        validity_date: row.validity_date,
        probability: row.probability,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'bl': {
      const row = db.prepare('SELECT * FROM doc_bons_livraison WHERE document_id = ?').get(docId) as any
      return row ? {
        delivery_address: row.delivery_address,
        delivery_date: row.delivery_date,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'proforma': {
      const row = db.prepare('SELECT * FROM doc_proformas WHERE document_id = ?').get(docId) as any
      return row ? {
        validity_date: row.validity_date,
        currency: row.currency,
        exchange_rate: row.exchange_rate,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'avoir': {
      const row = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(docId) as any
      return row ? {
        avoir_type: row.avoir_type,
        affects_stock: row.affects_stock,
        reason: row.reason,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'purchase_invoice': {
      const row = db.prepare('SELECT * FROM doc_purchase_invoices WHERE document_id = ?').get(docId) as any
      return row ? {
        payment_method: row.payment_method,
        due_date: row.due_date,
        global_discount: row.global_discount ?? 0,  // ✅ FIX: إضافة global_discount
      } : {}
    }
    case 'import_invoice': {
      const row = db.prepare('SELECT * FROM doc_import_invoices WHERE document_id = ?').get(docId) as any
      return row ? {
        currency: row.currency,
        exchange_rate: row.exchange_rate,
        invoice_amount: row.invoice_amount,
        customs: row.customs,
        transitaire: row.transitaire,
        tva_import: row.tva_import,
        other_costs: row.other_costs,
        total_cost: row.total_cost,
      } : {}
    }
    default:
      return {}
  }
}

// ==========================================
// HELPERS
// ==========================================
function insertSubTable(
  db: Database.Database,
  type: string,
  docId: number,
  extra: Record<string, unknown>
): void {
  switch (type) {
    case 'invoice':
      db.prepare(`INSERT INTO doc_invoices (document_id, currency, exchange_rate, payment_method, due_date, global_discount)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
        docId,
        extra.currency ?? 'MAD',
        extra.exchange_rate ?? 1,
        extra.payment_method ?? null,
        extra.due_date ?? null,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'quote':
      db.prepare(`INSERT INTO doc_quotes (document_id, validity_date, probability, global_discount) VALUES (?, ?, ?, ?)`).run(
        docId, 
        extra.validity_date ?? null, 
        extra.probability ?? 50,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'bl':
      db.prepare(`INSERT INTO doc_bons_livraison (document_id, delivery_address, delivery_date, global_discount) VALUES (?, ?, ?, ?)`).run(
        docId, 
        extra.delivery_address ?? null, 
        extra.delivery_date ?? null,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'proforma':
      db.prepare(`INSERT INTO doc_proformas (document_id, validity_date, currency, exchange_rate, global_discount) VALUES (?, ?, ?, ?, ?)`).run(
        docId, 
        extra.validity_date ?? null, 
        extra.currency ?? 'MAD', 
        extra.exchange_rate ?? 1,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'avoir':
      db.prepare(`INSERT INTO doc_avoirs (document_id, avoir_type, affects_stock, reason, global_discount) VALUES (?, ?, ?, ?, ?)`).run(
        docId, 
        extra.avoir_type ?? 'commercial', 
        extra.affects_stock ? 1 : 0, 
        extra.reason ?? null,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'purchase_invoice':
      db.prepare(`INSERT INTO doc_purchase_invoices (document_id, payment_method, due_date, global_discount) VALUES (?, ?, ?, ?)`).run(
        docId, 
        extra.payment_method ?? null, 
        extra.due_date ?? null,
        extra.global_discount ?? 0  // ✅ FIX: إضافة global_discount
      )
      break
    case 'import_invoice':
      db.prepare(`
        INSERT INTO doc_import_invoices
          (document_id, currency, exchange_rate, invoice_amount, customs, transitaire, tva_import, other_costs, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        docId,
        extra.currency ?? 'EUR',
        extra.exchange_rate ?? 1,
        extra.invoice_amount ?? 0,
        extra.customs ?? 0,
        extra.transitaire ?? 0,
        extra.tva_import ?? 0,
        extra.other_costs ?? 0,
        extra.total_cost ?? 0
      )
      break
  }
}
