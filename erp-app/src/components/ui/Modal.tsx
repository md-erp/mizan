import { useEffect, useRef } from 'react'

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
  const depthRef = useRef(0)

  useEffect(() => {
    if (!open) return
    modalDepth++
    depthRef.current = modalDepth
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => {
      modalDepth--
      window.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  if (!open) return null

  const zClass = depthRef.current > 1 ? 'z-[60]' : 'z-50'

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm`}
    >
      <div className={`card w-full ${SIZES[size]} shadow-xl flex flex-col max-h-[90vh]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none">✕</button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}
