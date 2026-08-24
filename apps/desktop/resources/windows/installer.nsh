!if "${APP_ID}" == "app.shift.nightly"
  !define SHIFT_DOCUMENT_PROGID "app.shift.nightly.document"
  !define SHIFT_NIGHTLY_DOCUMENT
!else
  !define SHIFT_DOCUMENT_PROGID "app.shift.document"
!endif

!macro customInstall
  SetOutPath "$INSTDIR\resources"
  File /oname=shift-document.ico "${BUILD_RESOURCES_DIR}\shift-document.ico"

  WriteRegNone SHELL_CONTEXT "Software\Classes\.shift\OpenWithProgids" "${SHIFT_DOCUMENT_PROGID}"
  !ifndef SHIFT_NIGHTLY_DOCUMENT
    WriteRegStr SHELL_CONTEXT "Software\Classes\.shift" "" "${SHIFT_DOCUMENT_PROGID}"
  !endif

  WriteRegStr SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}" "" "Shift Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}\DefaultIcon" "" '"$INSTDIR\resources\shift-document.ico"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}\shell\open" "" "Open with ${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}\shell\open\command" "" '"$appExe" "%1"'

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.shift\OpenWithProgids" "${SHIFT_DOCUMENT_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${SHIFT_DOCUMENT_PROGID}"

  !ifndef SHIFT_NIGHTLY_DOCUMENT
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.shift" ""
    StrCmp $0 "${SHIFT_DOCUMENT_PROGID}" 0 +2
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.shift" ""
  !endif

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
