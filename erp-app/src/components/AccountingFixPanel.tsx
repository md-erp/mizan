/**
 * لوحة إصلاح المحاسبة - تطبيق معايير CGNC الصحيحة
 * حذف القيود المحاسبية للمستندات الملغية (مبدأ الحيطة والحذر)
 */

import React, { useState } from 'react'
import { fmt } from '../lib/format'

interface FixResult {
  success: boolean
  message: string
  fixed: number
  total?: number
  details?: Array<{
    document: string
    status: string
    reason: string
    amount?: number
  }>
  deletedLines?: number
  finalBalance?: Array<{
    code: string
    name: string
    balance: number
  }>
  balanced?: boolean
  complianceNote?: string
}

interface StatusResult {
  success: boolean
  stats?: {
    total_cancelled: number
    with_accounting_entries: number
    without_accounting_entries: number
    compliance_rate: string
  }
  non_compliant_docs?: Array<{
    number: string
    type: string
    total_ttc: number
    date: string
    reference: string
  }>
  account_balances?: Array<{
    code: string
    name: string
    balance: number
  }>
  needs_fix_count?: number
  is_cgnc_compliant?: boolean
  recommendation?: string
}

export default function AccountingFixPanel() {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [fixResult, setFixResult] = useState<FixResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const checkStatus = async () => {
    setChecking(true)
    try {
      const result = await (window.api as any).checkCancelledInvoicesStatus()
      setStatus((result as any).data)
    } catch (error) {
      console.error('خطأ في التحقق من الحالة:', error)
    } finally {
      setChecking(false)
    }
  }

  const runFix = async () => {
    setLoading(true)
    setFixResult(null)
    try {
      const result = await (window.api as any).fixCancelledInvoicesAccounting()
      setFixResult((result as any).data)
      await checkStatus()
    } catch (error) {
      console.error('خطأ في تشغيل الإصلاح:', error)
      setFixResult({
        success: false,
        message: 'خطأ في تشغيل الإصلاح',
        fixed: 0
      })
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    checkStatus()
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🛡️</span>
          <h2 className="text-xl font-semibold">إصلاح المحاسبة - معايير CGNC</h2>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-blue-600 mt-0.5">ℹ️</span>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">النهج الصحيح حسب معايير CGNC المغربية:</p>
              <p className="mb-2">
                <strong>مبدأ الحيطة والحذر:</strong> لا يجب تسجيل قيود محاسبية للمستندات الملغية.
                المستند الملغي لم يحدث فعلياً، لذا لا يجب أن يؤثر على الحسابات.
              </p>
              <p>
                <strong>الحل:</strong> حذف جميع القيود المحاسبية للمستندات الملغية بدلاً من إنشاء قيود عكسية.
              </p>
            </div>
          </div>
        </div>

        {/* حالة النظام */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium">حالة الامتثال لمعايير CGNC</h3>
            <button
              onClick={checkStatus}
              disabled={checking}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
            >
              <span className={checking ? 'animate-spin inline-block' : ''}>🔄</span>
              تحديث
            </button>
          </div>

          {status && status.success && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-600">{status.stats?.total_cancelled || 0}</div>
                  <div className="text-sm text-blue-800">إجمالي المستندات الملغية</div>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-600">{status.stats?.with_accounting_entries || 0}</div>
                  <div className="text-sm text-red-800">مع قيود محاسبية (مخالف)</div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">{status.stats?.without_accounting_entries || 0}</div>
                  <div className="text-sm text-green-800">بدون قيود (صحيح)</div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span>{status.is_cgnc_compliant ? '✅' : '❌'}</span>
                <span className={`font-medium ${status.is_cgnc_compliant ? 'text-green-700' : 'text-red-700'}`}>
                  معدل الامتثال لمعايير CGNC: {status.stats?.compliance_rate}%
                </span>
              </div>

              {status.recommendation && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-amber-800">{status.recommendation}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* المستندات المخالفة */}
        {status?.non_compliant_docs && status.non_compliant_docs.length > 0 && (
          <div className="mb-6">
            <h4 className="font-medium mb-3 text-red-600 flex items-center gap-2">
              <span>🗑️</span>
              مستندات ملغية مع قيود محاسبية (مخالف لمعايير CGNC):
            </h4>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-40 overflow-y-auto">
              <div className="space-y-2">
                {status.non_compliant_docs.map((doc, index) => (
                  <div key={index} className="flex justify-between items-center text-sm">
                    <span className="font-medium">{doc.number}</span>
                    <span className="text-gray-600">{fmt(doc.total_ttc)} MAD</span>
                    <span className="text-gray-500">{doc.date}</span>
                    <span className="text-xs bg-red-100 px-2 py-1 rounded">{doc.reference}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* أرصدة الحسابات المتأثرة */}
        {status?.account_balances && status.account_balances.length > 0 && (
          <div className="mb-6">
            <h4 className="font-medium mb-3 text-red-600">أرصدة الحسابات المتأثرة:</h4>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="space-y-2">
                {status.account_balances.map((account, index) => (
                  <div key={index} className="flex justify-between items-center text-sm">
                    <span className="font-medium">{account.code} - {account.name}</span>
                    <span className={`font-bold ${account.balance > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {fmt(account.balance)} MAD
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* زر الإصلاح */}
        <div className="flex items-center justify-center">
          {status?.is_cgnc_compliant ? (
            <div className="flex items-center gap-2 text-green-600">
              <span>✅</span>
              <span>النظام متوافق مع معايير CGNC - مبدأ الحيطة والحذر مُطبق بشكل صحيح</span>
            </div>
          ) : (
            <button
              onClick={runFix}
              disabled={loading || !status?.needs_fix_count}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>🗑️</span>
              {loading ? 'جاري الإصلاح...' : `حذف ${status?.needs_fix_count || 0} قيد محاسبي مخالف`}
            </button>
          )}
        </div>

        {/* نتيجة الإصلاح */}
        {fixResult && (
          <div className="mt-6">
            <div className={`border rounded-lg p-4 ${
              fixResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span>{fixResult.success ? '✅' : '❌'}</span>
                <span className={`font-medium ${
                  fixResult.success ? 'text-green-800' : 'text-red-800'
                }`}>
                  {fixResult.message}
                </span>
              </div>

              {fixResult.success && fixResult.fixed > 0 && (
                <div className="text-sm text-green-700 space-y-1">
                  <div>تم حذف {fixResult.fixed} قيد محاسبي</div>
                  {fixResult.deletedLines && (
                    <div>تم حذف {fixResult.deletedLines} خط محاسبي</div>
                  )}
                </div>
              )}

              {fixResult.complianceNote && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="text-sm text-blue-700 font-medium">
                    ✅ {fixResult.complianceNote}
                  </div>
                </div>
              )}

              {fixResult.balanced === false && fixResult.finalBalance && (
                <div className="mt-3">
                  <div className="text-sm font-medium text-red-700 mb-2">
                    تحذير: ما زالت هناك أرصدة غير متوازنة:
                  </div>
                  <div className="text-xs text-red-600 space-y-1">
                    {fixResult.finalBalance.map((account, index) => (
                      <div key={index}>
                        {account.code} {account.name}: {fmt(account.balance)} MAD
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
