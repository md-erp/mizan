/**
 * NumberInput — خانة إدخال رقمية
 *
 * تعمل كـ text input داخلياً لتجنب تعارض type="number" مع React Hook Form،
 * مع تقييد الإدخال لأرقام فقط وعدد محدد من الخانات بعد الفاصلة.
 *
 * decimals: عدد الأرقام المسموح بها بعد الفاصلة (افتراضي: 2)
 */
import React, { forwardRef, useState, useEffect } from 'react'

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  decimals?: number
  min?: string | number
  max?: string | number
}

const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ decimals = 2, min, max, onKeyDown, onChange, onBlur, value: externalValue, ...props }, ref) => {
    // ✅ FIX: استخدام controlled component مع state داخلي
    const [internalValue, setInternalValue] = useState(externalValue ?? '')
    
    // ✅ FIX: تحديث القيمة الداخلية عند تغيير القيمة الخارجية
    useEffect(() => {
      // ✅ FIX BUG 3: Handle 0 and 1 correctly (don't convert to empty string)
      if (externalValue === 0 || externalValue === '0') {
        setInternalValue('0')
      } else if (externalValue === 1 || externalValue === '1') {
        setInternalValue('1')
      } else {
        setInternalValue(externalValue ?? '')
      }
    }, [externalValue])

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      // مفاتيح التحكم — مسموح دائماً
      const controlKeys = [
        'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End',
      ]
      if (controlKeys.includes(e.key)) { onKeyDown?.(e); return }

      // Ctrl/Cmd shortcuts
      if ((e.ctrlKey || e.metaKey) && ['a','c','v','x','z'].includes(e.key.toLowerCase())) {
        onKeyDown?.(e); return
      }

      // أرقام — مسموح
      if (/^\d$/.test(e.key)) { onKeyDown?.(e); return }

      // فاصلة عشرية — مسموح فقط إذا decimals > 0 ولا توجد فاصلة مسبقاً
      if ((e.key === '.' || e.key === ',') && decimals > 0) {
        const val = e.currentTarget.value
        if (val.includes('.')) { e.preventDefault(); return }
        onKeyDown?.(e); return
      }

      // إشارة سالبة — ممنوعة إذا كان min >= 0
      if (e.key === '-') {
        // إذا كان min محدد وأكبر من أو يساوي 0، نمنع الإشارة السالبة
        if (min !== undefined && Number(min) >= 0) {
          e.preventDefault()
          return
        }
        
        // السماح بالإشارة السالبة في البداية فقط
        const input = e.currentTarget
        if (input.selectionStart === 0 && !input.value.includes('-')) {
          onKeyDown?.(e); return
        }
        e.preventDefault(); return
      }

      // منع كل شيء آخر
      e.preventDefault()
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      let val = e.target.value
      console.log('🔍 [NumberInput] handleChange:', val)

      // منع الأرقام السالبة إذا كان min >= 0
      if (min !== undefined && Number(min) >= 0) {
        if (val.startsWith('-')) {
          val = val.substring(1)
        }
      }

      // تقييد max أثناء الكتابة
      if (max !== undefined && val !== '' && val !== '.') {
        const numVal = parseFloat(val)
        if (!isNaN(numVal) && numVal > Number(max)) {
          val = String(max)
        }
      }

      // تقييد عدد الأرقام بعد الفاصلة
      if (decimals >= 0) {
        const dot = val.indexOf('.')
        if (dot !== -1 && val.slice(dot + 1).length > decimals) {
          val = val.slice(0, dot + 1 + decimals)
        }
      }

      // ✅ FIX: تحديث القيمة الداخلية
      console.log('🔍 [NumberInput] setInternalValue:', val)
      setInternalValue(val)
      
      // ✅ FIX: تحديث e.target.value قبل استدعاء onChange
      e.target.value = val
      onChange?.(e)
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      // عند مغادرة الخانة: تنظيف القيمة (إزالة الفاصلة الزائدة في النهاية)
      let val = e.target.value
      let modified = false

      if (val.endsWith('.')) {
        val = val.slice(0, -1)
        modified = true
      }

      // تطبيق min و max
      if (val !== '' && val !== '-') {
        const numVal = parseFloat(val)
        if (!isNaN(numVal)) {
          if (min !== undefined && numVal < Number(min)) {
            val = String(min)
            modified = true
          }
          if (max !== undefined && numVal > Number(max)) {
            val = String(max)
            modified = true
          }
        }
      }

      if (modified) {
        // ✅ FIX: تحديث القيمة الداخلية
        setInternalValue(val)
        
        const input = e.target
        input.value = val
        // إنشاء حدث change جديد لتحديث React Hook Form
        const changeEvent = new Event('change', { bubbles: true })
        input.dispatchEvent(changeEvent)
      }
      onBlur?.(e)
    }

    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={internalValue}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    )
  }
)

NumberInput.displayName = 'NumberInput'

export default NumberInput
