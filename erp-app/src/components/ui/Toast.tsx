import { useEffect, useState, useRef } from 'react'

export type ToastType = 'success' | 'error' | 'warning'

interface Toast {
  id: number
  message: string
  type: ToastType
  startTime: number
}

let addToastFn: ((msg: string, type: ToastType) => void) | null = null

export function toast(message: string, type: ToastType = 'success') {
  addToastFn?.(message, type)
}

const ICONS = { success: '✅', error: '❌', warning: '⚠️' }
const COLORS = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300',
  error:   'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300',
  warning: 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
}
const PROGRESS_COLORS = {
  success: 'bg-green-500',
  error:   'bg-red-500',
  warning: 'bg-orange-500',
}

const TOAST_DURATION = 5000 // 5 ثواني

function ToastItem({ toast: t, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout>()
  const timeoutRef = useRef<NodeJS.Timeout>()
  const startTimeRef = useRef(Date.now())
  const pausedElapsedRef = useRef(0)

  useEffect(() => {
    const updateProgress = () => {
      if (isPaused) return
      
      const elapsed = Date.now() - startTimeRef.current + pausedElapsedRef.current
      const newProgress = Math.min(100, (elapsed / TOAST_DURATION) * 100)
      setProgress(newProgress)
      
      if (newProgress >= 100) {
        onRemove(t.id)
      }
    }

    // تحديث كل 50ms للحصول على حركة سلسة
    intervalRef.current = setInterval(updateProgress, 50)
    
    // timeout احتياطي
    timeoutRef.current = setTimeout(() => onRemove(t.id), TOAST_DURATION)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [t.id, isPaused, onRemove])

  const handleMouseEnter = () => {
    if (!isPaused) {
      // حفظ الوقت المنقضي الحالي
      const currentElapsed = Date.now() - startTimeRef.current + pausedElapsedRef.current
      pausedElapsedRef.current = currentElapsed
      setIsPaused(true)
    }
  }

  const handleMouseLeave = () => {
    if (isPaused) {
      // استئناف من النقطة المحفوظة
      startTimeRef.current = Date.now()
      setIsPaused(false)
    }
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex flex-col gap-1 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium
        pointer-events-auto animate-in slide-in-from-right-4 overflow-hidden
        transition-all ${COLORS[t.type]}`}>
      <div className="flex items-center gap-2">
        <span>{ICONS[t.type]}</span>
        <span className="flex-1">{t.message}</span>
      </div>
      {/* شريط التقدم - من اليمين إلى اليسار */}
      <div className="h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${PROGRESS_COLORS[t.type]} transition-all ${
            isPaused ? '' : 'duration-75'
          }`}
          style={{ width: `${100 - progress}%`, marginLeft: 'auto' }}
        />
      </div>
    </div>
  )
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    addToastFn = (message, type) => {
      const id = Date.now() + Math.random()
      const newToast: Toast = { 
        id, 
        message, 
        type, 
        startTime: Date.now() 
      }
      setToasts(prev => [...prev, newToast])
    }
    return () => { addToastFn = null }
  }, [])

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={removeToast} />
      ))}
    </div>
  )
}
