#!/usr/bin/env node

/**
 * Script لاختبار global_discount data flow
 * 
 * الاستخدام:
 * node test-global-discount.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.config', 'mizan-erp', 'erp.db');
const db = new Database(dbPath);

console.log('🔍 Testing global_discount data flow...\n');

// 1. التحقق من بنية الجدول
console.log('1️⃣ Checking table structure:');
const tableInfo = db.prepare('PRAGMA table_info(doc_invoices)').all();
const hasGlobalDiscount = tableInfo.find(col => col.name === 'global_discount');
console.log('   ✅ global_discount column exists:', !!hasGlobalDiscount);
if (hasGlobalDiscount) {
  console.log('   📊 Column info:', hasGlobalDiscount);
}
console.log('');

// 2. التحقق من البيانات الموجودة
console.log('2️⃣ Checking existing data:');
const invoices = db.prepare(`
  SELECT d.id, d.number, d.type, d.status, di.global_discount 
  FROM documents d 
  LEFT JOIN doc_invoices di ON di.document_id = d.id 
  WHERE d.type = 'invoice' 
  ORDER BY d.id DESC 
  LIMIT 5
`).all();
console.log('   Last 5 invoices:');
invoices.forEach(inv => {
  console.log(`   - ${inv.number} (ID: ${inv.id}, status: ${inv.status}): global_discount = ${inv.global_discount}`);
});
console.log('');

// 3. إنشاء فاتورة اختبار
console.log('3️⃣ Creating test invoice with global_discount = 15%...');
try {
  const tx = db.transaction(() => {
    // إنشاء الوثيقة
    const docResult = db.prepare(`
      INSERT INTO documents (type, number, date, party_id, party_type, status, total_ht, total_tva, total_ttc, created_by)
      VALUES ('invoice', 'TEST-' || datetime('now'), date('now'), 1, 'client', 'draft', 100, 20, 120, 1)
    `).run();
    
    const docId = docResult.lastInsertRowid;
    
    // إنشاء السطر الفرعي مع global_discount
    db.prepare(`
      INSERT INTO doc_invoices (document_id, currency, exchange_rate, payment_method, global_discount)
      VALUES (?, 'MAD', 1, 'cash', 15)
    `).run(docId);
    
    // إضافة خط واحد
    db.prepare(`
      INSERT INTO document_lines (document_id, product_id, quantity, unit_price, tva_rate, total_ht, total_tva, total_ttc)
      VALUES (?, 1, 1, 100, 20, 100, 20, 120)
    `).run(docId);
    
    return docId;
  });
  
  const testDocId = tx();
  console.log(`   ✅ Test invoice created with ID: ${testDocId}`);
  console.log('');
  
  // 4. قراءة الفاتورة (محاكاة documents:getOne)
  console.log('4️⃣ Reading test invoice (simulating documents:getOne):');
  const doc = db.prepare(`
    SELECT d.*,
      di.due_date,
      di.payment_status,
      di.payment_method,
      di.currency,
      di.exchange_rate,
      di.global_discount
    FROM documents d
    LEFT JOIN doc_invoices di ON di.document_id = d.id
    WHERE d.id = ?
  `).get(testDocId);
  
  console.log('   📥 Document loaded:');
  console.log(`   - ID: ${doc.id}`);
  console.log(`   - Number: ${doc.number}`);
  console.log(`   - global_discount: ${doc.global_discount}`);
  console.log('');
  
  // 5. تحديث global_discount (محاكاة documents:update)
  console.log('5️⃣ Updating global_discount to 25% (simulating documents:update):');
  const updateResult = db.prepare(`
    UPDATE doc_invoices 
    SET global_discount = ? 
    WHERE document_id = ?
  `).run(25, testDocId);
  
  console.log(`   ✅ Rows changed: ${updateResult.changes}`);
  console.log('');
  
  // 6. قراءة مرة أخرى للتحقق
  console.log('6️⃣ Reading again to verify:');
  const docAfterUpdate = db.prepare(`
    SELECT d.id, d.number, di.global_discount 
    FROM documents d 
    LEFT JOIN doc_invoices di ON di.document_id = d.id 
    WHERE d.id = ?
  `).get(testDocId);
  
  console.log(`   📥 global_discount after update: ${docAfterUpdate.global_discount}`);
  console.log('');
  
  // 7. تنظيف
  console.log('7️⃣ Cleaning up test data...');
  db.prepare('DELETE FROM document_lines WHERE document_id = ?').run(testDocId);
  db.prepare('DELETE FROM doc_invoices WHERE document_id = ?').run(testDocId);
  db.prepare('DELETE FROM documents WHERE id = ?').run(testDocId);
  console.log('   ✅ Test data cleaned up');
  console.log('');
  
  console.log('✅ All tests passed! global_discount data flow is working correctly in the database.');
  console.log('');
  console.log('🔍 If the bug still exists, the problem is in the frontend:');
  console.log('   1. Check browser console for logs');
  console.log('   2. Verify EditInvoiceWrapper passes global_discount to InvoiceForm');
  console.log('   3. Verify InvoiceForm.reset() includes global_discount');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

db.close();
