import type { SVGProps } from 'react'

/**
 * 统一 SVG 图标组件（v2.1 Notion 风）。
 *
 * 设计规范：
 * - 24x24 viewBox
 * - stroke 风格（不用 fill），stroke-width 1.5
 * - stroke-linecap round + stroke-linejoin round（圆角，柔和感）
 * - 尺寸默认 16px，可通过 size prop 调整
 * - 颜色默认 currentColor（跟随父元素文字色，自动适配主题）
 */

export type IconName =
  | 'menu'           // 大纲开关（原 ☰）
  | 'settings'       // 设置（原 ⚙）
  | 'sun'            // 亮色主题（原 ☀）
  | 'moon'           // 暗色主题（原 ☾）
  | 'system'         // 跟随系统（原 ◐）
  | 'minus'          // 缩小字号（原 A−）
  | 'plus'           // 放大字号（原 A+）
  | 'save'           // 保存（原 ⇩）
  | 'save-all'       // 保存全部（原 ⇩⇩）
  | 'open'           // 打开文件
  | 'close'          // 关闭（原 ×）
  | 'arrow-down'     // 下拉箭头（原 ⬇）
  | 'info'           // 信息提示
  | 'success'        // 成功提示
  | 'error'          // 错误提示
  | 'basic'          // 基础设置分类
  | 'editor'         // 编辑设置分类
  | 'render'         // 渲染设置分类
  | 'app'            // 应用设置分类
  | 'reset'          // 重置（原 ↺）

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

const paths: Record<IconName, React.ReactNode> = {
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.2 4.2l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.2-4.2l4.2-4.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </>
  ),
  moon: (
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  ),
  system: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  save: (
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
  ),
  'save-all': (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="9 11 12 14 22 4" transform="scale(0.5) translate(12, 12)" />
    </>
  ),
  open: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  'arrow-down': (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12 11 15 16 9" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
  basic: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  editor: (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </>
  ),
  render: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  app: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  reset: (
    <>
      <path d="M3 2v6h6" />
      <path d="M21 12a9 9 0 1 0-9-9" />
    </>
  ),
}

export default function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
