import { useState } from 'react'
import Icon from './Icon'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type BasicSettings,
  type EditorSettings,
  type RenderSettings,
  type AppSettings,
} from '../lib/settings'
import type { Theme } from '../lib/useTheme'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  onReset: () => void
}

type Category = 'basic' | 'editor' | 'render' | 'app'

const CATEGORY_LABELS: Record<Category, string> = {
  basic: '基础',
  editor: '编辑',
  render: '渲染',
  app: '应用',
}

/**
 * 设置对话框：左侧分类，右侧表单。
 * 修改即时生效（onChange 每次改动都触发，父组件负责持久化）。
 */
export default function SettingsDialog({ settings, onChange, onClose, onReset }: Props) {
  const [category, setCategory] = useState<Category>('basic')

  const update = (patch: Partial<BasicSettings & EditorSettings & RenderSettings & AppSettings>) => {
    // 根据当前分类分发到对应 section
    if (category === 'basic') onChange({ ...settings, basic: { ...settings.basic, ...(patch as Partial<BasicSettings>) } })
    else if (category === 'editor') onChange({ ...settings, editor: { ...settings.editor, ...(patch as Partial<EditorSettings>) } })
    else if (category === 'render') onChange({ ...settings, render: { ...settings.render, ...(patch as Partial<RenderSettings>) } })
    else onChange({ ...settings, app: { ...settings.app, ...(patch as Partial<AppSettings>) } })
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-sidebar">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
            <button
              key={cat}
              className={`settings-nav ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
          <div className="settings-nav-spacer" />
          <button className="settings-nav settings-reset" onClick={onReset} title="恢复默认设置">
            <Icon name="reset" size={14} /> 重置
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-header">
            <h2>{CATEGORY_LABELS[category]}偏好</h2>
            <button className="settings-close" onClick={onClose} aria-label="关闭">
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="settings-content">
            {category === 'basic' && (
              <BasicSection settings={settings.basic} update={update} />
            )}
            {category === 'editor' && (
              <EditorSection settings={settings.editor} update={update} />
            )}
            {category === 'render' && (
              <RenderSection settings={settings.render} update={update} />
            )}
            {category === 'app' && (
              <AppSection settings={settings.app} update={update} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// === 基础偏好 ===
function BasicSection({
  settings,
  update,
}: {
  settings: BasicSettings
  update: (patch: Partial<BasicSettings>) => void
}) {
  return (
    <>
      <Field label="主题" desc="亮色 / 暗色 / 跟随系统">
        <select
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as Theme })}
        >
          <option value="auto">跟随系统</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </Field>

      <Field label={`字号（${settings.fontSize}px）`} desc="编辑器文字大小">
        <input
          type="range"
          min="11"
          max="24"
          value={settings.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </Field>

      <Field label="字体" desc="编辑器字体族">
        <select
          value={settings.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value as BasicSettings['fontFamily'] })}
        >
          <option value="system">系统默认</option>
          <option value="sans">无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
      </Field>

      <Field label={`最近文件数（${settings.recentFilesLimit}）`} desc="最近打开文件列表上限">
        <input
          type="range"
          min="5"
          max="20"
          value={settings.recentFilesLimit}
          onChange={(e) => update({ recentFilesLimit: Number(e.target.value) })}
        />
      </Field>
    </>
  )
}

// === 编辑偏好 ===
function EditorSection({
  settings,
  update,
}: {
  settings: EditorSettings
  update: (patch: Partial<EditorSettings>) => void
}) {
  return (
    <>
      <Field label="自动保存" desc="修改后定时自动写回文件">
        <select
          value={String(settings.autoSaveInterval)}
          onChange={(e) => update({ autoSaveInterval: Number(e.target.value) as EditorSettings['autoSaveInterval'] })}
        >
          <option value="0">关闭</option>
          <option value="30">30 秒</option>
          <option value="60">60 秒</option>
          <option value="120">2 分钟</option>
        </select>
      </Field>

      <Field label="拼写检查" desc="浏览器原生拼写检查（红色下划线）">
        <Toggle value={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} />
      </Field>

      <Field label="行号" desc="源码模式下显示行号">
        <Toggle value={settings.showLineNumbers} onChange={(v) => update({ showLineNumbers: v })} />
      </Field>

      <Field label="软换行" desc="长行自动换行而非横向滚动">
        <Toggle value={settings.lineWrapping} onChange={(v) => update({ lineWrapping: v })} />
      </Field>
    </>
  )
}

// === 渲染偏好 ===
function RenderSection({
  settings,
  update,
}: {
  settings: RenderSettings
  update: (patch: Partial<RenderSettings>) => void
}) {
  return (
    <>
      <Field label="Mermaid 主题" desc="流程图/时序图等配色">
        <select
          value={settings.mermaidTheme}
          onChange={(e) => update({ mermaidTheme: e.target.value as RenderSettings['mermaidTheme'] })}
        >
          <option value="auto">跟随应用</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </Field>

      <Field label="代码高亮" desc="代码块配色主题">
        <select
          value={settings.codeHighlightTheme}
          onChange={(e) => update({ codeHighlightTheme: e.target.value as RenderSettings['codeHighlightTheme'] })}
        >
          <option value="github">GitHub</option>
          <option value="github-dark">GitHub Dark</option>
        </select>
      </Field>

      <Field label="渲染数学公式" desc="关闭则 $...$ 当作普通文本">
        <Toggle value={settings.renderMath} onChange={(v) => update({ renderMath: v })} />
      </Field>

      <Field label="渲染图片" desc="关闭则 ![](url) 当作普通文本">
        <Toggle value={settings.renderImages} onChange={(v) => update({ renderImages: v })} />
      </Field>
    </>
  )
}

// === 应用偏好 ===
function AppSection({
  settings,
  update,
}: {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}) {
  return (
    <>
      <Field label="检查更新" desc="自动检查新版本的频率">
        <select
          value={settings.updateCheckInterval}
          onChange={(e) => update({ updateCheckInterval: e.target.value as AppSettings['updateCheckInterval'] })}
        >
          <option value="startup">每次启动</option>
          <option value="daily">每天一次</option>
          <option value="manual">仅手动</option>
        </select>
      </Field>

      <Field label="更新通道" desc="稳定版或抢先体验版">
        <select
          value={settings.updateChannel}
          onChange={(e) => update({ updateChannel: e.target.value as AppSettings['updateChannel'] })}
        >
          <option value="stable">稳定版</option>
          <option value="beta">抢先版</option>
        </select>
      </Field>

      <Field label="数据位置" desc="设置和 tab 状态存储位置（只读）">
        <code className="settings-data-path">
          {typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
            ? '%APPDATA%\\好记\\'
            : '浏览器 localStorage'}
        </code>
      </Field>
    </>
  )
}

// === 通用控件 ===
function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <div className="settings-field-name">{label}</div>
        {desc && <div className="settings-field-desc">{desc}</div>}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="toggle-knob" />
    </button>
  )
}

// 防止未使用警告（DEFAULT_SETTINGS 在 onReset 时由父组件用）
export { DEFAULT_SETTINGS }
