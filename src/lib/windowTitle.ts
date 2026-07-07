/**
 * 同步窗口标题：Tauri 原生窗口标题 + 浏览器标签标题。
 * 标题格式：「文件名 · 好记」（带未保存标记 *）。
 * 多窗口场景下，任务栏/Alt+Tab 能看到文件名，方便切换。
 */

const APP_NAME = '好记'

export async function updateWindowTitle(fileName: string, dirty: boolean): Promise<void> {
  const mark = dirty ? '*' : ''
  const title = fileName ? `${mark}${fileName} · ${APP_NAME}` : APP_NAME

  // 浏览器标签
  document.title = title

  // Tauri 原生窗口标题
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setTitle(title)
    } catch (e) {
      // Tauri API 不可用时静默降级（浏览器标签标题已设）
      console.warn('设置窗口标题失败：', e)
    }
  }
}
