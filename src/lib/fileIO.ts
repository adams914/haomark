/**
 * 文件读写层。
 * 自动检测运行环境：
 * - Tauri 桌面端：用原生命令读写真实文件（写回原路径、原生对话框）
 * - 浏览器端：用 FileReader + 下载（沙箱限制）
 */

const ACCEPTED_EXT = ['.md', '.markdown', '.mdown', '.mdx', '.txt']

/** 是否运行在 Tauri 桌面环境 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXT.some((ext) => lower.endsWith(ext))
}

/** 把 File 读成文本（浏览器环境用） */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

export function pickDroppedFile(e: DragEvent): File | null {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return null
  for (let i = 0; i < files.length; i++) {
    if (isAcceptedFile(files[i].name)) return files[i]
  }
  return files[0]
}

/** 浏览器下载（fallback）*/
export function saveTextAsFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'untitled.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ===== Tauri 环境的命令封装 =====

interface OpenResult {
  path: string
  name: string
  content: string
}

/** Tauri：用原生对话框打开文件，返回路径+文件名+内容 */
export async function tauriOpenFile(): Promise<OpenResult | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const path: string | null = await invoke('pick_open_file')
  if (!path) return null
  const content = await invoke<string>('read_file', { path })
  const name = path.split(/[\\/]/).pop() ?? 'untitled.md'
  return { path, name, content }
}

/** Tauri：取走启动文件（双击 .md 打开时）*/
export async function tauriTakeStartupFile(): Promise<OpenResult | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const path: string | null = await invoke('take_startup_file')
  if (!path) return null
  const content = await invoke<string>('read_file', { path })
  const name = path.split(/[\\/]/).pop() ?? 'untitled.md'
  return { path, name, content }
}

/** Tauri：写回原文件。有 path 就直接写，否则弹另存为对话框。返回最终路径。 */
export async function tauriSaveFile(
  content: string,
  currentPath: string | null,
  defaultName: string,
): Promise<string | null> {
  if (!isTauri()) {
    saveTextAsFile(content, defaultName)
    return null
  }
  const { invoke } = await import('@tauri-apps/api/core')
  let path = currentPath
  if (!path) {
    path = await invoke<string | null>('pick_save_file', { defaultName })
    if (!path) return null
  }
  await invoke('write_file', { path, content })
  return path
}
