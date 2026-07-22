import { useState } from 'react'
import Icon from './Icon'
import type { Tab } from '../lib/tabs'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

/**
 * 标签栏（Chrome/VSCode 风）。
 * 放在 Toolbar 上方一行，横向排列所有 tab。
 *
 * 交互：
 * - 左键点击 tab → 切换
 * - 中键点击 tab → 关闭（浏览器习惯）
 * - tab 上的 × 按钮 → 关闭
 * - 最右 + 按钮 → 新建空白 tab
 * - dirty 的 tab 显示圆点 ●，未 dirty 不显示
 */
export default function TabBar({ tabs, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="tabbar" role="tablist" aria-label="文档标签">
      <div className="tabbar-list">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>
      <button
        className="tabbar-new"
        onClick={onNew}
        title="新标签（未命名）"
        aria-label="新建标签"
      >
        +
      </button>
    </div>
  )
}

interface ItemProps {
  tab: Tab
  active: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

function TabItem({ tab, active, onSelect, onClose }: ItemProps) {
  const [hovered, setHovered] = useState(false)

  // 中键关闭（浏览器/编辑器通用习惯）
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      // 中键
      e.preventDefault()
      onClose(tab.id)
    }
  }

  return (
    <div
      className={`tabbar-item ${active ? 'active' : ''}`}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={tab.filePath ?? tab.fileName}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(tab.id)
        }
      }}
      onAuxClick={handleAuxClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`tabbar-dirty ${tab.dirty ? 'dirty' : ''}`}>●</span>
      <span className="tabbar-name">{tab.fileName}</span>
      {/* × 按钮：active 或 hover 时显示 */}
      <button
        className={`tabbar-close ${(hovered || active) ? 'visible' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onClose(tab.id)
        }}
        aria-label={`关闭 ${tab.fileName}`}
        title="关闭"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
