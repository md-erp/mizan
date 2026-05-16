// Mock للتطوير بدون Electron
// يُستخدم فقط عندما window.api غير موجود (Vite dev server بدون Electron)

import type { LicenseInfo, DeviceConfig, User } from '../types'

const MOCK_LICENSE: LicenseInfo = {
  companyName: 'Entreprise Demo',
  expiryDate: '2027-12-31',
  daysRemaining: 365,
  isValid: true,
  isExpired: false,
  isExpiringSoon: false,
}

const MOCK_CONFIG: DeviceConfig = {
  id: 1,
  company_name: 'Entreprise Demo',
  company_ice: '001234567000012',
  company_if: '12345678',
  company_rc: 'RC12345',
  company_address: 'Casablanca, Maroc',
  company_phone: '+212 5 22 00 00 00',
  company_fax: '',
  company_email: '',
  company_website: '',
  company_cnss: '',
  company_patente: '',
  company_bank_name: '',
  company_bank_rib: '',
  company_bank_account: '',
  company_capital: '',
  company_legal_form: '',
  company_city: '',
  company_country: 'Maroc',
  company_logo: '',
  mode: 'standalone',
  server_ip: '',
  server_port: 3000,
  currency: 'MAD',
  setup_done: true,  // غيّر إلى false لرؤية Wizard الإعداد
}

const MOCK_USER: User = {
  id: 1,
  name: 'Admin Demo',
  email: 'admin@demo.ma',
  role: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
}

function ok<T>(data: T) {
  return Promise.resolve({ success: true, data })
}

export const mockApi = {
  getDeviceConfig:      () => ok(MOCK_CONFIG),
  saveDeviceConfig:     () => ok({ success: true }),
  activateLicense: (d: any) => {
    // في وضع التطوير: نتحقق من الكود فعلاً
    if (!d?.companyName || !d?.licenseKey) {
      return Promise.resolve({ success: false, error: 'Nom et clé requis' })
    }
    // نقبل أي كود في وضع التطوير للتسهيل
    return ok({ success: true })
  },
  getLicenseInfo:       () => ok(MOCK_LICENSE),

  login:                () => ok(MOCK_USER),
  logout:               () => ok({}),
  getUsers:             () => ok([MOCK_USER]),
  createUser:           () => ok({ id: 2 }),
  updateUser:           () => ok({ success: true }),
  deleteUser:           () => ok({ success: true }),

  getClients:           () => ok({ rows: [], total: 0, page: 1, limit: 50 }),
  getClient:            () => ok(null),
  createClient:         () => ok({ id: 1 }),
  updateClient:         () => ok({ success: true }),
  deleteClient:         () => ok({ success: true }),

  getSuppliers:         () => ok({ rows: [], total: 0, page: 1, limit: 50 }),
  getSupplier:          () => ok(null),
  createSupplier:       () => ok({ id: 1 }),
  updateSupplier:       () => ok({ success: true }),
  deleteSupplier:       () => ok({ success: true }),

  getProducts:          () => ok({ rows: [], total: 0, page: 1, limit: 50 }),
  getProduct:           () => ok(null),
  createProduct:        () => ok({ id: 1 }),
  updateProduct:        () => ok({ success: true }),
  deleteProduct:        () => ok({ success: true }),

  getStockMovements:    () => ok([]),
  applyStockMovement:   () => ok({ success: true }),
  createManualMovement: () => ok({ id: 1 }),

  getDocuments:         () => ok({ rows: [], total: 0, page: 1, limit: 50 }),
  getDocument:          () => ok(null),
  createDocument:       () => ok({ id: 1, number: 'F-2026-0001' }),
  updateDocument:       () => ok({ success: true }),
  confirmDocument:      () => ok({ success: true }),
  cancelDocument:       () => ok({ success: true }),
  convertDocument:      () => ok({ id: 2, number: 'BL-2026-0001' }),

  getPayments:          () => ok([]),
  createPayment:        () => ok({ id: 1 }),
  updatePayment:        () => ok({ success: true }),

  getPurchaseOrders:    () => ok([]),
  createPurchaseOrder:  () => ok({ id: 1 }),
  confirmReception:     () => ok({ success: true }),
  createImportInvoice:  () => ok({ id: 1 }),

  getProductionOrders:  () => ok([]),
  createProduction:     () => ok({ id: 1, unit_cost: 0, total_cost: 0 }),
  confirmProduction:    () => ok({ success: true }),
  getBomTemplates:      () => ok([]),
  createBomTemplate:    () => ok({ id: 1 }),

  getTransformations:   () => ok([]),
  createTransformation: () => ok({ id: 1, total_cost: 0 }),

  getAccounts:          () => ok([]),
  getJournalEntries:    () => ok([]),
  createManualEntry:    () => ok({ id: 1 }),
  getGrandLivre:        () => ok([]),
  getBalance:           () => ok([]),
  getTvaDeclaration:    () => ok({ collectee: [], recuperable: [], totalCollectee: 0, totalRecuperable: 0, tvaDue: 0 }),
  getPeriods:           () => ok([]),
  closePeriod:          () => ok({ success: true }),

  getReport:            () => ok([]),

  getNotifications:     () => ok([]),
  markNotificationRead: () => ok({ success: true }),

  createBackup:         () => ok({ path: '/backup.db', timestamp: new Date().toISOString() }),
  restoreBackup:        () => ok({ success: true }),
  listBackups:          () => ok([]),

  generatePdf:          () => ok(null),

  importSelectFile:       () => ok(null),
  importClients:          () => ok({ success: 0, errors: [], total: 0 }),
  importSuppliers:        () => ok({ success: 0, errors: [], total: 0 }),
  importProducts:         () => ok({ success: 0, errors: [], total: 0 }),
  importDownloadTemplate: () => ok(null),

  attachmentsAdd:    () => ok([]),
  attachmentsList:   () => ok([]),
  attachmentsOpen:   () => ok({ success: true }),
  attachmentsDelete: () => ok({ success: true }),
}

