# 好记 · HaoMark

> 轻量、快速、实时渲染的 Markdown 编辑器。4.9MB 安装包，.md 文件双击秒开。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue)](https://v2.tauri.app/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)

因为 TypeDown 打开 .md 文件越来越慢（30 秒起步）、GitHub 仓库已停更（10 个月没提交），于是自己搓了一个。

没有臃肿的 Chromium 套壳，安装包只有 4.9MB——TypeDown 的二十分之一。.md 文件双击秒开，Ctrl+S 写回原文件，实时渲染的编辑体验对标 Obsidian。

## 🎉 v2.0 更新

v2.0 是大版本重构，从「能用的编辑器」升级为「成熟稳定的 Obsidian 级体验」：

- **🗂️ 多标签页**：Chrome/VSCode 风，可同时打开多个文档，每 tab 独立保留光标、撤销栈、滚动位置。关闭重开自动恢复（含未保存内容）。
- **🎛️ 设置面板**：基础 / 编辑 / 渲染 / 应用四类偏好，即时生效，自动持久化。旧偏好自动迁移。
- **🌲 渲染核心重写**：从手写正则升级为 CodeMirror markdown 语法树，根治三类解析不一致（行内代码内 `$x$` 不再被误识别为公式、标题内强调能渲染、代码围栏内假标题不进大纲）。
- **🔒 数据安全**：保存原子写入（断电不损坏）、关闭窗口扫所有未保存文档、单实例锁 + 双击转发、GBK/UTF-16 编码自动识别。
- **⚡ 性能优化**：release profile LTO + strip，打包体积更小。

## ✨ 特性

### 实时渲染（Obsidian 风）
- 光标所在的行显示源码，其余行自动渲染
- **点击**代码块 / 表格 / 公式 / Mermaid 图，即时进入编辑
- 移走光标，自动渲染回去
- 原始 Markdown 始终是唯一数据源，复制 / 保存零信息损失

### 完整渲染能力
- 📝 GFM 全语法（表格、任务列表、删除线、自动链接）
- 🎨 代码高亮（highlight.js，自动语言检测）
- 📐 数学公式（KaTeX，`$...$` 行内 + `$$...$$` 块级）
- 🔀 Mermaid 流程图 / 时序图 / 饼图
- 📷 图片直接渲染（含引用式 `![][label]`、HTML `<img>`、data URI）

### 三种视图
- **实时**：边写边渲染（默认）
- **源码**：纯 Markdown 文本
- **预览**：完整渲染，只读

### 产品体验
- 🗂️ 多标签页（Chrome 风，Ctrl+Alt+S 保存全部）
- 🌙 暗色模式（亮 / 暗 / 跟随系统，含代码高亮主题切换）
- 📑 大纲导航（自动生成目录，点击跳转，高亮当前章节）
- ⌨️ 快捷键（Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+E 代码 / Ctrl+S 保存 / Ctrl+Alt+S 保存全部）
- 🔤 字号调节、🕘 最近文件
- 📥 拖拽打开（支持多文件）、双击 .md 文件关联启动
- 🎛️ 设置面板（主题/字号/字体/自动保存/拼写/行号/换行/公式/图片/更新）
- 💾 原子写保存、单实例锁、窗口状态记忆、编码自动识别

## 📦 下载安装

前往 [Releases](../../releases) 下载最新的 `好记_x.x.x_x64-setup.exe`（Windows）。

安装后：
- .md / .markdown / .mdx / .mdown 文件默认用「好记」打开
- 任务栏 / 开始菜单显示羽毛图标
- 关联的 .md 文件显示吉祥物图标

> 也提供免安装版 `haoji.exe`，可直接运行（不注册文件关联）。

## 🚀 从源码构建

### 环境要求
- Node.js 18+
- pnpm 10+
- Rust 1.77+（含 MSVC 构建工具）

### 步骤

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm tauri dev

# 构建安装包（产出在 src-tauri/target/release/bundle/）
pnpm tauri build
```

仅网页版（不需要桌面化）：
```bash
pnpm dev      # 开发
pnpm build    # 产出 dist/，可双击 index.html 使用
```

## 🛠 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| 框架 | React 19 + TypeScript + Vite | 前端工程 |
| 编辑器 | CodeMirror 6 | 轻量编辑器（~50KB，比 Monaco 轻 100 倍） |
| 解析 | markdown-it | Markdown → HTML |
| 高亮 | highlight.js | 代码语法高亮 |
| 公式 | KaTeX | 数学公式渲染 |
| 图表 | Mermaid | 流程图 / 时序图等 |
| 桌面壳 | Tauri 2.0 | 原生窗口、文件系统、文件关联 |

## 🧠 实现亮点

### 点击块即编辑（突破 CodeMirror 限制）
CodeMirror 6 的 block widget 光标无法通过点击进入。好记通过「widget 拦截 mousedown → 主动 dispatch 光标进块 → 装饰层检测光标 → 撤掉替换装饰 → 源码显现」的闭环，实现了和 Obsidian 一致的体验。

### 渲染双层架构（v2.0 语法树版）
- **内联装饰（ViewPlugin）**：基于 `syntaxTree.iterate` 遍历 CodeMirror markdown 语法树，零正则，与 CommonMark 规范天然一致
- **块级装饰（StateField）**：代码块 / 表格从 `FencedCode` / `Table` 节点拿，光标进入即转源码
- **大纲**：`@lezer/markdown` 同步全量解析，代码围栏内的假标题天然排除

详见 [`src/lib/liveDecorations.ts`](src/lib/liveDecorations.ts) 和 [`src/lib/blockDecorations.ts`](src/lib/blockDecorations.ts)。

### 多标签页架构
- **状态管理**：`useReducer` 集中管理 tabs 数组，全局 UI 态保留 useState
- **编辑器实例**：每 tab 一个 CodeMirror，`display:none` 切换不重建，撤销栈/光标/scroll 自动保留
- **持久化**：Tauri app data 的 tabs.json（原子写 + debounce 1s），启动 hydrate 恢复

## 📁 项目结构

```
好记/
├─ src/                      # 前端源码
│  ├─ components/            # React 组件（Toolbar / TabBar / SettingsDialog / LiveEditor ...）
│  ├─ lib/                   # 渲染核心、文件 IO、主题、大纲、tabs、settings
│  ├─ styles/                # 样式（base / app / markdown / live）
│  └─ samples/               # 欢迎页
├─ src-tauri/                # Tauri / Rust 后端
│  ├─ src/lib.rs             # 文件读写、编码探测、原子写、tab/设置持久化
│  ├─ tauri.conf.json        # 窗口、图标、文件关联配置
│  ├─ nsis-hooks.nsh         # .md 文件图标注册（吉祥物）
│  └─ icons/                 # 各分辨率图标
├─ public/                   # favicon
└─ icon.png / md-icon.png    # 图标源文件（羽毛 / 吉祥物）
```

## 📖 项目故事

整个造轮子的过程写成了文章：[`公众号文章.md`](公众号文章.md)

从「TypeDown 太慢」到「4.9MB 秒开」，完整记录了渲染核心、实时编辑、块级点击编辑、Tauri 桌面化的全过程。

## 🗺 路线图

- [x] 实时渲染（内联 + 块级）
- [x] 暗色模式、大纲、快捷键
- [x] Tauri 桌面化、.md 文件关联
- [x] **v2.0 渲染核心重写（CodeMirror 语法树）**
- [x] **v2.0 多标签页 + 完全持久化恢复**
- [x] **v2.0 设置面板（四类偏好）**
- [x] **v2.0 数据安全（原子写/编码识别/单实例/关闭保护）**
- [ ] 表格 WYSIWYG 编辑
- [ ] 自动更新（自建服务器分发）
- [ ] 拼写检查
- [ ] macOS / Linux 构建

## 📄 许可证

MIT License — 随便用，欢迎 PR。

---

**好记** 是「好 X」工具家族的第二个成员。第一个是 [好找](https://github.com/)（文件管理系统）。

如果这个项目对你有帮助，⭐ Star 是最大的鼓励。
