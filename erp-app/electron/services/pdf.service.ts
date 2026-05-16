import { getDb } from '../database/connection'

export interface PdfInvoiceData {
  document: any
  lines: any[]
  company: any
  payments: any[]
  settings: any
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const fmtDateLong = (d: string) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

const DOC_TITLES: Record<string, string> = {
  invoice: 'FACTURE', quote: 'DEVIS', bl: 'BON DE LIVRAISON',
  proforma: 'FACTURE PROFORMA', avoir: 'AVOIR',
  purchase_order: 'BON DE COMMANDE', purchase_invoice: 'FACTURE FOURNISSEUR',
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces', bank: 'Virement bancaire', cheque: 'Chèque', lcn: 'LCN',
}

function watermark(status: string) {
  const text = status === 'draft' ? 'BROUILLON' : status === 'cancelled' ? 'ANNULÉ' : null
  return text
    ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);
        font-size:110px;font-weight:900;color:rgba(0,0,0,0.04);white-space:nowrap;
        pointer-events:none;z-index:0;letter-spacing:12px;">${text}</div>`
    : ''
}

// ════════════════════════════════════════════════════════════════════
// DATA FETCHER
// ════════════════════════════════════════════════════════════════════
export function getInvoiceDataForPdf(documentId: number): PdfInvoiceData {
  const db = getDb()

  const document = db.prepare(`
    SELECT d.*,
           COALESCE(c.name, s.name)           as party_name,
           COALESCE(c.address, s.address)     as party_address,
           COALESCE(c.ice, s.ice)             as party_ice,
           COALESCE(c.if_number, s.if_number) as party_if,
           COALESCE(c.rc, s.rc)               as party_rc,
           COALESCE(di.payment_method, dpi.payment_method) as payment_method
    FROM documents d
    LEFT JOIN clients c  ON d.party_id = c.id  AND d.party_type = 'client'
    LEFT JOIN suppliers s ON d.party_id = s.id AND d.party_type = 'supplier'
    LEFT JOIN doc_invoices di          ON d.id = di.document_id
    LEFT JOIN doc_purchase_invoices dpi ON d.id = dpi.document_id
    WHERE d.id = ? AND d.is_deleted = 0
  `).get(documentId)

  const lines = db.prepare(`
    SELECT dl.*, pr.name as product_name, pr.unit
    FROM document_lines dl
    LEFT JOIN products pr ON dl.product_id = pr.id
    WHERE dl.document_id = ?
    ORDER BY dl.id
  `).all(documentId)

  const company = db.prepare('SELECT * FROM device_config LIMIT 1').get()

  const payments = db.prepare(`
    SELECT p.*, pa.amount
    FROM payment_allocations pa
    JOIN payments p ON pa.payment_id = p.id
    WHERE pa.document_id = ?
  `).all(documentId)

  const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as any[]
  const settings: any = {}
  settingsRows.forEach((row: any) => { settings[row.key] = row.value })

  return { document, lines, company, payments, settings }
}

// ════════════════════════════════════════════════════════════════════
// MAIN DISPATCHER
// ════════════════════════════════════════════════════════════════════
export function generateInvoiceHtml(data: PdfInvoiceData): string {
  const { company, settings } = data

  const customTpl = company?.custom_pdf_template ?? settings.custom_pdf_template ?? ''
  if (customTpl && customTpl.trim().length > 100) {
    return applyCustomTemplate(customTpl, data)
  }

  return generateMasterTemplate(data)
}

