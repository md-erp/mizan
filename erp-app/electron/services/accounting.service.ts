import Database from 'better-sqlite3'

// ==========================================
// AUTOMATIC JOURNAL ENTRIES
// القيود المحاسبية التلقائية — مبنية على CGNC المغربي
// ==========================================

interface DocLine {
  product_id: number | null
  quantity: number
  unit_price: number
  tva_rate: number
  total_ht: number
  total_tva: number
  total_ttc: number
}

interface Document {
  id: number
  type: string
  number: string
  date: string
  party_id: number
  party_type: string
  total_ht: number
  total_tva: number
  total_ttc: number
  status?: string  // إضافة خاصية الحالة
}

export function createAccountingEntry(
  db: Database.Database,
  doc: Document,
  lines: DocLine[],
  userId: number
): number | null {
  // ✅ التحقق من حالة المستند - مبدأ الحيطة والحذر (CGNC)
  // لا ننشئ قيود محاسبية للمستندات الملغية أو المحذوفة
  if (doc.status === 'cancelled' || doc.status === 'deleted') {
    console.log(`[ACCOUNTING] تخطي إنشاء قيد محاسبي للمستند ${doc.number} - الحالة: ${doc.status}`)
    return null
  }

  // ✅ التحقق من وجود قيد محاسبي مسبق لتجنب التكرار
  const existingEntry = db.prepare(`
    SELECT id FROM journal_entries 
    WHERE source_type = ? AND source_id = ?
  `).get(doc.type, doc.id) as any

  if (existingEntry) {
    console.log(`[ACCOUNTING] قيد محاسبي موجود مسبقاً للمستند ${doc.number} - ID: ${existingEntry.id}`)
    return existingEntry.id
  }

  const handler = ENTRY_HANDLERS[doc.type]
  if (!handler) return null
  
  console.log(`[ACCOUNTING] إنشاء قيد محاسبي للمستند ${doc.number} - النوع: ${doc.type}`)
  return handler(db, doc, lines, userId)
}

// ==========================================
// إنشاء قيود عكسية (Contre-passation) للمستندات الملغية
// تطبيق مبدأ الحيطة والحذر حسب CGNC
// ==========================================

/**
 * ينشئ قيوداً عكسية (contre-passation) للقيود المحاسبية المرتبطة بمستند ملغي.
 * 
 * بدلاً من حذف القيود الأصلية، ننشئ قيوداً جديدة بنفس المبالغ معكوسة
 * (المدين يصبح دائن والدائن يصبح مدين) مع وصف "Annulation: [رقم المستند]"
 * 
 * هذا يحافظ على:
 * - السجل المحاسبي الكامل (audit trail)
 * - الامتثال لمعايير CGNC المغربية
 * - إمكانية تتبع جميع العمليات
 */
