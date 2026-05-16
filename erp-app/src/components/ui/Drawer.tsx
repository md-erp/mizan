import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  defaultWidth?: number
}

const MIN_WIDTH = 380
const MAX_WIDTH = 1400

export default function Drawer({ open, onClose, title, children, defaultWidth = 600 }: Props) {
  const [width, setWidth]       = useState(defaultWidth)
  const [expanded, setExpanded] = useState(false)
  const dragging  = useRef(false)
  const startX    = useRef(0)
  const startW    = useRef(0)
  const prevWidth = useRef(defaultWidth)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (expanded) return
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = width
    document.body.style.cursor     = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [width, expanded])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta)))
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  // Keyboard shortcut F11 pour expand/restore
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11') { e.preventDefault(); toggleExpand() }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, expanded])

  function toggleExpand() {
    if (expanded) {
      setWidth(prevWidth.current)
      setExpanded(false)
    } else {
      prevWidth.current = width
      setWidth(Math.min(MAX_WIDTH, window.innerWidth - 48))
      setExpanded(true)
    }
  }

  const displayWidth = expanded ? Math.min(MAX_WIDTH, window.innerWidth - 48) : width

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      {open && (
        <div
          style={{ width: `${displayWidth}px` }}
          className="fixed top-0 right-0 h-full z-50 bg-white dark:bg-[#1e1e1e] shadow-2xl flex flex-col"
        >
          {/* ── Resize handle (barre gauche) — masqué si expanded ── */}
          {!expanded && (
            <div
              onMouseDown={onMouseDown}
              className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize group z-10
                hover:bg-primary/40 active:bg-primary/60 transition-colors"
              title="Glisser pour redimensionner"
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-16
                bg-gray-300 dark:bg-gray-600 group-hover:bg-primary/60 rounded-r-full transition-colors" />
            </div>
          )}

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white truncate pr-4">
              {title}
            </h2>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Expand / Restore — زر واضح بخلفية ملونة */}
              <button
                onClick={toggleExpand}
                title={expanded ? 'Réduire (F11)' : 'Agrandir (F11)'}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
                  expanded
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                    : 'bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-primary/20 dark:hover:text-primary',
                ].join(' ')}
              >
                {expanded ? (
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
                className="w-7 h-7 flex items-center justify-center rounded-md
                  text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                  transition-colors text-lg leading-none"
              >
                &#x2715;
              </button>
            </div>
          </div>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      )}
    </>
  )
}
