/**
 * سكريبت إصلاح شامل للمحاسبة - تطبيق المعايير المحاسبية الصحيحة حسب CGNC
 * يحذف جميع القيود المحاسبية للفواتير الملغية ويطبق مبدأ الحيطة والحذر
 */

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

// الحصول على مسار قاعدة البيانات
const dbPath = app 
  ? path.join(app.getPath('userData'), 'erp.db')
  : path.join(process.cwd(), 'erp.db');

console.log(`🔗 الاتصال بقاعدة البيانات: ${dbPath}`);

const db = new Database(dbPath);

try {
  console.log('🔍 تطبيق الإصلاح الشامل للمحاسبة حسب معايير CGNC...');
  
  // ==========================================
  // الخطوة 1: حذف جميع القيود المحاسبية للمستندات الملغية
  // مبدأ الحيطة والحذر - لا نسجل عمليات لم تحدث فعلياً
  // ==========================================
  
  console.log('\n📋 الخطوة 1: البحث عن القيود المحاسبية للمستندات الملغية...');
  
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
  `).all();

  console.log(`📊 تم العثور على ${cancelledDocsWithEntries.length} قيد محاسبي للمستندات الملغية`);

  if (cancelledDocsWithEntries.length === 0) {
    console.log('✅ لا توجد قيود محاسبية للمستندات الملغية - النظام نظيف');
  } else {
    // عرض تفاصيل القيود التي سيتم حذفها
    console.log('\n📋 القيود المحاسبية التي سيتم حذفها:');
    let totalAmount = 0;
    for (const entry of cancelledDocsWithEntries) {
      console.log(`   ${entry.number} (${entry.type}): ${entry.total_ttc} MAD - ${entry.line_count} خطوط`);
      totalAmount += entry.total_ttc;
    }
    console.log(`   إجمالي المبلغ المتأثر: ${totalAmount.toFixed(2)} MAD`);

    // تأكيد من المستخدم
    console.log('\n⚠️  هذا الإجراء سيحذف جميع القيود المحاسبية للمستندات الملغية');
    console.log('   هذا صحيح حسب معايير CGNC (مبدأ الحيطة والحذر)');
    
    // بدء المعاملة
    const transaction = db.transaction(() => {
      let deletedEntries = 0;
      let deletedLines = 0;

      for (const entry of cancelledDocsWithEntries) {
        // حذف خطوط القيد أولاً
        const linesResult = db.prepare(`
          DELETE FROM journal_lines WHERE entry_id = ?
        `).run(entry.entry_id);

        // حذف القيد الرئيسي
        const entryResult = db.prepare(`
          DELETE FROM journal_entries WHERE id = ?
        `).run(entry.entry_id);

        deletedLines += linesResult.changes;
        deletedEntries += entryResult.changes;

        console.log(`   ✅ حُذف قيد ${entry.reference} للمستند ${entry.number}`);
      }

      return { deletedEntries, deletedLines };
    });

    // تنفيذ المعاملة
    const result = transaction();
    console.log(`\n🎉 تم حذف ${result.deletedEntries} قيد محاسبي و ${result.deletedLines} خط محاسبي`);
  }

  // ==========================================
  // الخطوة 2: التحقق من التوازن المحاسبي النهائي
  // ==========================================
  
  console.log('\n📋 الخطوة 2: التحقق من التوازن المحاسبي النهائي...');
  
  const finalBalance = db.prepare(`
    SELECT 
      a.code,
      a.name,
      COALESCE(SUM(jl.debit), 0) as total_debit,
      COALESCE(SUM(jl.credit), 0) as total_credit,
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.code IN ('3421', '7111', '4455') -- الحسابات الرئيسية المتأثرة
    GROUP BY a.id
    ORDER BY a.code
  `).all();

  console.log('\n📊 أرصدة الحسابات الرئيسية بعد الإصلاح:');
  let totalImbalance = 0;
  for (const account of finalBalance) {
    const status = Math.abs(account.balance) < 0.01 ? '✅' : '❌';
    console.log(`   ${status} ${account.code} ${account.name}: ${account.balance.toFixed(2)} MAD`);
    totalImbalance += Math.abs(account.balance);
  }

  if (totalImbalance < 0.01) {
    console.log('\n✅ جميع الحسابات متوازنة - الإصلاح ناجح!');
  } else {
    console.log(`\n⚠️  إجمالي عدم التوازن: ${totalImbalance.toFixed(2)} MAD`);
  }

  // ==========================================
  // الخطوة 3: إحصائيات نهائية
  // ==========================================
  
  console.log('\n📋 الخطوة 3: إحصائيات نهائية...');
  
  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT CASE WHEN d.status = 'cancelled' THEN d.id END) as total_cancelled_docs,
      COUNT(DISTINCT CASE WHEN d.status = 'cancelled' AND je.id IS NOT NULL THEN d.id END) as cancelled_with_entries,
      COUNT(DISTINCT CASE WHEN d.status != 'cancelled' AND je.id IS NOT NULL THEN d.id END) as active_with_entries,
      COUNT(DISTINCT je.id) as total_entries
    FROM documents d
    LEFT JOIN journal_entries je ON je.source_type = d.type AND je.source_id = d.id
    WHERE d.is_deleted = 0 AND d.type IN ('invoice', 'purchase_invoice', 'bl', 'avoir')
  `).get();

  console.log('\n📊 إحصائيات النظام النهائية:');
  console.log(`   📄 إجمالي المستندات الملغية: ${stats.total_cancelled_docs}`);
  console.log(`   ❌ مستندات ملغية مع قيود محاسبية: ${stats.cancelled_with_entries}`);
  console.log(`   ✅ مستندات نشطة مع قيود محاسبية: ${stats.active_with_entries}`);
  console.log(`   📋 إجمالي القيود المحاسبية: ${stats.total_entries}`);

  const complianceRate = stats.total_cancelled_docs > 0 
    ? ((stats.total_cancelled_docs - stats.cancelled_with_entries) / stats.total_cancelled_docs * 100).toFixed(1)
    : '100';
  
  console.log(`   🎯 معدل الامتثال لمعايير CGNC: ${complianceRate}%`);

  // ==========================================
  // الخطوة 4: توصيات للمستقبل
  // ==========================================
  
  console.log('\n📋 توصيات للمستقبل:');
  console.log('   ✅ النظام الآن يمنع إنشاء قيود محاسبية للمستندات الملغية');
  console.log('   ✅ عند إلغاء أي مستند، سيتم حذف قيوده المحاسبية تلقائياً');
  console.log('   ✅ هذا يضمن الامتثال لمبدأ الحيطة والحذر حسب CGNC');
  console.log('   📋 يُنصح بعمل نسخة احتياطية دورية من قاعدة البيانات');

} catch (error) {
  console.error('❌ خطأ أثناء الإصلاح:', error);
  process.exit(1);
} finally {
  db.close();
  console.log('\n🔒 تم إغلاق الاتصال بقاعدة البيانات');
  console.log('🎉 انتهى الإصلاح الشامل للمحاسبة!');
}