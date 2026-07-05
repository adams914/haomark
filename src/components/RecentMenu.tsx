import { useEffect, useRef, useState } from 'react'
import { loadRecent, removeRecent, type RecentFile } from '../lib/recentFiles'

interface Props {
  onOpen: (file: RecentFile) => void
  /** 触发刷新的 key（每次外部保存后变化）*/
  refreshKey: number
}

/** 最近文件下拉菜单 */
export default function RecentMenu({ onOpen, refreshKey }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<RecentFile[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setItems(loadRecent())
  }, [refreshKey, open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="recent-menu" ref={ref}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
        title="最近打开的文件"
      >
        最近
      </button>
      {open && (
        <div className="recent-dropdown">
          {items.length === 0 ? (
            <div className="recent-empty">暂无记录</div>
          ) : (
            items.map((f) => (
              <div key={f.name + f.savedAt} className="recent-item">
                <button
                  className="recent-item-main"
                  onClick={() => {
                    onOpen(f)
                    setOpen(false)
                  }}
                  title={f.name}
                >
                  <span className="recent-name">{f.name}</span>
                  <span className="recent-time">{formatTime(f.savedAt)}</span>
                </button>
                <button
                  className="recent-del"
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation()
                    setItems(removeRecent(f.name))
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  return new Date(ts).toLocaleDateString()
}
