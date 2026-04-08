"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPdfHandlers = registerPdfHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const pdf_service_1 = require("../services/pdf.service");
const fs_1 = require("fs");
function registerPdfHandlers() {
    // Retourner le HTML pour prévisualisation dans le renderer
    (0, index_1.handle)('pdf:getHtml', (documentId) => {
        const pdfData = (0, pdf_service_1.getInvoiceDataForPdf)(documentId);
        return { html: (0, pdf_service_1.generateInvoiceHtml)(pdfData), number: pdfData.document?.number ?? 'document' };
    });
    // Générer et sauvegarder le PDF avec dialog
    (0, index_1.handle)('pdf:generate', async (data) => {
        const pdfData = (0, pdf_service_1.getInvoiceDataForPdf)(data.documentId);
        const html = (0, pdf_service_1.generateInvoiceHtml)(pdfData);
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        // Demander où sauvegarder
        const defaultName = `${pdfData.document?.number ?? 'document'}.pdf`;
        const result = await electron_1.dialog.showSaveDialog(win, {
            title: 'Enregistrer le PDF',
            defaultPath: defaultName,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        win?.focus();
        if (result.canceled || !result.filePath)
            return { success: false, canceled: true };
        const pdfWin = new electron_1.BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        try {
            await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            const pdfBuffer = await pdfWin.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            (0, fs_1.writeFileSync)(result.filePath, pdfBuffer);
            return { success: true, path: result.filePath };
        }
        finally {
            if (!pdfWin.isDestroyed())
                pdfWin.close();
        }
    });
}
