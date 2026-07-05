/// <reference types="vite/client" />

// 允许以原始字符串形式导入 .md 文件
declare module '*.md?raw' {
  const content: string
  export default content
}
