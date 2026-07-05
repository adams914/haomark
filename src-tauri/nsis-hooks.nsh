; 好记 NSIS 安装钩子
; 为关联的 .md 文件注册独立图标（吉祥物），区别于应用图标（羽毛）
; md-icon.ico 已通过 tauri.conf.json 的 resources 复制到 $INSTDIR
;
; Tauri 模板用 APP_ASSOCIATE 注册 ProgID "Markdown"，
; DefaultIcon 默认指向 exe（羽毛）。这里在 POSTINSTALL 覆盖为吉祥物 ico。

!macro NSIS_HOOK_POSTINSTALL
  ; 覆盖 .md 文件类型的图标：ProgID 是 "Markdown"
  WriteRegStr SHCTX "Markdown\DefaultIcon" "" "$INSTDIR\md-icon.ico,0"

  ; 通知系统刷新文件关联图标缓存（SHCNE_ASSOCCHANGED）
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 卸载时还原为 exe 图标（或删除，让系统回退）
  DeleteRegKey SHCTX "Markdown\DefaultIcon"
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
