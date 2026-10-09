; Included by Tauri's NSIS installer (tauri.conf.json, bundle.windows.nsis.installerHooks).

; "Start with Windows" (tauri-plugin-autostart) writes the Run value, and Task
; Manager's Startup apps may add the StartupApproved one. Remove both on a real
; uninstall; an update runs the uninstaller with /UPDATE and keeps them.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