// ════════════════════════════════════════════════════════════════════
// CUSTOM HTML ENGINE
// ════════════════════════════════════════════════════════════════════
function applyCustomTemplate(tpl: string, data: PdfInvoiceData): string {
  const { document: doc, lines, company } = data
  const vars: Record<string, string> = {
    '{{doc.number}}': doc.number ?? '',
    '{{doc.date}}': fmtDate(doc.date),
    '{{doc.type}}': DOC_TITLES[doc.type] ?? doc.type,
    '{{doc.total_ht}}': fmt(doc.total_ht ?? doc.total_ttc),
    '{{doc.total_tva}}': fmt(doc.total_tva ?? 0),
    '{{doc.total_ttc}}': fmt(doc.total_ttc),
    '{{client.name}}': doc.party_name ?? '',
    '{{client.address}}': doc.party_address ?? '',
    '{{client.ice}}': doc.party_ice ?? '',
    '{{client.rc}}': doc.party_rc ?? '',
    '{{client.if}}': doc.party_if ?? '',
    '{{company.name}}': company?.company_name ?? '',
    '{{company.address}}': company?.company_address ?? '',
    '{{company.phone}}': company?.company_phone ?? '',
    '{{company.email}}': company?.company_email ?? '',
    '{{company.ice}}': company?.company_ice ?? '',
    '{{company.rc}}': company?.company_rc ?? '',
    '{{company.bank}}': company?.company_bank_name ?? '',
    '{{company.rib}}': company?.company_bank_rib ?? '',
    '{{lines_html}}': lines.map((l: any) =>
      `<tr><td>${l.product_name ?? l.description ?? '—'}</td>` +
      `<td>${l.quantity}</td><td>${fmt(l.unit_price)}</td>` +
      `<td>${fmt(l.total_ht ?? l.quantity * l.unit_price)}</td></tr>`
    ).join(''),
  }
  let result = tpl
  for (const [k, v] of Object.entries(vars)) result = result.split(k).join(v)
  return result
}

