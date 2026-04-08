"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInvoiceDataForPdf = getInvoiceDataForPdf;
exports.generateInvoiceHtml = generateInvoiceHtml;
const connection_1 = require("../database/connection");
function getInvoiceDataForPdf(documentId) {
    const db = (0, connection_1.getDb)();
    const document = db.prepare(`
    SELECT d.*,
      CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
      CASE d.party_type WHEN 'client' THEN c.address WHEN 'supplier' THEN s.address END as party_address,
      CASE d.party_type WHEN 'client' THEN c.ice WHEN 'supplier' THEN s.ice END as party_ice,
      CASE d.party_type WHEN 'client' THEN c.if_number WHEN 'supplier' THEN s.if_number END as party_if,
      di.currency, di.exchange_rate, di.payment_method, di.due_date, di.payment_status,
      dbl.delivery_address, dbl.delivery_date,
      dp.validity_date as proforma_validity, dp.incoterm, dp.currency as proforma_currency, dp.exchange_rate as proforma_rate
    FROM documents d
    LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
    LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
    LEFT JOIN doc_invoices di ON di.document_id = d.id
    LEFT JOIN doc_bons_livraison dbl ON dbl.document_id = d.id
    LEFT JOIN doc_proformas dp ON dp.document_id = d.id
    WHERE d.id = ?
  `).get(documentId);
    const lines = db.prepare(`
    SELECT dl.*, p.name as product_name, p.code as product_code, p.unit
    FROM document_lines dl
    LEFT JOIN products p ON p.id = dl.product_id
    WHERE dl.document_id = ?
    ORDER BY dl.id ASC
  `).all(documentId);
    const company = db.prepare('SELECT * FROM device_config WHERE id = 1').get();
    const payments = db.prepare(`
    SELECT pa.amount, p.method, p.date, p.cheque_number, p.bank
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.document_id = ?
    ORDER BY p.date ASC
  `).all(documentId);
    // Charger les paramètres du modèle
    const settingsRows = db.prepare('SELECT key, value FROM app_settings').all();
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
    return { document, lines, company, payments, settings };
}
// Template HTML pour la facture
function generateInvoiceHtml(data) {
    const { document: doc, lines, company, payments, settings } = data;
    const primaryColor = settings.primary_color ?? '#1E3A5F';
    const accentColor = settings.accent_color ?? '#F0A500';
    const footer = settings.invoice_footer ?? 'Merci pour votre confiance';
    const payTerms = settings.payment_terms ?? '';
    const showBank = settings.show_bank_details === '1';
    const showStamp = settings.show_stamp_area !== '0';
    const fmt = (n) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = (doc.total_ttc ?? 0) - totalPaid;
    const DOC_TITLES = {
        invoice: 'FACTURE', quote: 'DEVIS', bl: 'BON DE LIVRAISON',
        proforma: 'FACTURE PROFORMA', avoir: 'AVOIR',
        purchase_order: 'BON DE COMMANDE', purchase_invoice: 'FACTURE FOURNISSEUR',
    };
    // Watermark pour brouillon/annulé
    const watermarkText = doc.status === 'draft' ? 'BROUILLON' : doc.status === 'cancelled' ? 'ANNULÉ' : null;
    const watermarkHtml = watermarkText ? `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);
      font-size:100px;font-weight:900;color:rgba(0,0,0,0.06);white-space:nowrap;
      pointer-events:none;z-index:0;letter-spacing:10px;">
      ${watermarkText}
    </div>` : '';
    // Infos spécifiques BL
    const blInfoHtml = doc.type === 'bl' && (doc.delivery_address || doc.delivery_date) ? `
    <div style="background:#f0f7ff;border-radius:8px;padding:12px;margin-bottom:20px;font-size:12px;">
      <strong>Informations de livraison:</strong><br>
      ${doc.delivery_address ? `Adresse: ${doc.delivery_address}<br>` : ''}
      ${doc.delivery_date ? `Date de livraison: ${new Date(doc.delivery_date).toLocaleDateString('fr-FR')}` : ''}
    </div>` : '';
    // Infos spécifiques Proforma
    const proformaInfoHtml = doc.type === 'proforma' && (doc.incoterm || doc.proforma_currency) ? `
    <div style="background:#fff8e1;border-radius:8px;padding:12px;margin-bottom:20px;font-size:12px;">
      ${doc.incoterm ? `<strong>Incoterm:</strong> ${doc.incoterm} &nbsp;&nbsp;` : ''}
      ${doc.proforma_currency && doc.proforma_currency !== 'MAD' ? `<strong>Devise:</strong> ${doc.proforma_currency} (taux: ${doc.proforma_rate ?? 1})` : ''}
    </div>` : '';
    const linesHtml = lines.map(l => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">
        <div style="font-weight:500">${l.product_name ?? l.description ?? '—'}</div>
        ${l.product_code ? `<div style="font-size:11px;color:#888;font-family:monospace">${l.product_code}</div>` : ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${l.quantity} ${l.unit ?? ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${fmt(l.unit_price)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${l.discount > 0 ? l.discount + '%' : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${l.tva_rate}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${fmt(l.total_ttc)}</td>
    </tr>
  `).join('');
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size:13px; color:#333; background:#fff; }
  .page { padding:40px; max-width:800px; margin:0 auto; position:relative; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; }
  .company-name { font-size:22px; font-weight:700; color:${primaryColor}; }
  .company-info { font-size:11px; color:#666; margin-top:4px; line-height:1.6; }
  .doc-title { font-size:28px; font-weight:700; color:${primaryColor}; text-align:right; }
  .doc-number { font-size:14px; color:${accentColor}; font-weight:600; text-align:right; margin-top:4px; }
  .doc-date { font-size:12px; color:#888; text-align:right; margin-top:2px; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:30px; }
  .party-box { background:#f8fafc; border-radius:8px; padding:16px; }
  .party-label { font-size:10px; text-transform:uppercase; color:#888; font-weight:600; margin-bottom:6px; letter-spacing:0.5px; }
  .party-name { font-size:15px; font-weight:600; color:${primaryColor}; }
  .party-info { font-size:11px; color:#666; margin-top:4px; line-height:1.6; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead { background:${primaryColor}; color:white; }
  thead th { padding:10px 12px; text-align:left; font-size:12px; font-weight:500; }
  thead th:last-child, thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4), thead th:nth-child(5) { text-align:center; }
  thead th:last-child { text-align:right; }
  .totals { display:flex; justify-content:flex-end; margin-bottom:30px; }
  .totals-box { width:260px; }
  .totals-row { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; border-bottom:1px solid #f0f0f0; }
  .totals-row.total { font-size:16px; font-weight:700; color:${primaryColor}; border-bottom:none; padding-top:10px; }
  .totals-row.remaining { color:#EF4444; font-weight:600; }
  .footer { margin-top:40px; padding-top:20px; border-top:2px solid #1E3A5F; display:flex; justify-content:space-between; font-size:11px; color:#888; }
  .stamp-area { width:150px; height:80px; border:1px dashed #ccc; border-radius:4px; display:flex; align-items:center; justify-content:center; color:#ccc; font-size:11px; }
</style>
</head>
<body>
<div class="page">
  ${watermarkHtml}
  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">${company?.company_name ?? 'Entreprise'}</div>
      <div class="company-info">
        ${company?.company_address ? company.company_address + '<br>' : ''}
        ${company?.company_phone ? 'Tél: ' + company.company_phone + '<br>' : ''}
        ${company?.company_ice ? 'ICE: ' + company.company_ice + '<br>' : ''}
        ${company?.company_if ? 'IF: ' + company.company_if : ''}
      </div>
    </div>
    <div>
      <div class="doc-title">${DOC_TITLES[doc.type] ?? doc.type.toUpperCase()}</div>
      <div class="doc-number">N° ${doc.number}</div>
      <div class="doc-date">Date: ${fmtDate(doc.date)}</div>
      ${doc.due_date ? `<div class="doc-date">Échéance: ${fmtDate(doc.due_date)}</div>` : ''}
    </div>
  </div>

  <!-- Parties -->
  <div class="parties">
    <div class="party-box">
      <div class="party-label">Émetteur</div>
      <div class="party-name">${company?.company_name ?? '—'}</div>
      <div class="party-info">
        ${company?.company_ice ? 'ICE: ' + company.company_ice : ''}
      </div>
    </div>
    <div class="party-box">
      <div class="party-label">${doc.party_type === 'client' ? 'Client' : 'Fournisseur'}</div>
      <div class="party-name">${doc.party_name ?? '—'}</div>
      <div class="party-info">
        ${doc.party_address ? doc.party_address + '<br>' : ''}
        ${doc.party_ice ? 'ICE: ' + doc.party_ice : ''}
        ${doc.party_if ? ' | IF: ' + doc.party_if : ''}
      </div>
    </div>
  </div>

  ${blInfoHtml}
  ${proformaInfoHtml}

  <!-- Lignes -->
  <table>
    <thead>
      <tr>
        <th>Désignation</th>
        <th style="text-align:center">Qté</th>
        <th style="text-align:right">Prix HT</th>
        <th style="text-align:center">Rem.</th>
        <th style="text-align:center">TVA</th>
        <th style="text-align:right">Total TTC</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <!-- Totaux -->
  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Total HT</span><span>${fmt(doc.total_ht)} MAD</span></div>
      <div class="totals-row"><span>TVA</span><span>${fmt(doc.total_tva)} MAD</span></div>
      <div class="totals-row total"><span>Total TTC</span><span>${fmt(doc.total_ttc)} MAD</span></div>
      ${totalPaid > 0 ? `<div class="totals-row"><span>Payé</span><span style="color:#10B981">- ${fmt(totalPaid)} MAD</span></div>` : ''}
      ${remaining > 0.01 ? `<div class="totals-row remaining"><span>Reste à payer</span><span>${fmt(remaining)} MAD</span></div>` : ''}
    </div>
  </div>

  ${doc.notes ? `<div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:12px;color:#666;margin-bottom:20px"><strong>Notes:</strong> ${doc.notes}</div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <div>
      <div>${footer}</div>
      ${payTerms ? `<div style="margin-top:2px;font-size:10px;color:#aaa">${payTerms}</div>` : ''}
      <div style="margin-top:4px">${company?.company_name ?? ''} — ${company?.company_ice ? 'ICE: ' + company.company_ice : ''}</div>
      ${showBank && settings.bank_name ? `<div style="margin-top:4px;font-size:10px">Banque: ${settings.bank_name} — RIB: ${settings.bank_rib ?? ''}</div>` : ''}
    </div>
    ${showStamp ? `<div class="stamp-area">Cachet & Signature</div>` : ''}
  </div>
</div>
</body>
</html>`;
}
