import { useEffect, useMemo, useRef } from 'react'
import { extractHeadings, type Heading } from '../lib/outline'

interface Props {
  source: string
  /** 当前光标所在行（用于高亮当前章节）*/
  currentLine?: number
  onJump: (line: number) => void
}

/**
 * 大纲侧边栏：显示文档标题树，点击跳转。
 * 用缩进表达层级，高亮"当前所在章节"。
 */
export default function Outline({ source, currentLine, onJump }: Props) {
  const headings = useMemo(() => extractHeadings(source), [source])
  const listRef = useRef<HTMLDivElement>(null)

  // 当前章节：找到 currentLine 之前的最后一个标题
  const activeKey = useMemo(() => {
    if (!currentLine) return null
    let active: Heading | null = null
    for (const h of headings) {
      if (h.line <= currentLine) active = h
      else break
    }
    return active ? `${active.level}-${active.line}` : null
  }, [headings, currentLine])

  // 滚动激活项进视图
  useEffect(() => {
    if (!activeKey || !listRef.current) return
    const el = listRef.current.querySelector(`[data-key="${activeKey}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  if (headings.length === 0) {
    return (
      <div className="outline">
        <div className="outline-header">大纲</div>
        <div className="outline-empty">文档暂无标题</div>
      </div>
    )
  }

  return (
    <div className="outline" ref={listRef}>
      <div className="outline-header">大纲</div>
      <div className="outline-list">
        {headings.map((h) => {
          const key = `${h.level}-${h.line}`
          const isActive = key === activeKey
          return (
            <div
              key={key}
              data-key={key}
              className={`outline-item level-${h.level} ${isActive ? 'active' : ''}`}
              style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
              role="treeitem"
              tabIndex={0}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onJump(h.line)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onJump(h.line)
                }
              }}
              title={h.text}
            >
              {h.text}
            </div>
          )
        })}
      </div>
    </div>
  )
}