export function createReverseAccountingEntries(
  db: Database.Database,
  docType: string,
  docId: number,
  docNumber: string,
  userId: number = 1
): void {
  // جلب القيود المرتبطة بالمستند
  const entries = db.prepare(`
    SELECT id, date, reference, description, is_auto, source_type, source_id, created_by, created_at
    FROM journal_entries
    WHERE source_type = ? AND source_id = ?
      AND reference NOT LIKE 'ANNUL-%'
  `).all(docType, docId) as any[]

  if (entries.length === 0) {
    console.log(`[ACCOUNTING] لا توجد قيود محاسبية للمستند ${docNumber}`)
    return
  }

  // ─── Transaction واحدة: إنشاء القيود العكسية ───────────────
  const transaction = db.transaction(() => {
    for (const entry of entries) {
      // 1. جلب خطوط القيد الأصلي
      const entryLines = db.prepare(`
        SELECT jl.id, jl.account_id, a.code as account_code, a.name as account_name,
               jl.debit, jl.credit, jl.notes
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
      `).all(entry.id) as any[]

      // 2. إنشاء قيد عكسي جديد
      const reverseDate = new Date().toISOString().split('T')[0]
      const reverseRef = `ANNUL-${entry.reference ?? docNumber}`
      const reverseDesc = `Annulation: ${entry.description ?? docNumber}`

      const reverseEntry = db.prepare(`
        INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(reverseDate, reverseRef, reverseDesc, docType, docId, userId)

      const newEntryId = reverseEntry.lastInsertRowid as number

      // 3. إنشاء خطوط القيد العكسي (عكس المدين والدائن)
      for (const line of entryLines) {
        db.prepare(`
          INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          newEntryId,
          line.account_id,
          line.credit, // الدائن يصبح مدين
          line.debit,  // المدين يصبح دائن
          `Annulation: ${line.notes ?? ''}`
        )
      }

      // 4. تسجيل في audit_log
      db.prepare(`
        INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        'REVERSE_JOURNAL_ENTRY',
        'journal_entries',
        entry.id,
        JSON.stringify({
          original_entry_id: entry.id,
          original_reference: entry.reference,
          lines: entryLines.map(l => ({
            account_code: l.account_code,
            debit: l.debit,
            credit: l.credit,
          })),
        }),
        JSON.stringify({
          reverse_entry_id: newEntryId,
          reverse_reference: reverseRef,
          lines: entryLines.map(l => ({
            account_code: l.account_code,
            debit: l.credit,  // معكوس
            credit: l.debit,  // معكوس
          })),
        }),
        `Contre-passation pour annulation document ${docNumber}`
      )

      console.log(`[ACCOUNTING] قيد عكسي ${reverseRef} للقيد الأصلي ${entry.reference} (entry_id=${newEntryId})`)
    }
  })

  try {
    transaction()
    console.log(`[ACCOUNTING] تم إنشاء ${entries.length} قيد عكسي للمستند ${docNumber}`)
  } catch (error) {
    // ─── سجّل الخطأ في audit_log ثم ارمِ exception واضح ───────────────
    try {
      db.prepare(`
        INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, reason)
        VALUES (?, 'ERROR', 'journal_entries', ?, ?, ?)
      `).run(
        userId,
        docId,
        JSON.stringify({ docType, docNumber, error: (error as Error).message }),
        `ÉCHEC création écritures de contre-passation — annulation document ${docNumber} avortée`
      )
    } catch {
      // إذا فشل حتى التسجيل — نتجاهل لأننا سنرمي الخطأ الأصلي على أي حال
    }
    console.error(`[ACCOUNTING] فشل إنشاء القيود العكسية للمستند ${docNumber}:`, error)
    throw new Error(
      `Échec de la création des écritures de contre-passation du document ${docNumber} — annulation avortée. Détail: ${(error as Error).message}`
    )
  }
}

/**
 * دالة قديمة للتوافق مع الكود الموجود - تستدعي الدالة الجديدة
 * @deprecated استخدم createReverseAccountingEntries بدلاً منها
 */
export function deleteAccountingEntriesForCancelledDocument(
  db: Database.Database,
  docType: string,
  docId: number,
  docNumber: string,
  userId: number = 1
): void {
  createReverseAccountingEntries(db, docType, docId, docNumber, userId)
}

// ==========================================
// VÉRIFICATION DE LA PÉRIODE COMPTABLE
// Refuse toute écriture dans une période fermée ou verrouillée (CGNC)
// ==========================================

/**
 * Vérifie qu'une date tombe dans une période comptable ouverte.
 * Lance une erreur si la période est closed ou locked.
 * Si aucune période n'est définie pour cette date, on laisse passer
 * (comportement permissif pour les entreprises sans périodes configurées).
 */
export function checkPeriodOpen(db: Database.Database, date: string): void {
  const period = db.prepare(`
    SELECT id, name, status
    FROM accounting_periods
    WHERE start_date <= ? AND end_date >= ?
    ORDER BY start_date DESC
    LIMIT 1
  `).get(date, date) as any

  if (!period) return // aucune période configurée → on laisse passer

  if (period.status === 'locked') {
    throw new Error(
      `Période comptable verrouillée — impossible de créer des écritures dans la période "${period.name}". Contactez l'administrateur.`
    )
  }
  if (period.status === 'closed') {
    throw new Error(
      `Période comptable clôturée — impossible de créer des écritures dans la période "${period.name}". Rouvrez la période ou choisissez une autre date.`
    )
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function roundAmt(value: number): number {
  return round(value, 2)
}

function roundQty(value: number): number {
  return round(value, 4)
}
// المراجع: Plan Comptable Marocain + CGNC
// ==========================================
const ACC = {
  // Classe 3 — Actif circulant
  CLIENTS:          '3421',  // Clients (342 Clients et comptes rattachés)
  EFFETS_RECEVOIR:  '3425',  // Effets à recevoir (LCN, chèques clients)
  TVA_RECUPERABLE:  '3455',  // État — TVA récupérable sur charges (34552)
  CREDIT_TVA:       '3456',  // État — Crédit de TVA (suivant déclaration)
  STOCK_MATIERES:   '3121',  // Matières premières (stock)
  STOCK_PRODUITS:   '3151',  // Produits finis (stock)

  // Classe 4 — Passif circulant
  FOURNISSEURS:     '4411',  // Fournisseurs (441 Fournisseurs et comptes rattachés)
  EFFETS_PAYER:     '4415',  // Effets à payer (LCN, chèques fournisseurs)
  TVA_FACTUREE:     '4455',  // État — TVA facturée
  TVA_DUE:          '4456',  // État — TVA due (suivant déclarations)
  DETTES_DIVERS:    '4481',  // Dettes sur acquisitions (douanes, transitaire, etc.)

  // Classe 5 — Trésorerie
  BANQUE:           '5141',  // Banques (solde débiteur)
  CAISSE:           '5161',  // Caisses

  // Classe 6 — Charges
  ACHATS_MARCH:     '6111',  // Achats de marchandises (négoce)
  ACHATS_MATIERES:  '6121',  // Achats de matières premières (industrie/production)

  // Classe 7 — Produits
  VENTES_MARCH:     '7111',  // Ventes de marchandises au Maroc
  VENTES_PRODUITS:  '7121',  // Ventes de biens produits (produits finis)
  VARIATION_STOCKS: '7131',  // Variation des stocks de produits en cours
}

function getAccountId(db: Database.Database, code: string): number {
  const row = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as any
  if (!row) throw new Error(`Compte ${code} introuvable dans le plan comptable`)
  return row.id
}

function insertEntry(
  db: Database.Database,
  doc: Document,
  description: string,
  lines: Array<{ accountCode: string; debit: number; credit: number; notes?: string }>,
  userId: number
): number {
  // ✅ التحقق من أن الفترة المحاسبية مفتوحة قبل أي إدراج
  checkPeriodOpen(db, doc.date)

  // ✅ المشكلة 4: ملء period_id تلقائياً بالفترة المقابلة للتاريخ
  // إذا لم توجد فترة → period_id = null (سلوك متساهل — لا نوقف العملية)
  const periodRow = db.prepare(`
    SELECT id FROM accounting_periods
    WHERE start_date <= ? AND end_date >= ?
      AND status != 'locked'
    ORDER BY start_date DESC
    LIMIT 1
  `).get(doc.date, doc.date) as any

  const periodId: number | null = periodRow?.id ?? null

  if (!periodId) {
    // تحذير في audit_log — لا نوقف العملية
    try {
      db.prepare(`
        INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, reason)
        VALUES (?, 'ERROR', 'journal_entries', NULL, ?, ?)
      `).run(
        userId,
        JSON.stringify({ doc_number: doc.number, doc_date: doc.date }),
        `Aucune période comptable ouverte pour la date ${doc.date} — period_id non renseigné`
      )
    } catch { /* audit ne bloque jamais */ }
    console.warn(`[ACCOUNTING] ⚠️ Aucune période pour la date ${doc.date} — period_id sera NULL pour le document ${doc.number}`)
  }

  const entry = db.prepare(`
    INSERT INTO journal_entries (date, period_id, reference, description, is_auto, source_type, source_id, created_by)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(doc.date, periodId, doc.number, description, doc.type, doc.id, userId)

  const entryId = entry.lastInsertRowid as number

  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) continue
    db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(entryId, getAccountId(db, line.accountCode), line.debit, line.credit, line.notes ?? null)
  }

  return entryId
}

// ==========================================
// HANDLERS PAR TYPE DE DOCUMENT
// ==========================================
const ENTRY_HANDLERS: Record<
  string,
  (db: Database.Database, doc: Document, lines: DocLine[], userId: number) => number
> = {

  // ① Facture client confirmée
  invoice: (db, doc, lines, userId) => {
    // TVA groupée par taux
    const tvaByRate = groupTvaByRate(lines)

    const entryLines = [
      { accountCode: ACC.CLIENTS, debit: doc.total_ttc, credit: 0 },
      { accountCode: ACC.VENTES_MARCH, debit: 0, credit: doc.total_ht },
      ...tvaByRate.map(t => ({
        accountCode: ACC.TVA_FACTUREE,
        debit: 0,
        credit: t.amount,
        notes: `TVA ${t.rate}%`,
      })),
    ]

    return insertEntry(db, doc, `Facture client ${doc.number}`, entryLines, userId)
  },

  // ③ Facture fournisseur local
  purchase_invoice: (db, doc, lines, userId) => {
    const tvaByRate = groupTvaByRate(lines)

    const entryLines = [
      { accountCode: ACC.ACHATS_MATIERES, debit: doc.total_ht, credit: 0 },
      ...tvaByRate.map(t => ({
        accountCode: ACC.TVA_RECUPERABLE,
        debit: t.amount,
        credit: 0,
        notes: `TVA ${t.rate}%`,
      })),
      { accountCode: ACC.FOURNISSEURS, debit: 0, credit: doc.total_ttc },
    ]

    return insertEntry(db, doc, `Facture fournisseur ${doc.number}`, entryLines, userId)
  },

  // ④ Bon de Réception
  bl_reception: (db, doc, lines, userId) => {
    const tvaByRate = groupTvaByRate(lines)

    const entryLines = [
      { accountCode: ACC.STOCK_MATIERES, debit: doc.total_ht, credit: 0 },
      ...tvaByRate.map(t => ({
        accountCode: ACC.TVA_RECUPERABLE,
        debit: t.amount,
        credit: 0,
        notes: `TVA ${t.rate}%`,
      })),
      { accountCode: ACC.FOURNISSEURS, debit: 0, credit: doc.total_ttc },
    ]

    return insertEntry(db, doc, `Bon de réception ${doc.number}`, entryLines, userId)
  },

  // ⑤ Facture d'importation (Landed Cost)
  import_invoice: (db, doc, _lines, userId) => {
    const imp = db.prepare('SELECT * FROM doc_import_invoices WHERE document_id = ?').get(doc.id) as any
    if (!imp) return insertEntry(db, doc, `Import ${doc.number}`, [], userId)

    const invoiceMAD = (imp.invoice_amount ?? 0) * (imp.exchange_rate ?? 1)
    const totalCost  = imp.total_cost ?? doc.total_ttc

    const entryLines = [
      // Stock (Débit) = coût total sans TVA import
      { accountCode: ACC.STOCK_MATIERES, debit: totalCost - (imp.tva_import ?? 0), credit: 0 },
      // TVA import récupérable (Débit)
      ...(imp.tva_import > 0 ? [{ accountCode: ACC.TVA_RECUPERABLE, debit: imp.tva_import, credit: 0, notes: 'TVA import' }] : []),
      // Fournisseur étranger (Crédit)
      { accountCode: ACC.FOURNISSEURS, debit: 0, credit: invoiceMAD },
      // Douanes (Crédit)
      ...(imp.customs > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.customs, notes: 'Douanes' }] : []),
      // Transitaire (Crédit)
      ...(imp.transitaire > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.transitaire, notes: 'Transitaire' }] : []),
      // Autres frais (Crédit)
      ...(imp.other_costs > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.other_costs, notes: 'Autres frais' }] : []),
    ]

    return insertEntry(db, doc, `Importation ${doc.number}`, entryLines, userId)
  },

  // ⑥ Ordre de production confirmé
  // Débit: 3151 Produits finis = coût total
  // Crédit: 3121 Matières premières = Σ(matière × CMUP)
  // Crédit: 7131 Variation stocks (main d'œuvre) = labor_cost
  production: (db, doc, _lines, userId) => {
    const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(doc.id) as any
    if (!order) return insertEntry(db, doc, `Production ${doc.number}`, [], userId)

    const bom_lines = order.bom_snapshot
      ? JSON.parse(order.bom_snapshot).lines ?? []
      : db.prepare('SELECT * FROM bom_lines WHERE bom_id = ?').all(order.bom_id) as any[]

    const bom = order.bom_id
      ? db.prepare('SELECT labor_cost FROM bom_templates WHERE id = ?').get(order.bom_id) as any
      : null

    let materials_cost = 0
    for (const line of bom_lines) {
      const product = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(line.material_id) as any
      materials_cost = roundAmt(materials_cost + roundAmt(roundQty(line.quantity * order.quantity) * roundAmt(product?.cmup_price ?? 0)))
    }
    const labor_cost = roundAmt((bom?.labor_cost ?? 0) * order.quantity)
    const total_cost = roundAmt(materials_cost + labor_cost)

    const entryLines = [
      { accountCode: ACC.STOCK_PRODUITS, debit: total_cost, credit: 0, notes: `Production ${order.quantity} unités` },
      { accountCode: ACC.STOCK_MATIERES, debit: 0, credit: materials_cost, notes: 'Consommation matières' },
      ...(labor_cost > 0 ? [{ accountCode: ACC.VARIATION_STOCKS, debit: 0, credit: labor_cost, notes: 'Main d\'œuvre' }] : []),
    ]

    return insertEntry(db, doc, `Ordre de production ${doc.number}`, entryLines, userId)
  },

  // ⑦ Transformation (aluminium)
  // Débit: 3151 Produits finis = coût total transformation
  // Crédit: 3121 Matières premières = CMUP × quantité consommée
  // Crédit: 7131 Variation stocks = coût de transformation
  transformation: (db, doc, _lines, userId) => {
    const trans = db.prepare('SELECT * FROM transformations WHERE id = ?').get(doc.id) as any
    if (!trans) return insertEntry(db, doc, `Transformation ${doc.number}`, [], userId)

    const material = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(trans.raw_material_id) as any
    const material_cost  = roundAmt(roundAmt(material?.cmup_price ?? 0) * roundQty(trans.input_quantity))
    const transform_cost = roundAmt(roundAmt(trans.cost_per_unit ?? 0) * roundQty(trans.input_quantity))
    const total_cost     = roundAmt(material_cost + transform_cost)

    const entryLines = [
      { accountCode: ACC.STOCK_PRODUITS, debit: total_cost, credit: 0, notes: 'Produits transformés' },
      { accountCode: ACC.STOCK_MATIERES, debit: 0, credit: material_cost, notes: 'Matière consommée' },
      ...(transform_cost > 0 ? [{ accountCode: ACC.VARIATION_STOCKS, debit: 0, credit: transform_cost, notes: 'Coût de transformation' }] : []),
    ]

    return insertEntry(db, doc, `Transformation ${doc.number}`, entryLines, userId)
  },

  // ② Bon de Livraison (sortie stock → constatation vente)
  // Débit: 7111 Ventes = total HT
  // Débit: 4455 TVA facturée = total TVA
  // Crédit: 3151/3121 Stock = coût (CMUP × quantité)
  // Note: si BL issu d'une facture, pas de double comptabilisation des ventes
  bl: (db, doc, lines, userId) => {
    // Vérifier si ce BL est lié à une facture (éviter double comptabilisation)
    const linkedInvoice = db.prepare(`
      SELECT d.id FROM document_links dl
      JOIN documents d ON d.id = dl.parent_id
      WHERE dl.child_id = ? AND d.type = 'invoice'
    `).get(doc.id) as any

    if (linkedInvoice) {
      // BL issu d'une facture → seulement sortie stock (coût des ventes)
      let totalCmup = 0
      for (const line of lines) {
        if (!line.product_id) continue
        const product = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(line.product_id) as any
        totalCmup = roundAmt(totalCmup + roundAmt(roundAmt(product?.cmup_price ?? 0) * roundQty(line.quantity)))
      }
      if (totalCmup === 0) return insertEntry(db, doc, `BL ${doc.number}`, [], userId)
      return insertEntry(db, doc, `Livraison ${doc.number}`, [
        { accountCode: ACC.ACHATS_MARCH, debit: totalCmup, credit: 0, notes: 'Coût des ventes (CMUP)' },
        { accountCode: ACC.STOCK_PRODUITS, debit: 0, credit: totalCmup },
      ], userId)
    }

    // BL autonome (sans facture) → constate la vente + sortie stock
    const tvaByRate = groupTvaByRate(lines)
    let totalCmup = 0
    for (const line of lines) {
      if (!line.product_id) continue
      const product = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(line.product_id) as any
      totalCmup = roundAmt(totalCmup + roundAmt(roundAmt(product?.cmup_price ?? 0) * roundQty(line.quantity)))
    }

    const entryLines = [
      { accountCode: ACC.CLIENTS, debit: doc.total_ttc, credit: 0 },
      { accountCode: ACC.VENTES_MARCH, debit: 0, credit: doc.total_ht },
      ...tvaByRate.map(t => ({ accountCode: ACC.TVA_FACTUREE, debit: 0, credit: t.amount, notes: `TVA ${t.rate}%` })),
      ...(totalCmup > 0 ? [
        { accountCode: ACC.ACHATS_MARCH, debit: totalCmup, credit: 0, notes: 'Coût des ventes (CMUP)' },
        { accountCode: ACC.STOCK_PRODUITS, debit: 0, credit: totalCmup },
      ] : []),
    ]
    return insertEntry(db, doc, `Bon de livraison ${doc.number}`, entryLines, userId)
  },

  // ⑧ Avoir retour client
  avoir: (db, doc, lines, userId) => {
    const tvaByRate = groupTvaByRate(lines)

    const entryLines = [
      { accountCode: ACC.VENTES_MARCH, debit: doc.total_ht, credit: 0 },
      ...tvaByRate.map(t => ({
        accountCode: ACC.TVA_FACTUREE,
        debit: t.amount,
        credit: 0,
        notes: `TVA ${t.rate}%`,
      })),
      { accountCode: ACC.CLIENTS, debit: 0, credit: doc.total_ttc },
    ]

    return insertEntry(db, doc, `Avoir ${doc.number}`, entryLines, userId)
  },
}

// ==========================================
// PAYMENT ENTRY (② تسجيل دفعة)
// ==========================================
export function createPaymentEntry(
  db: Database.Database,
  payment: {
    id: number
    party_id: number
    party_type: string
    amount: number
    method: string
    date: string
    reference?: string
    status?: string  // 'pending' | 'cleared'
  },
  userId: number
): number {
  const isClientPayment = payment.party_type === 'client'
  const isEffect = payment.method === 'cheque' || payment.method === 'lcn'
  const isPending = payment.status === 'pending'

  const fakeDoc = {
    id: payment.id,
    type: 'payment',
    number: payment.reference ?? `P-${payment.id}`,
    date: payment.date,
    party_id: payment.party_id,
    party_type: payment.party_type,
    total_ht: payment.amount,
    total_tva: 0,
    total_ttc: payment.amount,
  }

  let entryLines: Array<{ accountCode: string; debit: number; credit: number }>

  // ✅ حسب CGNC المغربي
  if (isEffect && isPending) {
    // 🔹 LCN/Chèque بحالة pending → تحويل من Clients/Fournisseurs إلى Effets
    if (isClientPayment) {
      // استلام شيك/LCN من عميل
      entryLines = [
        { accountCode: ACC.EFFETS_RECEVOIR, debit: payment.amount, credit: 0 },
        { accountCode: ACC.CLIENTS, debit: 0, credit: payment.amount },
      ]
    } else {
      // إعطاء شيك/LCN لمورد
      entryLines = [
        { accountCode: ACC.FOURNISSEURS, debit: payment.amount, credit: 0 },
        { accountCode: ACC.EFFETS_PAYER, debit: 0, credit: payment.amount },
      ]
    }
  } else if (isEffect && !isPending) {
    // 🔹 LCN/Chèque cleared → تحويل من Effets إلى Banque
    if (isClientPayment) {
      // صرف شيك/LCN عميل
      entryLines = [
        { accountCode: ACC.BANQUE, debit: payment.amount, credit: 0 },
        { accountCode: ACC.EFFETS_RECEVOIR, debit: 0, credit: payment.amount },
      ]
    } else {
      // استحقاق شيك/LCN مورد
      entryLines = [
        { accountCode: ACC.EFFETS_PAYER, debit: payment.amount, credit: 0 },
        { accountCode: ACC.BANQUE, debit: 0, credit: payment.amount },
      ]
    }
  } else {
    // 🔹 Cash/Bank → مباشرة من/إلى Clients/Fournisseurs
    const bankAccount = payment.method === 'cash' ? ACC.CAISSE : ACC.BANQUE
    const partyAccount = isClientPayment ? ACC.CLIENTS : ACC.FOURNISSEURS

    if (isClientPayment) {
      entryLines = [
        { accountCode: bankAccount, debit: payment.amount, credit: 0 },
        { accountCode: partyAccount, debit: 0, credit: payment.amount },
      ]
    } else {
      entryLines = [
        { accountCode: partyAccount, debit: payment.amount, credit: 0 },
        { accountCode: bankAccount, debit: 0, credit: payment.amount },
      ]
    }
  }

  return insertEntry(db, fakeDoc, `Règlement ${payment.party_type} — ${payment.reference ?? ''}`, entryLines, userId)
}

// ==========================================
// HELPERS
// ==========================================
function groupTvaByRate(lines: DocLine[]): Array<{ rate: number; amount: number }> {
  const map = new Map<number, number>()
  for (const line of lines) {
    const current = map.get(line.tva_rate) ?? 0
    map.set(line.tva_rate, roundAmt(current + line.total_tva))
  }
  return Array.from(map.entries()).map(([rate, amount]) => ({ rate, amount }))
}
