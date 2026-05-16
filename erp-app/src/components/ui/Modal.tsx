import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

let modalDepth = 0

export default function Modal({ open, onClose, title, children, size = 'md' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const depthRef   = useRef(0)
  const dialogRef  = useRef<HTMLDivElement>(null)

  // ── Maximize state ────────────────────────────────────────────────────────
  const [maximized, setMaximized] = useState(false)

  // ── Resize state (drag corner) ────────────────────────────────────────────
  const [dims, setDims]     = useState<{ w: number; h: number } | null>(null)
  const resizing            = useRef(false)
  const resizeStart         = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault()
    const el = dialogRef.current
    if (!el) return
    resizing.current = true
    resizeStart.current = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight }

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return
      setDims({
        w: Math.max(320, resizeStart.current.w + (ev.clientX - resizeStart.current.x)),
        h: Math.max(200, resizeStart.current.h + (ev.clientY - resizeStart.current.y)),
      })
    }
    const onUp = () => {
      resizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [maximized])

  // Reset on close
  useEffect(() => {
    if (!open) { setDims(null); setMaximized(false) }
  }, [open])

  useEffect(() => {
    if (!open) return
    modalDepth++
    depthRef.current = modalDepth
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'F11') { e.preventDefault(); setMaximized(m => !m) }
    }
    window.addEventListener('keydown', handler)
    return () => { modalDepth--; window.removeEventListener('keydown', handler) }
  }, [open, onClose])

  if (!open) return null

  const zClass = depthRef.current > 1 ? 'z-[60]' : 'z-50'

  // Maximized overrides everything
  const sizeStyle = maximized
    ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', borderRadius: 0 }
    : dims
    ? { width: dims.w, height: dims.h, maxWidth: '95vw', maxHeight: '95vh' }
    : undefined

  const containerCls = maximized
    ? 'fixed inset-0 z-[70] flex items-stretch justify-stretch p-0'
    : `fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm`

  return (
    <div ref={overlayRef} className={containerCls}>
      <div
        ref={dialogRef}
        className={`card w-full ${maximized ? 'rounded-none' : dims ? '' : SIZES[size]} shadow-xl flex flex-col ${maximized || dims ? '' : 'max-h-[90vh]'} relative`}
        style={sizeStyle}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white truncate pr-4">{title}</h2>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Maximize / Restore — زر واضح بخلفية ملونة */}
            <button
              onClick={() => { setMaximized(m => !m); setDims(null) }}
              title={maximized ? 'Réduire (F11)' : 'Agrandir (F11)'}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
                maximized
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                  : 'bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-primary/20 dark:hover:text-primary',
              ].join(' ')}
            >
              {maximized ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 1H12V5" /><path d="M5 12H1V8" />
                    <path d="M12 1L7.5 5.5" /><path d="M1 12L5.5 7.5" />
                  </svg>
                  <span></span>
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1H1V5" /><path d="M8 12H12V8" />
                    <path d="M1 1L5.5 5.5" /><path d="M12 12L7.5 7.5" />
                  </svg>
                  <span></span>
                </>
              )}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              title="Fermer (Esc)"
              className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400
                hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                transition-colors text-lg leading-none"
            >
              &#x2715;
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* ── Resize handle (corner) — visible seulement si pas maximized ── */}
        {!maximized && (
          <div
            onMouseDown={onResizeMouseDown}
            className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize
              flex items-end justify-end pb-1.5 pr-1.5
              opacity-60 hover:opacity-100 transition-opacity select-none group"
            title="Redimensionner"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400 group-hover:text-primary transition-colors">
              <path d="M14 6L14 14L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 10L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M6 14L14 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}
