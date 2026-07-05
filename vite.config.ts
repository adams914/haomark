import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 相对路径，让构建产物可双击 index.html 直接打开（file:// 协议）
  base: './',
})
