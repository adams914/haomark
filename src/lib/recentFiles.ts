/**
 * 最近文件管理（浏览器环境）。
 * 浏览器沙箱下无法持久化真实文件路径，这里存"文件名 + 内容快照"，
 * 让用户能快速回到最近编辑过的文档。
 * 阶段四 Tauri 化后改为存真实路径。
 */

const KEY = 'md-viewer-recent'
const MAX = 10

export interface RecentFile {
  name: string
  content: string
  savedAt: number
}

export function loadRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as RecentFile[]
    return Array.isArray(arr) ? arr.slice(0, MAX) : []
  } catch {
    return []
  }
}

/** 记录/更新一个最近文件（去重，置顶，截断）*/
export function addRecent(name: string, content: string): void {
  try {
    const list = loadRecent().filter((f) => f.name !== name)
    list.unshift({ name, content, savedAt: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // localStorage 满或禁用，静默失败
  }
}

export function removeRecent(name: string): RecentFile[] {
  const list = loadRecent().filter((f) => f.name !== name)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
  return list
}
