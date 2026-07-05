import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// 样式：基础 + 应用框架 + Markdown 排版 + 第三方
import './styles/base.css'
import './styles/app.css'
import 'katex/dist/katex.min.css'
import './styles/markdown.css'
import './styles/live.css'
// highlight.js 主题由 useTheme 动态切换（亮/暗），不在此静态引入

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
