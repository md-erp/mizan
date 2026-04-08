"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExcelHandlers = registerExcelHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const excel_service_1 = require("../services/excel.service");
async function chooseExportPath(defaultName) {
    const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
    const result = await electron_1.dialog.showSaveDialog(win, {
        title: 'Enregistrer le fichier Excel',
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    // Redonner le focus à la fenêtre principale après le dialog
    win?.focus();
    if (result.canceled || !result.filePath)
        return null;
    return result.filePath;
}
function registerExcelHandlers() {
    (0, index_1.handle)('excel:exportDocuments', async (filters) => {
        const path = await chooseExportPath(`documents-${filters.type ?? 'export'}.xlsx`);
        if (!path)
            return null;
        return (0, excel_service_1.exportDocuments)(filters, path);
    });
    (0, index_1.handle)('excel:exportParties', async (type) => {
        const path = await chooseExportPath(`${type}.xlsx`);
        if (!path)
            return null;
        return (0, excel_service_1.exportParties)(type, path);
    });
    (0, index_1.handle)('excel:exportStock', async () => {
        const path = await chooseExportPath('inventaire-stock.xlsx');
        if (!path)
            return null;
        return (0, excel_service_1.exportStock)(path);
    });
    (0, index_1.handle)('excel:exportBalance', async (filters) => {
        const path = await chooseExportPath('balance-comptable.xlsx');
        if (!path)
            return null;
        return (0, excel_service_1.exportBalance)(filters, path);
    });
    (0, index_1.handle)('excel:exportReport', async (data) => {
        const path = await chooseExportPath(`rapport-${data.type}.xlsx`);
        if (!path)
            return null;
        return (0, excel_service_1.exportReportData)(data.type, data.rows, data.filters ?? {}, path);
    });
    // Export multiple rapports dans un seul fichier Excel (onglets séparés)
    (0, index_1.handle)('excel:exportMultiple', async (data) => {
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        const result = await electron_1.dialog.showSaveDialog(win, {
            title: 'Enregistrer les rapports groupés',
            defaultPath: `rapports-${new Date().toISOString().split('T')[0]}.xlsx`,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        win?.focus();
        if (result.canceled || !result.filePath)
            return null;
        return (0, excel_service_1.exportMultipleReports)(data.reports, result.filePath);
    });
}
