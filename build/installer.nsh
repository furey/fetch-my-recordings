!macro customInstall
  nsExec::Exec '"$SYSDIR\icacls.exe" "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX)'
  Pop $0
!macroend
