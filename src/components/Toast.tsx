import { useCallback, useEffect, useState } from 'react'

/**
 * 轻量 toast 提示层。
 * 全局单例，由 useToast() 暴露 show(message, type)。
 * 自动消失（默认 3s，错误 5s）。
 */

export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
}

let listener: ((t: ToastItem) => void) | null = null
let seq = 0

/** 全局显示 toast。可在任意地方（组件内外）调用。 */
export function showToast(message: string, type: ToastItem['type'] = 'info') {
  listener?.({ id: ++seq, message, type })
}

export default function Toast() {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    listener = (t) => {
      setItems((cur) => [...cur, t])
      const ttl = t.type === 'error' ? 5000 : 3000
      setTimeout(() => dismiss(t.id), ttl)
    }
    return () => {
      listener = null
    }
  }, [dismiss])

  if (items.length === 0) return null

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
