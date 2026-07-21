import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import { renderMarkdown } from '../lib/renderer'

// securityLevel: 'strict' 拒绝在 mermaid 标签里执行任意 HTML/JS。
// 之前用 'loose' 是 XSS 入口——用户打开来路不明的 .md 时，mermaid 标签里
// 的 <img onerror=...> 会执行，在 Tauri 上下文里能访问文件系统。
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  // 中文字体回退
  flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
})

interface Props {
  source: string
}

/**
 * 渲染容器：把 Markdown 渲染为 HTML 并处理 Mermaid 异步渲染。
 * 每次 source 变化，重新生成 innerHTML 并运行 mermaid.run()。
 */
export default function MarkdownView({ source }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 1. 生成 HTML
    const html = renderMarkdown(source)
    el.innerHTML = html

    // 2. 处理 Mermaid 占位：把 data-raw 还原为文本，再 run
    const mermaidBlocks = el.querySelectorAll<HTMLPreElement>('pre.mermaid')
    if (mermaidBlocks.length === 0) return

    mermaidBlocks.forEach((block, idx) => {
      const raw = block.getAttribute('data-raw') ?? ''
      // 安全要点：用 textContent 而非 innerHTML。
      // data-raw 经 escapeAttr 存储，浏览器 getAttribute 已自动解码回原始文本。
      // 设 textContent 保证 mermaid 源码作为纯文本注入，不会触发 HTML 解析。
      block.removeAttribute('data-raw')
      block.textContent = raw
      // mermaid.run 按 class .mermaid + 无 data-processed 识别
      void block.setAttribute('data-idx', String(idx))
      void idx
    })

    let cancelled = false
    mermaid
      .run({ nodes: Array.from(mermaidBlocks) })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[Mermaid] 渲染失败：', err)
          // 失败时把原始代码显示出来，便于排查
          mermaidBlocks.forEach((b) => {
            if (!b.querySelector('svg')) {
              b.classList.add('mermaid-error')
            }
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [source])

  return <div ref={ref} className="markdown-body" />
}
