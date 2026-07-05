/**
 * 大纲提取：从 Markdown 源码解析标题，返回 {level, text, line} 列表。
 * 跳过代码围栏内的 # 行（避免把代码注释误判为标题）。
 */
export interface Heading {
  level: number // 1~6
  text: string
  line: number // 1 基行号
}

export function extractHeadings(src: string): Heading[] {
  const headings: Heading[] = []
  const lines = src.split(/\r\n|\r|\n/)
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]

    // 代码围栏开关
    const fence = text.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (text.includes(fenceMarker.repeat(3))) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    // 标题 # ~ ######
    const m = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) {
      headings.push({
        level: m[1].length,
        text: m[2].replace(/[*_`~]/g, ''), // 去掉内联标记，大纲显示纯文本
        line: i + 1,
      })
    }
  }

  return headings
}
