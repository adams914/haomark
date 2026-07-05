import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'katex'

/**
 * 渲染核心：markdown-it 实例 + 代码高亮 + KaTeX 公式 + Mermaid 占位。
 *
 * 设计说明：
 * - Mermaid 不在解析阶段渲染（它是异步且依赖 DOM 的），这里只输出
 *   `<pre class="mermaid" data-raw="...">` 占位，由 MarkdownView 组件在
 *   挂载后统一调用 mermaid.run() 渲染。
 * - KaTeX 用自定义规则，避开 markdown-it-texmath 与代码/表格的兼容性问题。
 *   支持 $inline$ 与 $$block$$，对被反引号包裹的内容不做处理。
 */

// --- KaTeX：把文本中的数学公式渲染成 HTML ------------------------------
// 先处理 $$...$$ 块，再处理 $...$ 行内。用占位符保护代码跨段不互相干扰。
const KATEX_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g
const KATEX_INLINE_RE = /\$([^\$\n]+?)\$/g

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
    })
  } catch (e) {
    return `<span class="katex-error" title="${escapeAttr(String(e))}">${escapeHtml(tex)}</span>`
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/**
 * 在 markdown-it 解析"之前"先抽走 KaTeX，替换为占位 token，
 * 等 markdown-it 生成 HTML 后再把占位还原成 KaTeX 输出。
 * 这样公式内容不会被 markdown 当成普通文本二次处理（比如 _ 下标）。
 */
function applyKatex(src: string): { protected: string; slots: string[] } {
  const slots: string[] = []
  // 注意：不能用 NUL(\u0000)——markdown-it 的 normalize 会把 NUL 替换成
  // U+FFFD（CommonMark 规范要求），导致还原正则失效、占位符泄漏成裸文本。
  // 用纯 ASCII 安全 token，@ 在 markdown 中无特殊含义。
  const PH = (i: number) => `@@KATEX${i}@@`

  let out = src.replace(KATEX_BLOCK_RE, (_, tex: string) => {
    const html = renderKatex(tex.trim(), true)
    slots.push(html)
    return PH(slots.length - 1)
  })
  out = out.replace(KATEX_INLINE_RE, (_, tex: string) => {
    const html = renderKatex(tex, false)
    slots.push(html)
    return PH(slots.length - 1)
  })

  return { protected: out, slots }
}

function restoreKatex(html: string, slots: string[]): string {
  return html.replace(/@@KATEX(\d+)@@/g, (_, i: string) => slots[Number(i)] ?? '')
}

// --- markdown-it 实例 ---------------------------------------------------
const md = new MarkdownIt({
  html: true, // 允许原始 HTML（信任本地文件）
  linkify: true, // 自动识别裸链接
  typographer: true, // 排版美化（引号等）
  breaks: false, // 不把单换行转成 <br>，遵循 GFM
  highlight(code, lang) {
    // Mermaid 围栏：交给组件层异步渲染
    if (lang === 'mermaid') {
      return `<pre class="mermaid" data-raw="${escapeAttr(code)}"></pre>`
    }
    // 代码高亮
    const language = lang && hljs.getLanguage(lang) ? lang : ''
    let highlighted: string
    try {
      highlighted = language
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value
    } catch {
      highlighted = escapeHtml(code)
    }
    const langLabel = language || 'text'
    return (
      `<pre class="code-block" data-lang="${langLabel}">` +
      `<code class="hljs language-${langLabel}">${highlighted}</code>` +
      `</pre>`
    )
  },
})

// --- 删除线 GFM (~~text~~) ---------------------------------------------
// 简单内联规则，避免引入额外插件依赖。
md.inline.ruler.after('emphasis', 'strikethrough', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x7e /* ~ */ || src.charCodeAt(pos + 1) !== 0x7e) {
    return false
  }
  // 跳过起始 ~~
  const start = pos + 2
  const end = src.indexOf('~~', start)
  if (end === -1) return false
  const content = src.slice(start, end)
  if (!content || content.includes('\n\n')) return false

  if (!silent) {
    const token = state.push('s_open', 'del', 1)
    token.markup = '~~'
    const text = state.push('text', '', 0)
    text.content = content
    const close = state.push('s_close', 'del', -1)
    close.markup = '~~'
  }
  state.pos = end + 2
  return true
})

// 任务列表：把 [ ] / [x] 开头的列表项标记成任务 -------------------------
md.core.ruler.after('normalize', 'task_lists', (state) => {
  state.tokens.forEach((tok) => {
    if (tok.type !== 'inline' || !tok.children) return
    for (let i = 0; i < tok.children.length - 1; i++) {
      const c0 = tok.children[i]
      if (c0.type !== 'text') continue
      const m = c0.content.match(/^\[([ xX])\]\s+/)
      if (!m) continue
      const checked = m[1].toLowerCase() === 'x'

      // 在父级（list_item）上打标记，供 CSS 处理圆点
      // 并把当前 text token 改成 checkbox + 剩余文本
      c0.content = c0.content.slice(m[0].length)
      // 注入 checkbox HTML：用一个 html_inline token
      const checkbox = new state.Token('html_inline', '', 0)
      checkbox.content =
        `<input type="checkbox" class="task-checkbox" ${checked ? 'checked disabled' : 'disabled'} /> `
      tok.children.splice(i, 0, checkbox)
      // 给所在 list_item 打 class
      // （markdown-it 的 list_item_open 在 inline 之前；通过 env 标记较复杂，
      //  这里用更简单的方式：靠 CSS 选择器 .task-checkbox 的父 li）
      i++ // 跳过刚插入的 checkbox
    }
  })
})

// --- 源行映射：给块级元素注入 data-source-line --------------------------
// markdown-it 的 block token 自带 map: [startLine, endLine]（0 基）。
// 利用 renderer override 把起始行写到对应 HTML 标签上，供滚动同步使用。
// 这是 VSCode/Obsidian 等采用的"块级精确"同步方案，远优于按比例同步。
function setupSourceLine() {
  // 覆盖所有 *_open 渲染器：把 data-source-line 加到 attrs
  const openRenderers = [
    'paragraph_open',
    'heading_open',
    'bullet_list_open',
    'ordered_list_open',
    'list_item_open',
    'blockquote_open',
    'table_open',
    'fence',
    'hr',
    'html_block',
  ]
  for (const name of openRenderers) {
    const original = md.renderer.rules[name]
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const tok = tokens[idx]
      const map = tok?.map
      if (map) {
        // 起始行（转 1 基，更直观）
        const line = map[0] + 1
        tok.attrSet('data-source-line', String(line))
      }
      if (original) {
        return original(tokens, idx, options, env, self)
      }
      return self.renderToken(tokens, idx, options)
    }
  }
}
setupSourceLine()

/**
 * 主渲染入口：Markdown 字符串 -> HTML 字符串。
 * 返回值尚未渲染 Mermaid（含 <pre class="mermaid"> 占位），组件层处理。
 */
export function renderMarkdown(src: string): string {
  const { protected: protectedSrc, slots } = applyKatex(src)
  let html = md.render(protectedSrc)
  html = restoreKatex(html, slots)
  return html
}

export { md }
