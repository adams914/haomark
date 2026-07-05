import { useEffect, useState } from 'react'
import { pickDroppedFile, readFileAsText } from '../lib/fileIO'

interface Props {
  onFile: (name: string, content: string) => void
  children: React.ReactNode
}

/**
 * 全屏拖拽接收层：监听 document 的 dragover/drop，
 * 命中文件时回调上层。拖拽期间显示半透明遮罩。
 */
export default function DropZone({ onFile, children }: Props) {
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
      const file = pickDroppedFile(e)
      if (!file) return
      try {
        const content = await readFileAsText(file)
        onFile(file.name, content)
      } catch (err) {
        console.error(err)
        alert(`读取失败：${file.name}`)
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
  }, [onFile])

  return (
    <>
      {children}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">⬇</div>
            <div>松开以打开 Markdown 文件</div>
          </div>
        </div>
      )}
    </>
  )
}
