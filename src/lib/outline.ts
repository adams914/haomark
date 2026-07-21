/**
 * 大纲提取：基于 @lezer/markdown 语法树解析标题。
 *
 * v2.0 改造：从手写正则 + inFence 状态机 → 直接用 markdown 解析器。
 * 优势：
 * - 代码围栏内的 `# comment` 不会被误判为标题（语法树天然区分 CodeText 与 ATXHeading）
 * - 正确识别 Setext 标题（`标题\n===` / `标题\n---`）
 * - 闭合 `#` 序列、前导 `#` 数量、必须后跟空格等 CommonMark 规则由解析器保证
 *
 * 性能：parser.parse(src) 是同步全量解析，无惰性问题（不像 syntaxTree 依赖 viewport）。
 * 10 万行文档约 50-100ms，配合 useDeferredValue 使用不阻塞输入。
 */
import { parser } from '@lezer/markdown'
import { Text } from '@codemirror/state'

export interface Heading {
  level: number // 1~6
  text: string
  line: number // 1 基行号
}

export function extractHeadings(src: string): Heading[] {
  const headings: Heading[] = []
  // 用 Text.of 算行号（与 CodeMirror 一致，正确处理 \r\n / \r / \n）
  const doc = Text.of(src.split(/\r\n|\r|\n/))
  const tree = parser.parse(src)

  tree.iterate({
    enter(node) {
      // ATX 标题：节点名 ATXHeading1 ~ ATXHeading6
      // Setext 标题：SetextHeading1 / SetextHeading2（下划线式，少见但合法）
      if (node.name.startsWith('ATXHeading')) {
        pushHeading(node.name.slice('ATXHeading'.length), node.from, node.to)
        return false
      }
      if (node.name === 'SetextHeading1') {
        pushHeading('1', node.from, node.to)
        return false
      }
      if (node.name === 'SetextHeading2') {
        pushHeading('2', node.from, node.to)
        return false
      }
      return
    },
  })

  return headings

  function pushHeading(levelStr: string, from: number, to: number) {
    const level = Math.max(1, Math.min(6, Number(levelStr) || 1))
    const raw = src.slice(from, to)
    // ATX: 去掉前导 #+空格 和 尾部 #+ 序列
    // Setext: 去掉下划线行（=== / ---），只留标题文本
    const text = cleanHeadingText(raw)
    if (!text) return
    const line = doc.lineAt(from).number
    headings.push({ level, text, line })
  }
}

/**
 * 清理标题文本：去掉 # 标记、下划线分隔行、内联格式标记。
 * 例：
 *   '## Hello **World** ##' → 'Hello World'
 *   'Title\n==='           → 'Title'
 */
function cleanHeadingText(raw: string): string {
  return raw
    // 按行处理（Setext 标题有两行）
    .split(/\n/)
    // Setext 第二行是 === / --- ，过滤掉（只留非纯分隔符行）
    .filter((line) => !/^\s*(=+|-+)\s*$/.test(line))
    .join(' ')
    // 去掉前导 # 和空格
    .replace(/^#{0,6}\s+/, '')
    // 去掉尾部闭合 # 序列
    .replace(/\s+#+\s*$/, '')
    // 去掉内联格式标记（粗体/斜体/代码/删除线）
    .replace(/[*_`~]/g, '')
    .trim()
}
