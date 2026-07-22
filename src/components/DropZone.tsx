import { useEffect, useState } from 'react'
import Icon from './Icon'
import { isAcceptedFile, readFileAsText } from '../lib/fileIO'

interface Props {
  /** 单文件回调（兼容旧接口） */
  onFile?: (name: string, content: string) => void
  /** 多文件回调（v2.0）：拖入多个 .md 时每个文件调用一次 */
  onFiles?: (files: Array<{ name: string; content: string }>) => void
  children: React.ReactNode
}

/**
 * 全屏拖拽接收层：监听 document 的 dragover/drop，
 * 命中文件时回调上层。拖拽期间显示半透明遮罩。
 *
 * v2.0：支持多文件拖入（每个 .md 都新开一个 tab）。
 */
export default function DropZone({ onFile, onFiles, children }: Props) {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        setDragging(true)
      }
    }
    const onDragLeave = (e: DragEvent) => {
      // 离开窗口才隐藏
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
      setDragging(false)
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      // 过滤出接受的文件类型
      const accepted: File[] = []
      for (let i = 0; i < files.length; i++) {
        if (isAcceptedFile(files[i].name)) accepted.push(files[i])
      }
      if (accepted.length === 0) return

      // 读所有接受的文件
      const results: Array<{ name: string; content: string }> = []
      for (const file of accepted) {
        try {
          const content = await readFileAsText(file)
          results.push({ name: file.name, content })
        } catch (err) {
          console.error(`读取 ${file.name} 失败：`, err)
        }
      }
      if (results.length === 0) return

      // 优先用多文件回调
      if (onFiles) {
        onFiles(results)
      } else if (onFile && results.length > 0) {
        // 兼容旧接口：只处理第一个
        onFile(results[0].name, results[0].content)
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [onFile, onFiles])

  return (
    <>
      {children}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">
              <Icon name="arrow-down" size={28} />
            </div>
            <div>松开以打开 Markdown 文件</div>
          </div>
        </div>
      )}
    </>
  )
}
