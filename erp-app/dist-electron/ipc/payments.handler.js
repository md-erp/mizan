"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPaymentHandlers = registerPaymentHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const accounting_service_1 = require("../services/accounting.service");
const audit_service_1 = require("../services/audit.service");
function registerPaymentHandlers() {
    (0, index_1.handle)('payments:getAll', (filters) => {
        const db = (0, connection_1.getDb)();
        let query = `
      SELECT p.*,
        CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
        d.number as document_number
      FROM payments p
      LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
      LEFT JOIN documents d ON d.id = p.document_id
      WHERE 1=1
    `;
        const params = [];
        if (filters?.party_id) {
            query += ' AND p.party_id = ?';
            params.push(filters.party_id);
        }
        if (filters?.party_type) {
            query += ' AND p.party_type = ?';
            params.push(filters.party_type);
        }
        if (filters?.status) {
            query += ' AND p.status = ?';
            params.push(filters.status);
        }
        if (filters?.document_id) {
            query += ' AND p.document_id = ?';
            params.push(filters.document_id);
        }
        query += ' ORDER BY p.created_at DESC, p.id DESC';
        const limit = filters?.limit ?? 200;
        const offset = filters?.offset ?? 0;
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
        return db.prepare(query).all(...params);
    });
    (0, index_1.handle)('payments:create', (data) => {
        const db = (0, connection_1.getDb)();
        const tx = db.transaction(() => {
            // ✅ المشكلة 3: التحقق من الفترة المحاسبية قبل أي إدراج
            (0, accounting_service_1.checkPeriodOpen)(db, data.date);
            // توليد رقم مرجعي بصيغة P-YY-XXXX (مثل P-26-0001)
            const payYear = new Date().getFullYear() % 100;
            const allRefs = db.prepare("SELECT reference FROM payments WHERE reference LIKE 'P-%'").all();
            // استخراج الأرقام التسلسلية من كل الصيغ (P-1، P-0001، P-26-0001)
            const usedSet = new Set(allRefs.map((r) => {
                const parts = r.reference.split('-');
                const num = parseInt(parts[parts.length - 1] ?? '0', 10);
                return isNaN(num) ? -1 : num;
            }).filter((n) => n >= 0));
            const maxSeq = usedSet.size > 0 ? Math.max(...usedSet) : 0;
            const startFrom = (data.custom_seq !== undefined && data.custom_seq >= 1)
                ? data.custom_seq
                : maxSeq + 1;
            // إذا اختار المستخدم رقماً يدوياً وكان مستخدماً → نرفض
            if (data.custom_seq !== undefined && usedSet.has(data.custom_seq)) {
                let suggestion = data.custom_seq + 1;
                while (usedSet.has(suggestion))
                    suggestion++;
                throw new Error(`Le numéro P-${payYear}-${data.custom_seq} est déjà utilisé. Prochain disponible: P-${payYear}-${suggestion}`);
            }
            // نجد أصغر رقم >= startFrom غير مستخدم
            let seq = startFrom;
            while (usedSet.has(seq))
                seq++;
            const reference = `P-${payYear}-${seq}`;
            const result = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, due_date,
          cheque_number, bank, status, document_id, notes, created_by, reference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.party_id, data.party_type, data.amount, data.method, data.date, data.due_date ?? null, data.cheque_number ?? null, data.bank ?? null, data.status ?? 'pending', data.document_id ?? null, data.notes ?? null, data.created_by ?? 1, reference);
            const paymentId = result.lastInsertRowid;
            const isCheque = data.method === 'cheque' || data.method === 'lcn';
            const isPending = (data.status ?? 'pending') === 'pending';
            // الشيك/LCN بحالة pending لا يُحسب على الفاتورة حتى يُصرف
            if (data.document_id && !(isCheque && isPending)) {
                const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(data.document_id);
                if (!doc)
                    throw new Error('Document introuvable');
                // ✅ التحقق من المبلغ المدفوع مسبقاً
                const paidRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM payment_allocations 
          WHERE document_id = ?
        `).get(data.document_id);
                const remainingAmount = doc.total_ttc - paidRow.total;
                // ✅ التحقق من أن المبلغ الجديد لا يتجاوز المتبقي (مع تسامح 1 سنتيم)
                if (data.amount > remainingAmount + 0.01) {
                    throw new Error(`Le montant (${data.amount.toFixed(2)} MAD) dépasse le reste à payer de la facture (${remainingAmount.toFixed(2)} MAD)`);
                }
                // ✅ التحقق من أن المبلغ موجب
                if (data.amount <= 0) {
                    throw new Error('Le montant du paiement doit être supérieur à 0');
                }
                db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(paymentId, data.document_id, data.amount);
                updateInvoicePaymentStatus(db, data.document_id);
            }
            // قيد محاسبي تلقائي فقط للمدفوعات الفعلية (ليس الشيكات المعلقة)
            if (!(isCheque && isPending)) {
                (0, accounting_service_1.createPaymentEntry)(db, {
                    id: paymentId,
                    party_id: data.party_id,
                    party_type: data.party_type,
                    amount: data.amount,
                    method: data.method,
                    date: data.date,
                    reference: reference,
                    status: data.status ?? 'pending',
                }, data.created_by ?? 1);
            }
            (0, audit_service_1.logAudit)(db, {
                user_id: data.created_by ?? 1,
                action: 'PAYMENT',
                table_name: 'payments',
                record_id: paymentId,
                new_values: { amount: data.amount, method: data.method, party_type: data.party_type },
            });
            return { id: paymentId };
        });
        return tx();
    });
    (0, index_1.handle)('payments:update', (data) => {
        const db = (0, connection_1.getDb)();
        const tx = db.transaction(() => {
            const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(data.id);
            if (!payment)
                throw new Error('Paiement introuvable');
            // ✅ المشكلة 3: التحقق من الفترة المحاسبية قبل أي تعديل
            // نتحقق من تاريخ الدفعة الأصلي (payment.date) لأن التعديل يؤثر على نفس الفترة
            (0, accounting_service_1.checkPeriodOpen)(db, payment.date);
            db.prepare(`UPDATE payments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(data.status, data.id);
            const isCheque = payment.method === 'cheque' || payment.method === 'lcn';
            // عند تحويل شيك من pending إلى cleared → تطبيق على الفاتورة + قيد محاسبي
            if (isCheque && payment.status === 'pending' && data.status === 'cleared') {
                if (payment.document_id) {
                    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id = ?').get(payment.document_id);
                    const paidRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(payment.document_id);
                    if (doc && (paidRow.total + payment.amount) > doc.total_ttc + 0.01) {
                        throw new Error(`Le montant du chèque dépasse le reste à payer de la facture`);
                    }
                    const existing = db.prepare('SELECT id FROM payment_allocations WHERE payment_id = ?').get(data.id);
                    if (!existing) {
                        db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(data.id, payment.document_id, payment.amount);
                        updateInvoicePaymentStatus(db, payment.document_id);
                    }
                }
                (0, accounting_service_1.createPaymentEntry)(db, {
                    id: payment.id,
                    party_id: payment.party_id,
                    party_type: payment.party_type,
                    amount: payment.amount,
                    method: payment.method,
                    date: new Date().toISOString().split('T')[0],
                    reference: payment.reference ?? `P-${payment.id}`,
                    status: 'cleared',
                }, 1);
            }
            // عند إلغاء شيك cleared → إلغاء التخصيص + قيد عكسي
            if (isCheque && payment.status === 'cleared' && data.status === 'bounced') {
                db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(data.id);
                if (payment.document_id)
                    updateInvoicePaymentStatus(db, payment.document_id);
                // قيد عكسي للقيد المحاسبي الأصلي (الشيك كان cleared → ينعكس)
                const clearedEntry = db.prepare(`
          SELECT id FROM journal_entries WHERE source_type = 'payment' AND source_id = ?
        `).get(data.id);
                if (clearedEntry) {
                    const entryLines = db.prepare(`SELECT account_id, debit, credit, notes FROM journal_lines WHERE entry_id = ?`).all(clearedEntry.id);
                    const reverseDate = new Date().toISOString().split('T')[0];
                    const reverseRef = `BOUNCE-${payment.reference ?? `P-${data.id}`}`;
                    const reverseEntry = db.prepare(`
            INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
            VALUES (?, ?, ?, 1, 'payment', ?, 1)
          `).run(reverseDate, reverseRef, `Chèque impayé: ${payment.reference ?? `P-${data.id}`}`, data.id);
                    const newEntryId = reverseEntry.lastInsertRowid;
                    for (const line of entryLines) {
                        db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)`).run(newEntryId, line.account_id, line.credit, line.debit, `Impayé: ${line.notes ?? ''}`);
                    }
                }
            }
            return { success: true };
        });
        return tx();
    });
    (0, index_1.handle)('payments:getPaidAmount', (documentId) => {
        const db = (0, connection_1.getDb)();
        // نستثني الدفعات الملغية فقط
        const row = db.prepare(`
      SELECT COALESCE(SUM(pa.amount), 0) as total
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE pa.document_id = ?
        AND p.status != 'cancelled'
    `).get(documentId);
        return { total: row?.total ?? 0 };
    });
    // ✅ المشكلة 3: إلغاء الدفعات النقدية والبنكية
    (0, index_1.handle)('payments:cancel', (data) => {
        const db = (0, connection_1.getDb)();
        const userId = data.userId ?? 1;
        const tx = db.transaction(() => {
            const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(data.id);
            if (!payment)
                throw new Error('Paiement introuvable');
            if (payment.status === 'cancelled')
                throw new Error('Paiement déjà annulé');
            // ✅ التحقق من الفترة المحاسبية
            (0, accounting_service_1.checkPeriodOpen)(db, payment.date);
            // 1. تحديث حالة الدفعة إلى cancelled
            db.prepare(`UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(data.id);
            // 2. إنشاء قيد عكسي للقيد المحاسبي الأصلي
            // نبحث عن القيد المرتبط بهذه الدفعة
            const paymentEntry = db.prepare(`
        SELECT id, reference FROM journal_entries 
        WHERE source_type = 'payment' AND source_id = ?
      `).get(data.id);
            if (paymentEntry) {
                // إنشاء قيد عكسي
                const entryLines = db.prepare(`
          SELECT jl.account_id, jl.debit, jl.credit, jl.notes
          FROM journal_lines jl
          WHERE jl.entry_id = ?
        `).all(paymentEntry.id);
                const reverseDate = new Date().toISOString().split('T')[0];
                const reverseRef = `ANNUL-${payment.reference ?? `P-${data.id}`}`;
                const reverseDesc = `Annulation paiement: ${payment.reference ?? `P-${data.id}`}`;
                const reverseEntry = db.prepare(`
          INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
          VALUES (?, ?, ?, 1, 'payment', ?, ?)
        `).run(reverseDate, reverseRef, reverseDesc, data.id, userId);
                const newEntryId = reverseEntry.lastInsertRowid;
                // إنشاء خطوط القيد العكسي
                for (const line of entryLines) {
                    db.prepare(`
            INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, ?, ?, ?)
          `).run(newEntryId, line.account_id, line.credit, // عكس
                    line.debit, // عكس
                    `Annulation: ${line.notes ?? ''}`);
                }
                console.log(`[PAYMENTS] قيد عكسي ${reverseRef} للدفعة ${payment.reference}`);
            }
            // 3. حذف التخصيصات (payment_allocations)
            const allocations = db.prepare('SELECT document_id FROM payment_allocations WHERE payment_id = ?').all(data.id);
            db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(data.id);
            // 4. إعادة حساب حالة الفواتير المرتبطة
            for (const alloc of allocations) {
                if (alloc.document_id) {
                    updateInvoicePaymentStatus(db, alloc.document_id);
                }
            }
            // 5. تسجيل في audit_log
            (0, audit_service_1.logAudit)(db, {
                user_id: userId,
                action: 'CANCEL',
                table_name: 'payments',
                record_id: data.id,
                old_values: {
                    amount: payment.amount,
                    method: payment.method,
                    party_type: payment.party_type,
                    status: payment.status,
                    reference: payment.reference,
                },
                reason: data.reason ?? 'Annulation paiement',
            });
            return { success: true };
        });
        return tx();
    });
}
function updateInvoicePaymentStatus(db, documentId) {
    const doc = db.prepare('SELECT total_ttc, type, status FROM documents WHERE id = ?').get(documentId);
    if (!doc || doc.status === 'cancelled')
        return;
    const paid = db.prepare(`
    SELECT COALESCE(SUM(pa.amount), 0) as total
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.document_id = ? AND p.status NOT IN ('cancelled', 'bounced')
  `).get(documentId).total;
    let payStatus = 'unpaid';
    if (paid >= doc.total_ttc - 0.01)
        payStatus = 'paid';
    else if (paid > 0)
        payStatus = 'partial';
    // تحديث الجدول الفرعي المناسب
    if (doc.type === 'invoice') {
        db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId);
    }
    else if (doc.type === 'purchase_invoice') {
        db.prepare('UPDATE doc_purchase_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId);
    }
    else if (doc.type === 'import_invoice') {
        db.prepare('UPDATE doc_import_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId);
    }
    // تحديث حالة المستند الرئيسي
    if (payStatus === 'paid') {
        // مدفوع بالكامل — دائماً paid بغض النظر عن حالة التوصيل
        db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
    }
    else if (payStatus === 'partial') {
        // دفع جزئي — لا نغير delivered إلى partial
        if (!['delivered', 'paid'].includes(doc.status)) {
            db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
        }
    }
    else {
        // ✅ لا دفع → إعادة إلى confirmed أو unpaid
        if (['paid', 'partial'].includes(doc.status)) {
            // إذا كانت الفاتورة delivered نحافظ عليها، وإلا نعيدها إلى confirmed
            const newStatus = doc.status === 'delivered' ? 'delivered' : 'confirmed';
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, documentId);
        }
    }
}
