import { useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from './Toast'

interface Props {
  html: string
  title: string
  filename: string
  onClose: () => void
}

/**
 * معاينة طباعة مطابقة لواجهة DocumentDetail —
 * تعرض HTML في iframe بتنسيق A4، مع أزرار: طباعة، تحميل PDF، إغلاق
 */
export default function PrintPreviewModal({ html, title, filename, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  async function handleSavePdf() {
    try {
      await api.generatePdfFromHtml({ html, filename })
      toast('✅ PDF enregistré')
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  function handlePrint() {
    const win = iframeRef.current?.contentWindow
    if (win) {
      win.focus()
      win.print()
    } else {
      // fallback: nouvelle fenêtre
      const w = window.open('', '_blank')
      if (!w) return
      w.document.write(html)
      w.document.close()
      w.focus()
      w.print()
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex bg-[#404040]">
      {/* Zone de prévisualisation */}
      <div className="flex-1 overflow-auto p-6 flex flex-col items-center gap-4">
        <div className="text-gray-300 text-xs mb-2 self-start">
          {new Date().toLocaleDateString('fr-FR')} — {title}
        </div>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          className="bg-white shadow-2xl"
          style={{ width: '210mm', minHeight: '297mm', border: 'none' }}
          title={title}
        />
      </div>

      {/* Panneau latéral droit */}
      <div className="w-72 bg-[#323232] flex flex-col border-l border-[#555] shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#555]">
          <span className="text-white font-semibold text-base">Aperçu</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5 overflow-auto">
          <div className="text-gray-300 text-sm font-medium">{title}</div>
          <div className="text-gray-400 text-xs">1 feuille de papier · Format A4</div>

          <div className="space-y-1.5">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Destination</label>
            <div className="bg-[#444] rounded px-3 py-2 text-white text-sm flex items-center gap-2">
              🖨️ Imprimante par défaut
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Format</label>
            <div className="bg-[#444] rounded px-3 py-2 text-white text-sm">A4 · Portrait</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Fichier</label>
            <div className="bg-[#444] rounded px-3 py-2 text-white text-xs font-mono break-all">{filename}</div>
          </div>
        </div>

        {/* Boutons d'action */}
        <div className="px-5 py-4 border-t border-[#555] space-y-2">
          <button
            onClick={handlePrint}
            className="w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white font-medium py-2.5 rounded text-sm transition-colors flex items-center justify-center gap-2">
            🖨️ Imprimer
          </button>
          <button
            onClick={handleSavePdf}
            className="w-full bg-[#444] hover:bg-[#555] text-white font-medium py-2.5 rounded text-sm transition-colors flex items-center justify-center gap-2 border border-[#666]">
            💾 Enregistrer PDF
          </button>
          <button
            onClick={onClose}
            className="w-full bg-transparent hover:bg-[#444] text-gray-300 font-medium py-2 rounded text-sm border border-[#666] transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
