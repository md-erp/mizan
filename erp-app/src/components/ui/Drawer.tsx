import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  defaultWidth?: number
}

const MIN_WIDTH = 380
const MAX_WIDTH = 1200

export default function Drawer({ open, onClose, title, children, defaultWidth = 600 }: Props) {
  const [width, setWidth] = useState(defaultWidth)
  const dragging = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = width
    document.body.style.cursor    = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      const next  = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />}

      <div
        style={{ width: `${width}px` }}
        className={`fixed top-0 right-0 h-full z-50 bg-white dark:bg-gray-800 shadow-2xl
          flex flex-col transition-transform duration-300
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Resize handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize group z-10
            hover:bg-primary/40 active:bg-primary/60 transition-colors"
          title="Glisser pour redimensionner"
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-12
            bg-gray-300 dark:bg-gray-600 group-hover:bg-primary/60 rounded-r-full transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 select-none">{width}px</span>
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white font-medium transition-colors">
              Fermer
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  )
}