// ════════════════════════════════════════════════════════════════════
// MASTER TEMPLATE — single premium document generator
// ════════════════════════════════════════════════════════════════════
function generateMasterTemplate(data: PdfInvoiceData): string {
  const { document: doc, lines, company, settings } = data

  const BLUE = '#1B3A6B'
  const BLUE_MID = '#2B5797'
  const BLUE_GRAD = '#3A6FCC'
  const ACCENT = '#C8D8F0'
  const BG = '#F0F5FC'
  const BORDER = '#D0DCF0'
  const showStamp = settings.show_stamp_area !== '0'
  const docTitle = (DOC_TITLES[doc.type] ?? 'DOCUMENT').toUpperCase()

  // ─── Smart logo layout based on aspect ratio ─────────────────────
  const logoW: number = company?.company_logo_width ?? 0
  const logoH: number = company?.company_logo_height ?? 0
  const ratio: number = logoH > 0 ? logoW / logoH : 2
  const isWideLogo = ratio > 1.6

  const logoImg = company?.company_logo
    ? (isWideLogo
      ? `<img src="${company.company_logo}" alt="Logo" style="max-height:72px;max-width:260px;object-fit:contain;display:block;margin-bottom:10px;">`
      : `<img src="${company.company_logo}" alt="Logo" style="max-height:90px;max-width:130px;object-fit:contain;display:block;">`)
    : `<div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:2px;">${(company?.company_name ?? 'ENTREPRISE').toUpperCase()}</div>`

  // ─── HEADER ──────────────────────────────────────────────────────
  const headerHtml = isWideLogo
    ? `<div style="background:linear-gradient(135deg,${BLUE} 0%,${BLUE_GRAD} 100%);padding:22px 26mm 18px;text-align:center;">
         ${logoImg}
         <div style="display:inline-block;border:2px solid rgba(255,255,255,0.25);border-radius:4px;padding:6px 28px;">
           <span style="font-size:26px;font-weight:900;color:#fff;letter-spacing:8px;white-space:nowrap;">${docTitle}</span>
         </div>
       </div>`
    : `<div style="background:linear-gradient(135deg,${BLUE} 0%,${BLUE_GRAD} 100%);padding:0;display:flex;align-items:stretch;">
         <div style="background:rgba(0,0,0,0.18);padding:20px 22px;display:flex;align-items:center;justify-content:center;min-width:130px;">
           ${logoImg}
         </div>
         <div style="flex:1;padding:18px 22px;display:flex;flex-direction:column;justify-content:center;gap:5px;">
           <div style="display:inline-block;width:fit-content;border:2px solid rgba(255,255,255,0.3);border-radius:4px;padding:5px 18px;margin-bottom:4px;">
             <span style="font-size:22px;font-weight:900;color:#fff;letter-spacing:5px;white-space:nowrap;">${docTitle}</span>
           </div>
           ${company?.company_name ? `<div style="font-size:13px;color:rgba(255,255,255,0.8);font-weight:700;">${company.company_name}</div>` : ''}
           ${company?.company_city ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);">${company.company_city}</div>` : ''}
         </div>
         <div style="padding:18px 24px;text-align:right;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:150px;">
           <div style="font-size:10px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:2px;">N° de référence</div>
           <div style="font-size:18px;font-weight:900;color:#fff;">${doc.number}</div>
           <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px;">${fmtDateLong(doc.date)}</div>
         </div>
       </div>`

  // ─── Lines HTML ───────────────────────────────────────────────────
  const linesHtml = lines.map((l: any, i: number) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#F5F9FF'};">
      <td style="padding:11px 14px;font-size:12px;font-weight:600;color:#111;text-align:left;">${l.product_name ?? l.description ?? '—'}</td>
      <td style="padding:11px 14px;font-size:12px;text-align:center;color:#666;">${l.unit ?? 'U'}</td>
      <td style="padding:11px 14px;font-size:12px;text-align:center;color:#555;font-weight:600;">${l.quantity}</td>
      <td style="padding:11px 14px;font-size:12px;text-align:right;color:#555;">${fmt(l.unit_price)}</td>
      <td style="padding:11px 14px;font-size:12px;text-align:right;color:#E67E22;font-weight:600;">${l.discount ? Math.round(l.discount) + '%' : '—'}</td>
      <td style="padding:11px 14px;font-size:13px;font-weight:800;text-align:right;color:${BLUE_MID};">${fmt(l.total_ht ?? (l.quantity * l.unit_price))}</td>
    </tr>`).join('')

  // ─── Client badges ────────────────────────────────────────────────
  const badge = (label: string, val: string) =>
    `<span style="display:inline-block;padding:3px 10px;border:1px solid ${BORDER};border-radius:20px;font-size:10px;color:#444;margin:2px 3px 0;background:#fff;"><strong>${label}:</strong> ${val}</span>`

  const clientBadges = [
    doc.party_ice ? badge('ICE', doc.party_ice) : '',
    doc.party_rc ? badge('RC', doc.party_rc) : '',
    doc.party_if ? badge('IF', doc.party_if) : '',
  ].join('')

  const paymentLabel = doc.payment_method ? (PAYMENT_LABELS[doc.payment_method] ?? doc.payment_method) : null

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background:#fff; color:#222; font-size:12px; }
  .page {
    max-width: 210mm;
    margin: 0 auto;
    position: relative;
    min-height: 297mm;
    background: #fff;
    display: flex;
    flex-direction: column;
  }
  .page-body { flex:1; padding: 0 20mm 6mm; }
  .footer-spacer { height: 52mm; }
  .footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
  }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  .info-box {
    background: ${BG};
    border: 1px solid ${BORDER};
    border-radius: 8px;
    padding: 14px 18px;
    font-size: 11.5px;
    line-height: 1.95;
    box-shadow: 0 1px 4px rgba(27,58,107,0.06);
  }
  .info-box-title {
    font-size: 10px;
    font-weight: 800;
    color: ${BLUE_MID};
    text-transform: uppercase;
    letter-spacing: 1.5px;
    border-bottom: 1px solid ${ACCENT};
    padding-bottom: 6px;
    margin-bottom: 9px;
  }
  .badge-label { color: #999; margin-right: 4px; }
</style>
</head><body><div class="page">

  ${headerHtml}

  <div class="page-body">

    <!-- ─── Info boxes ─── -->
    <div style="display:flex;gap:12px;margin:18px 0 16px;">
      <div class="info-box" style="flex:1;">
        <div class="info-box-title">Détails du document</div>
        <div><span class="badge-label">N° :</span><strong>${doc.number}</strong></div>
        <div><span class="badge-label">Date :</span>${fmtDate(doc.date)}</div>
        ${doc.due_date ? `<div><span class="badge-label">Échéance :</span>${fmtDate(doc.due_date)}</div>` : ''}
        ${paymentLabel ? `<div><span class="badge-label">Paiement :</span>${paymentLabel}</div>` : ''}
        ${company?.company_name ? `<div><span class="badge-label">Émetteur :</span>${company.company_name}</div>` : ''}
      </div>
      <div class="info-box" style="flex:1.5;">
        <div class="info-box-title">Client / Fournisseur</div>
        <div style="font-weight:800;font-size:14px;color:#111;margin-bottom:3px;">${doc.party_name ?? '—'}</div>
        ${doc.party_address ? `<div style="color:#666;font-size:11px;line-height:1.5;">${doc.party_address}</div>` : ''}
        ${clientBadges ? `<div style="margin-top:7px;">${clientBadges}</div>` : ''}
      </div>
    </div>

    <!-- ─── Products Table ─── -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(27,58,107,0.08);">
      <thead>
        <tr style="background:linear-gradient(90deg,${BLUE} 0%,${BLUE_MID} 100%);color:#fff;">
          <th style="padding:12px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Désignation</th>
          <th style="padding:12px 14px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:70px;">Unité</th>
          <th style="padding:12px 14px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:80px;">Qté</th>
          <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:110px;">Prix U (HT)</th>
          <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:80px;">Remise</th>
          <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:110px;">Total (HT)</th>
        </tr>
      </thead>
      <tbody style="border:1px solid ${BORDER};border-top:none;">${linesHtml}</tbody>
    </table>

    <!-- ─── Totals ─── -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:18px;">
      <div style="width:290px;border-radius:8px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 2px 10px rgba(27,58,107,0.1);">
        <div style="display:flex;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid ${BORDER};">
          <span style="font-size:12px;color:#666;font-weight:600;">Total HT</span>
          <span style="font-size:12px;font-weight:700;color:#222;">${fmt(doc.total_ht ?? doc.total_ttc)} DH</span>
        </div>
        ${(doc.global_discount ?? 0) > 0 ? `
        <div style="display:flex;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid ${BORDER};">
          <span style="font-size:12px;color:#E67E22;font-weight:600;">Remise globale (${doc.global_discount}%)</span>
          <span style="font-size:12px;font-weight:700;color:#E67E22;">- ${fmt((doc.total_ht * (doc.global_discount ?? 0)) / 100)} DH</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:2px solid ${BLUE_MID};">
          <span style="font-size:12px;color:#666;font-weight:600;">TVA</span>
          <span style="font-size:12px;font-weight:700;color:#222;">${fmt(doc.total_tva ?? 0)} DH</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:13px 16px;background:linear-gradient(90deg,${BLUE} 0%,${BLUE_MID} 100%);">
          <span style="font-size:14px;font-weight:900;color:#fff;letter-spacing:1px;">TOTAL TTC</span>
          <span style="font-size:15px;font-weight:900;color:#fff;">${fmt(doc.total_ttc)} DH</span>
        </div>
      </div>
    </div>

    <!-- ─── Conditions & Footer text ─── -->
    ${(settings.payment_terms || settings.invoice_footer || doc.notes) ? `
    <div style="background:${BG};border:1px solid ${BORDER};border-left:4px solid ${BLUE_MID};border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;font-size:11.5px;line-height:1.7;color:#444;">
      ${settings.payment_terms ? `<div style="margin-bottom:3px;"><strong style="color:${BLUE};">Conditions de paiement :</strong> ${settings.payment_terms}</div>` : ''}
      ${settings.invoice_footer ? `<div style="color:#666;">${settings.invoice_footer}</div>` : ''}
      ${doc.notes ? `<div style="margin-top:5px;color:#666;">${doc.notes}</div>` : ''}
    </div>` : ''}

    <!-- ─── Signature ─── -->
    ${showStamp ? `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
      <div style="width:48%;"></div>
      <div style="width:48%;text-align:center;">
        <div style="font-size:11px;font-weight:800;color:${BLUE_MID};text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Signature &amp; Cachet</div>
        <div style="height:80px;border:1.5px dashed ${BORDER};border-radius:8px;background:linear-gradient(135deg,#F8FBFF,#EEF4FF);"></div>
      </div>
    </div>` : ''}

    <div class="footer-spacer"></div>
  </div><!-- /page-body -->

  <!-- ═══ PREMIUM FOOTER ═══ -->
  <div class="footer">
    <div style="background:#F5F8FD;border-top:3px solid ${BLUE_MID};padding:14px 20mm 12px;">

      <!-- Company headline row -->
      <div style="text-align:center;margin-bottom:10px;">
        <span style="font-weight:900;font-size:11.5px;color:${BLUE};letter-spacing:1px;text-transform:uppercase;">${company?.company_name ?? ''}</span>
        ${company?.company_legal_form ? `<span style="color:#999;font-size:10px;margin:0 8px;">—</span><span style="font-size:10px;color:#555;font-weight:600;">${company.company_legal_form}</span>` : ''}
        ${company?.company_capital ? `<span style="color:#999;font-size:10px;margin:0 8px;">—</span><span style="font-size:10px;color:#555;">Capital : <strong>${company.company_capital}</strong></span>` : ''}
      </div>

      <!-- Three columns -->
      <div style="display:flex;justify-content:space-between;gap:12px;font-size:10px;color:#555;line-height:1.85;">
        <div style="flex:1;">
          <div style="font-size:9.5px;font-weight:800;color:${BLUE};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;border-bottom:1px solid ${ACCENT};padding-bottom:3px;">Coordonnées</div>
          ${company?.company_address ? `<div>📍 ${company.company_address}${company?.company_city ? ', ' + company.company_city : ''}</div>` : ''}
          ${company?.company_phone ? `<div>📞 ${company.company_phone}</div>` : ''}
          ${company?.company_fax ? `<div>📠 Fax: ${company.company_fax}</div>` : ''}
          ${company?.company_email ? `<div>✉️ ${company.company_email}</div>` : ''}
          ${company?.company_website ? `<div>🌍 ${company.company_website}</div>` : ''}
        </div>
        <div style="flex:1;text-align:center;">
          <div style="font-size:9.5px;font-weight:800;color:${BLUE};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;border-bottom:1px solid ${ACCENT};padding-bottom:3px;">Identification légale</div>
          ${company?.company_ice ? `<div><strong>ICE :</strong> ${company.company_ice}</div>` : ''}
          ${company?.company_rc ? `<div><strong>RC :</strong> ${company.company_rc}</div>` : ''}
          ${company?.company_if ? `<div><strong>IF :</strong> ${company.company_if}</div>` : ''}
          ${company?.company_cnss ? `<div><strong>CNSS :</strong> ${company.company_cnss}</div>` : ''}
          ${company?.company_patente ? `<div><strong>Patente :</strong> ${company.company_patente}</div>` : ''}
        </div>
        <div style="flex:1;text-align:right;">
          <div style="font-size:9.5px;font-weight:800;color:${BLUE};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;border-bottom:1px solid ${ACCENT};padding-bottom:3px;">Informations bancaires</div>
          ${company?.company_bank_name ? `<div><strong>Banque :</strong> ${company.company_bank_name}</div>` : ''}
          ${company?.company_bank_rib ? `<div><strong>RIB :</strong> ${company.company_bank_rib}</div>` : ''}
          ${company?.company_bank_account ? `<div><strong>Compte :</strong> ${company.company_bank_account}</div>` : ''}
        </div>
      </div>
    </div>
    <!-- Bottom gradient strip -->
    <div style="height:5px;background:linear-gradient(to right,${BLUE},${BLUE_GRAD},${BLUE});"></div>
  </div>

</div></body></html>`
}
