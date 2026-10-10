; Included by Tauri's NSIS installer (tauri.conf.json, bundle.windows.nsis.installerHooks).

; 0.1.0 shipped as "Unofficial NTS Player". Everything the installer keys on
; (folder, Settings > Apps entry, shortcuts) follows the product name, so the
; renamed installer would otherwise leave that copy behind as a second app.
; Its own uninstaller, run silently, removes it and keeps the user's settings
; and skins, which live under the unchanged bundle identifier.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R9 HKCU "Software\${MANUFACTURER}\Unofficial NTS Player" ""
  ${If} $R9 != ""
    ; An update creates no shortcuts and the old uninstaller deletes its own,
    ; so recreate under the new name the ones the old copy had.
    ${If} ${FileExists} "$SMPROGRAMS\Unofficial NTS Player.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} ${FileExists} "$DESKTOP\Unofficial NTS Player.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} $R9 == $INSTDIR
      ; Installed over the old copy: its files, uninstall.exe included, are
      ; already this version's, so running "its" uninstaller would remove this
      ; install. Drop only its Settings > Apps entry and shortcuts.
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Unofficial NTS Player"
      Delete "$SMPROGRAMS\Unofficial NTS Player.lnk"
      Delete "$DESKTOP\Unofficial NTS Player.lnk"
      DeleteRegKey HKCU "Software\${MANUFACTURER}\Unofficial NTS Player"
    ${ElseIf} ${FileExists} "$R9\uninstall.exe"
      ; _?= makes ExecWait wait; the uninstaller then cannot delete itself.
      ExecWait '"$R9\uninstall.exe" /S _?=$R9' $0
      ; On failure (say the old copy would not close) keep it whole, key
      ; included, so the next install or update tries again.
      ${If} $0 = 0
        Delete "$R9\uninstall.exe"
        RMDir "$R9"
        DeleteRegKey HKCU "Software\${MANUFACTURER}\Unofficial NTS Player"
      ${EndIf}
    ${Else}
      DeleteRegKey HKCU "Software\${MANUFACTURER}\Unofficial NTS Player"
    ${EndIf}
  ${EndIf}
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
