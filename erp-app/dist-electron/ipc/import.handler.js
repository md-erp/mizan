"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerImportHandlers = registerImportHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
const import_service_1 = require("../services/import.service");
function registerImportHandlers() {
    // Ouvrir dialogue de sélection de fichier
    (0, index_1.handle)('import:selectFile', async () => {
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        const result = await electron_1.dialog.showOpenDialog(win, {
            title: 'Sélectionner un fichier',
            filters: [
                { name: 'Excel & CSV', extensions: ['xlsx', 'xls', 'csv'] },
                { name: 'Excel', extensions: ['xlsx', 'xls'] },
                { name: 'CSV', extensions: ['csv'] },
            ],
            properties: ['openFile'],
        });
        win?.focus();
        if (result.canceled || result.filePaths.length === 0)
            return null;
        return result.filePaths[0];
    });
    // Import clients
    (0, index_1.handle)('import:clients', async (data) => {
        return (0, import_service_1.importClients)(data.filePath, data.userId ?? 1);
    });
    // Import fournisseurs
    (0, index_1.handle)('import:suppliers', async (data) => {
        return (0, import_service_1.importSuppliers)(data.filePath, data.userId ?? 1);
    });
    // Import produits
    (0, index_1.handle)('import:products', async (data) => {
        return (0, import_service_1.importProducts)(data.filePath, data.userId ?? 1);
    });
    // Télécharger template
    (0, index_1.handle)('import:downloadTemplate', async (type) => {
        const buffer = await (0, import_service_1.generateImportTemplate)(type);
        const fileName = `template-import-${type}.xlsx`;
        const filePath = (0, path_1.join)(electron_1.app.getPath('downloads'), fileName);
        (0, fs_1.writeFileSync)(filePath, buffer);
        return { path: filePath };
    });
}
