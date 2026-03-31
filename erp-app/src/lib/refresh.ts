export function emitRefresh() {
  window.dispatchEvent(new CustomEvent('app:refresh'))
}

// Hook يستمع لحدث التحديث العام ويستدعي الدالة المعطاة
export function useAppRefresh(fn: () => void) {
  const fnRef = { current: fn }
  fnRef.current = fn
  if (typeof window !== 'undefined') {
    // نستخدم pattern بسيط — يُضاف في useEffect من المكون
  }
  return fnRef
}
