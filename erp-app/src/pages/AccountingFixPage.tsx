/**
 * صفحة إصلاح المحاسبة
 */

import AccountingFixPanel from '../components/AccountingFixPanel'

export default function AccountingFixPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <h1 className="text-2xl font-bold text-gray-900">إصلاح المحاسبة</h1>
            <p className="mt-2 text-gray-600">
              إصلاح القيود المحاسبية للفواتير الملغية وضمان التوازن المحاسبي
            </p>
          </div>
        </div>
      </div>
      
      <div className="py-8">
        <AccountingFixPanel />
      </div>
    </div>
  )
}