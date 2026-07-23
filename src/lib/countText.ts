/**
 * 字数统计：从 Markdown 源码计算"纯文字字符数"和"行数"。
 *
 * 设计：
 * - 用 markdown-it 的 token 流精确剥离语法符号，比手写正则可靠
 *   （能正确区分代码块内容、行内代码、链接文字 vs URL、图片 alt 等）
 * - "纯文字"= 用户真正读到的字符，不含 # ** []() ``` 等语法标记
 * - 中文字一字算一，英文字母/数字也算字符（对标 Word / Notion 的"字符数"）
 * - 代码块内容计入（代码也是用户写的内容），但围栏标记 ``` 和语言名不算
 *
 * 注意：这里是字符数（characters），不是"字数"（words）。
 * 中文场景下字符数更直观（一个汉字 = 1），英文场景下字符数偏大
 * 但和 Word 的"字符数（不计空格）"一致。
 */

import { md } from './renderer'

/**
 * 统计 Markdown 的纯文字字符数和行数。
 * @param src Markdown 源码
 * @returns { chars: 纯文字字符数（不含空格/换行）, charsWithSpace: 含空格, lines: 行数 }
 */
export function countText(src: string): {
  chars: number
  charsWithSpace: number
  lines: number
} {
  if (!src) return { chars: 0, charsWithSpace: 0, lines: 0 }

  // 行数：按换行分割（空文档算 0 行）
  const lines = src === '' ? 0 : src.split(/\r\n|\r|\n/).length

  // 纯文字：遍历 markdown-it token，收集 inline 内容的 text
  let text = ''
  try {
    const tokens = md.parse(src, {})
    text = collectText(tokens)
  } catch {
    // 解析失败（极少见，比如超大文档），退化用粗略正则去语法
    text = src
      .replace(/```[\s\S]*?```/g, '') // 代码块
      .replace(/`[^`]*`/g, '') // 行内代码
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
      .replace(/[#>*_~\-+]/g, '') // 语法符号
  }

  // 字符数：去掉所有空白（空格、换行、制表符）后的长度
  const noSpace = text.replace(/\s/g, '')
  return {
    chars: noSpace.length,
    charsWithSpace: text.length,
    lines,
  }
}

/**
 * 递归收集 token 流里的纯文字。
 * - inline token：遍历 children，只收 text，跳过 code_inline/link/image 的标记
 * - 代码块：收内容（代码也是内容），但 fence 标记本身不算
 * - 其他块（heading_open/paragraph_open 等）：只收其后的 inline 内容
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectText(tokens: any[]): string {
  let result = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue

    // inline 内容（段落、标题、列表项的文字都在这）
    if (t.type === 'inline' && t.children) {
      result += collectInline(t.children)
      continue
    }

    // 代码块（fence/缩进）：收 content，它是真实代码内容
    if (t.type === 'fence' || t.type === 'code_block') {
      if (t.content) result += '\n' + t.content + '\n'
      continue
    }

    // html_block：剥离标签，收里面的文字
    if (t.type === 'html_block' && t.content) {
      result += t.content.replace(/<[^>]+>/g, '')
      continue
    }
  }
  return result
}

/**
 * 收集 inline children 里的纯文字。
 * 跳过：code_inline（反引号代码）、softbreak/hardbreak 换行标记、
 * 链接的 URL（open/close 标记）、图片（image token 整体跳过，alt 不算正文字数）。
 * 收：text token 的内容。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectInline(children: any[]): string {
  let result = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of children) {
    if (!c) continue
    if (c.type === 'text' && c.content) {
      result += c.content
    } else if (c.type === 'code_inline' && c.content) {
      // 行内代码内容也算（用户写的内容）
      result += c.content
    }
    // image / link_open / link_close / softbreak / hardbreak / em_open / strong_open 等
    // 的标记符号都不收
  }
  return result
}
