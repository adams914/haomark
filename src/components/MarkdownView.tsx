import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import { renderMarkdown } from '../lib/renderer'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
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
      // mermaid 期望文本直接放在元素里
      block.removeAttribute('data-raw')
      block.innerHTML = escapeForMermaid(raw)
      // mermaid.run 按 class .mermaid + 无 data-processed 识别
      void block.setAttribute('data-idx', String(idx))
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

/** Mermaid 内容里我们用 data-raw 已转义存储，这里反转义回原始文本。 */
function escapeForMermaid(raw: string): string {
  // data-raw 经过 escapeAttr 存储：&amp; &lt; &gt; &quot;
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
