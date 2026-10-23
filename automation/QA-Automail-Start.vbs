Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\seungeon.kim\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"" ""C:\System project\wafer_strip_mapping_app\automation\auto-mail-server.cjs""", 0, False
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\System project\wafer_strip_mapping_app\automation\collect-outlook.ps1""", 0, False
