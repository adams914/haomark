# 你好，好记 v2.0 👋

一个轻量、快速、**实时渲染**的 Markdown 编辑器。**直接在这里开始写**，或在顶栏点「打开」加载文件。

> 💡 这页本身就是渲染演示——光标移开每一行，看它如何从源码变渲染。

## 实时渲染（Obsidian 风）

写 Markdown 时，光标所在行显示源码，其余行自动渲染。v2.0 基于**语法树**解析，更准更稳：

- **加粗**、*斜体*、***粗斜体***、~~删除线~~、`行内代码`
- [链接](https://example.com) 自动识别，![小图](data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16"><rect width="40" height="16" rx="3" fill="%230590ff"/><text x="20" y="12" text-anchor="middle" fill="white" font-size="10">img</text></svg>) 也能内联
- > 引用块带左侧竖线
- 标题里的 **加粗** 和 *斜体* 也能渲染（v1 做不到）

### 任务列表

- [x] 已完成的事项
- [ ] 待办事项
  - 嵌套子项也支持
- 普通列表项

### 引用式图片与链接

![好记图标][logo]

更多详见 [官网][site]。

[logo]: data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="36" fill="%23f59e0b"/><text x="40" y="52" text-anchor="middle" fill="white" font-size="36" font-weight="bold">好</text></svg>
[site]: https://example.com

## 三个视图

顶栏切换 **实时 / 源码 / 预览**：

- **实时**：边写边渲染（默认，对标 Obsidian）
- **源码**：纯 Markdown 文本
- **预览**：完整渲染（代码高亮、公式、Mermaid 图）

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 加粗 | Ctrl + B |
| 斜体 | Ctrl + I |
| 行内代码 | Ctrl + E |
| 保存 | Ctrl + S |

## 代码块与图表

支持围栏代码块（带语法高亮）、表格、数学公式、Mermaid 流程图。切到「预览」视图可看完整渲染。

```ts
// 代码块内的 $ 和 * 不会被误解析（v1 的 bug 已修）
function greet(name: string): string {
  return `Hello, ${name}!`  // 模板字符串里的 $ 安全
}
```

行内代码 `$x$` 和 `*foo*` 保持原样，不被当成公式或斜体。

数学公式：行内 $E = mc^2$，块级：

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

> 💡 在实时视图里，**点击**渲染后的代码块 / 表格 / 公式，即可进入编辑。

## 还能做

- 🌙 顶栏切换暗色模式（亮 / 暗 / 跟随系统）
- 📑 左侧大纲自动生成，点击跳转，**代码块里的 `# 注释` 不会误判为标题**
- 🔤 顶栏 A+/A− 调字号
- 📥 拖拽 .md 文件到窗口直接打开
- 💾 保存时**原子写入**（断电也不会损坏文件）
- 🔤 打开 GBK / UTF-16 编码的 .md 自动识别不乱码

---

**开始写点什么吧。** 这页内容选中删除即可。
