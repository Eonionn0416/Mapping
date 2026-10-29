Option Explicit
Dim sh, svc, processes, proc, command, result, startPath
Set sh = CreateObject("WScript.Shell")
On Error Resume Next
Set svc = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
If Err.Number <> 0 Then
  MsgBox "Cannot restart QA collector: " & Err.Description, 16, "QA Automail"
  WScript.Quit 1
End If
Set processes = svc.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' OR Name='powershell.exe'")
If Err.Number <> 0 Then
  MsgBox "Cannot inspect QA collector: " & Err.Description, 16, "QA Automail"
  WScript.Quit 1
End If
For Each proc In processes
  If Not IsNull(proc.CommandLine) Then
    command = LCase(Replace(proc.CommandLine, "/", "\"))
    If InStr(command, "c:\system project\wafer_strip_mapping_app\automation\auto-mail-server.cjs") > 0 Or InStr(command, "c:\system project\wafer_strip_mapping_app\automation\collect-outlook.ps1") > 0 Then
      result = proc.Terminate()
      If Err.Number <> 0 Or result <> 0 Then
        MsgBox "Could not stop the previous QA collector. Restart Windows and try again.", 16, "QA Automail"
        WScript.Quit 1
      End If
    End If
  End If
Next
WScript.Sleep 1500
On Error GoTo 0
sh.Run """C:\Users\seungeon.kim\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"" ""C:\System project\wafer_strip_mapping_app\automation\auto-mail-server.cjs""", 0, False
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\System project\wafer_strip_mapping_app\automation\collect-outlook.ps1""", 0, False
