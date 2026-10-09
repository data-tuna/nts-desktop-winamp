; Included by Tauri's NSIS installer (tauri.conf.json, bundle.windows.nsis.installerHooks).

; 0.1.0 shipped as "Unofficial NTS Player". Everything the installer keys on
; (folder, Settings > Apps entry, shortcuts) follows the product name, so the
; renamed installer would otherwise leave that copy behind as a second app.
; Its own uninstaller, run silently, removes it and keeps the user's settings
; and skins, which live under the unchanged bundle identifier.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R9 HKCU "Software\${MANUFACTURER}\Unofficial NTS Player" ""
  ${If} $R9 != ""
  ${AndIf} ${FileExists} "$R9\uninstall.exe"
    ; _?= makes ExecWait wait; the uninstaller then cannot delete itself.
    ExecWait '"$R9\uninstall.exe" /S _?=$R9'
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
  ${EndIf}
  DeleteRegKey HKCU "Software\${MANUFACTURER}\Unofficial NTS Player"
!macroend

; "Start with Windows" (tauri-plugin-autostart) writes the Run value, and Task
; Manager's Startup apps may add the StartupApproved one. Remove both on a real
; uninstall; an update runs the uninstaller with /UPDATE and keeps them.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
