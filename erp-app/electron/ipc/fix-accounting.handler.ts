/**
 * معالج إصلاح المحاسبة - إنشاء القيود العكسية للفواتير الملغية
 */

import { handle } from './index'
import { getDb } from '../database/connection'

export function registerFixAccountingHandlers(): void {
  
  // إصلاح الفواتير الملغية - حذف القيود المحاسبية (النهج الصحيح حسب CGNC)
  handle('fix:cancelledInvoicesAccounting', () => {
    const db = getDb()
    
    try {
      console.log('🔍 تطبيق الإصلاح الشامل للمحاسبة حسب معايير CGNC...')
      
      // البحث عن المستندات الملغية التي لديها قيود محاسبية
      const cancelledDocsWithEntries = db.prepare(`
        SELECT 
          d.id, d.number, d.type, d.status, d.total_ttc,
          je.id as entry_id, je.reference, je.description,
          COUNT(jl.id) as line_count
        FROM documents d
        JOIN journal_entries je ON je.source_type = d.type AND je.source_id = d.id
        LEFT JOIN journal_lines jl ON jl.entry_id = je.id
        WHERE d.status = 'cancelled' AND d.is_deleted = 0
        GROUP BY d.id, je.id
        ORDER BY d.number
      `).all() as any[]

      console.log(`📊 تم العثور على ${cancelledDocsWithEntries.length} قيد محاسبي للمستندات الملغية`)

      if (cancelledDocsWithEntries.length === 0) {
        return {
          success: true,
          message: 'النظام متوافق مع معايير CGNC - لا توجد قيود محاسبية للمستندات الملغية',
          fixed: 0,
          details: [],
          compliant: true
        }
      }

      const results: any[] = []
      let deletedEntries = 0
      let deletedLines = 0

      // معاملة واحدة لحذف جميع القيود
      const transaction = db.transaction(() => {
        for (const entry of cancelledDocsWithEntries) {
          try {
            console.log(`🗑️  حذف قيد محاسبي للمستند الملغي: ${entry.number}`)
            
            // حذف خطوط القيد أولاً
            const linesResult = db.prepare(`
              DELETE FROM journal_lines WHERE entry_id = ?
            `).run(entry.entry_id)

            // حذف القيد الرئيسي
            const entryResult = db.prepare(`
              DELETE FROM journal_entries WHERE id = ?
            `).run(entry.entry_id)

            deletedLines += linesResult.changes
            deletedEntries += entryResult.changes

            results.push({
              document: entry.number,
              status: 'تم الحذف',
              reason: `حُذف قيد ${entry.reference} - ${entry.line_count} خطوط`,
              amount: entry.total_ttc
            })

            console.log(`✅ تم حذف قيد ${entry.reference} للمستند ${entry.number}`)

          } catch (error) {
            console.error(`❌ خطأ في حذف قيد المستند ${entry.number}:`, error)
            results.push({
              document: entry.number,
              status: 'خطأ',
              reason: error instanceof Error ? error.message : 'خطأ غير معروف',
              amount: entry.total_ttc
            })
          }
        }
      })

      // تنفيذ المعاملة
      transaction()

      // التحقق من التوازن المحاسبي النهائي
      const finalBalance = db.prepare(`
        SELECT 
          a.code,
          a.name,
          COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_lines jl ON jl.account_id = a.id
        LEFT JOIN journal_entries je ON je.id = jl.entry_id
        WHERE a.code IN ('3421', '7111', '4455')
        GROUP BY a.id
        HAVING ABS(balance) > 0.01
        ORDER BY a.code
      `).all() as any[]

      const totalImbalance = finalBalance.reduce((sum, acc) => sum + Math.abs(acc.balance), 0)

      return {
        success: true,
        message: `تم حذف ${deletedEntries} قيد محاسبي للمستندات الملغية - النظام الآن متوافق مع معايير CGNC`,
        fixed: deletedEntries,
        total: cancelledDocsWithEntries.length,
        details: results,
        deletedLines: deletedLines,
        finalBalance: finalBalance,
        balanced: totalImbalance < 0.01,
        complianceNote: 'تم تطبيق مبدأ الحيطة والحذر - لا قيود محاسبية للمستندات الملغية'
      }

    } catch (error) {
      console.error('❌ خطأ أثناء إصلاح المحاسبة:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'خطأ غير معروف',
        fixed: 0,
        details: []
      }
    }
  })

  // التحقق من حالة الفواتير الملغية - النهج الجديد حسب CGNC
  handle('fix:checkCancelledInvoicesStatus', () => {
    const db = getDb()
    
    try {
      // إحصائيات المستندات الملغية
      const stats = db.prepare(`
        SELECT 
          COUNT(DISTINCT d.id) as total_cancelled,
          COUNT(DISTINCT CASE WHEN je.id IS NOT NULL THEN d.id END) as with_accounting_entries,
          COUNT(DISTINCT CASE WHEN je.id IS NULL THEN d.id END) as without_accounting_entries
        FROM documents d
        LEFT JOIN journal_entries je ON je.source_type = d.type AND je.source_id = d.id
        WHERE d.status = 'cancelled' AND d.is_deleted = 0 AND d.type IN ('invoice', 'purchase_invoice', 'bl', 'avoir')
      `).get() as any

      // قائمة المستندات الملغية التي لديها قيود محاسبية (مخالفة لمعايير CGNC)
      const nonCompliantDocs = db.prepare(`
        SELECT d.number, d.type, d.total_ttc, d.date, je.reference
        FROM documents d
        JOIN journal_entries je ON je.source_type = d.type AND je.source_id = d.id
        WHERE d.status = 'cancelled' AND d.is_deleted = 0
        ORDER BY d.date DESC
      `).all() as any[]

      // أرصدة الحسابات المتأثرة
      const accountBalances = db.prepare(`
        SELECT 
          a.code,
          a.name,
          COALESCE(SUM(jl.debit), 0) as total_debit,
          COALESCE(SUM(jl.credit), 0) as total_credit,
          COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_lines jl ON jl.account_id = a.id
        LEFT JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN documents d ON d.type = je.source_type AND d.id = je.source_id AND d.status = 'cancelled'
        WHERE a.code IN ('3421', '7111', '4455') AND d.id IS NOT NULL
        GROUP BY a.id
        HAVING ABS(balance) > 0.01
        ORDER BY a.code
      `).all() as any[]

      const complianceRate = stats.total_cancelled > 0 
        ? ((stats.without_accounting_entries / stats.total_cancelled) * 100).toFixed(1)
        : '100'

      return {
        success: true,
        stats: {
          total_cancelled: stats.total_cancelled,
          with_accounting_entries: stats.with_accounting_entries,
          without_accounting_entries: stats.without_accounting_entries,
          compliance_rate: complianceRate
        },
        non_compliant_docs: nonCompliantDocs,
        account_balances: accountBalances,
        needs_fix_count: nonCompliantDocs.length,
        is_cgnc_compliant: nonCompliantDocs.length === 0,
        recommendation: nonCompliantDocs.length > 0 
          ? 'يُنصح بحذف القيود المحاسبية للمستندات الملغية لضمان الامتثال لمعايير CGNC'
          : 'النظام متوافق مع معايير CGNC - مبدأ الحيطة والحذر مُطبق بشكل صحيح'
      }

    } catch (error) {
      console.error('❌ خطأ في التحقق من حالة الفواتير:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'خطأ غير معروف'
      }
    }
  })
}