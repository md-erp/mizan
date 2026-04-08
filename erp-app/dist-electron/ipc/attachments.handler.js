"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAttachmentsHandlers = registerAttachmentsHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
function getAttachmentsDir(entityType, entityId) {
    const dir = (0, path_1.join)(electron_1.app.getPath('userData'), 'attachments', entityType, String(entityId));
    (0, fs_1.mkdirSync)(dir, { recursive: true });
    return dir;
}
function registerAttachmentsHandlers() {
    // Sélectionner et attacher un fichier
    (0, index_1.handle)('attachments:add', async (data) => {
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        const result = await electron_1.dialog.showOpenDialog(win, {
            title: 'Joindre un document',
            filters: [
                { name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'doc', 'docx'] },
                { name: 'Tous les fichiers', extensions: ['*'] },
            ],
            properties: ['openFile', 'multiSelections'],
        });
        win?.focus();
        if (result.canceled || result.filePaths.length === 0)
            return [];
        const dir = getAttachmentsDir(data.entityType, data.entityId);
        const attached = [];
        for (const srcPath of result.filePaths) {
            const fileName = `${Date.now()}_${(0, path_1.basename)(srcPath)}`;
            const destPath = (0, path_1.join)(dir, fileName);
            (0, fs_1.copyFileSync)(srcPath, destPath);
            attached.push(fileName);
        }
        return attached;
    });
    // Lister les pièces jointes
    (0, index_1.handle)('attachments:list', (data) => {
        const dir = getAttachmentsDir(data.entityType, data.entityId);
        try {
            return (0, fs_1.readdirSync)(dir)
                .filter(f => !f.startsWith('.'))
                .map(f => ({
                name: f,
                originalName: f.replace(/^\d+_/, ''), // enlever le timestamp
                path: (0, path_1.join)(dir, f),
                size: (0, fs_1.statSync)((0, path_1.join)(dir, f)).size,
                ext: (0, path_1.extname)(f).toLowerCase().replace('.', ''),
                date: (0, fs_1.statSync)((0, path_1.join)(dir, f)).mtime,
            }))
                .sort((a, b) => b.date.getTime() - a.date.getTime());
        }
        catch {
            return [];
        }
    });
    // Ouvrir un fichier joint
    (0, index_1.handle)('attachments:open', async (filePath) => {
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openPath(filePath);
        return { success: true };
    });
    // Supprimer une pièce jointe
    (0, index_1.handle)('attachments:delete', (filePath) => {
        if ((0, fs_1.existsSync)(filePath))
            (0, fs_1.unlinkSync)(filePath);
        return { success: true };
    });
}
