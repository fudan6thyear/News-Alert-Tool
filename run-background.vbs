Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

projectRoot = FSO.GetParentFolderName(WScript.ScriptFullName)
vbsLogPath = FSO.BuildPath(FSO.BuildPath(projectRoot, "logs"), "autostart-vbs.log")

Sub AppendLog(message)
  Dim logDir, stream
  logDir = FSO.GetParentFolderName(vbsLogPath)
  If Len(logDir) > 0 And Not FSO.FolderExists(logDir) Then
    FSO.CreateFolder(logDir)
  End If
  Set stream = FSO.OpenTextFile(vbsLogPath, 8, True, -1)
  stream.WriteLine Now() & " [RunBackgroundVBS] " & message
  stream.Close
End Sub

Function ResolveNodePath()
  Dim candidates, candidate, execObj, output, lines, i

  On Error Resume Next
  Set execObj = WshShell.Exec("%ComSpec% /d /c where node")
  output = ""
  If Err.Number = 0 Then
    output = Trim(execObj.StdOut.ReadAll())
  End If
  Err.Clear
  On Error GoTo 0

  If Len(output) > 0 Then
    lines = Split(output, vbCrLf)
    For i = 0 To UBound(lines)
      candidate = Trim(lines(i))
      If Len(candidate) > 0 And FSO.FileExists(candidate) Then
        ResolveNodePath = candidate
        Exit Function
      End If
    Next
  End If

  candidates = Array( _
    WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe" _
  )

  For Each candidate In candidates
    If Len(candidate) > 0 And FSO.FileExists(candidate) Then
      ResolveNodePath = candidate
      Exit Function
    End If
  Next

  ResolveNodePath = ""
End Function

launcherPath = FSO.BuildPath(projectRoot, "app\scripts\autostart-launcher.js")
WshShell.CurrentDirectory = projectRoot
AppendLog "launcher requested"

nodePath = ResolveNodePath()
If Len(nodePath) = 0 Then
  AppendLog "Node.js not found in PATH or standard install locations."
  WScript.Quit 1
End If

If Not FSO.FileExists(launcherPath) Then
  AppendLog "autostart-launcher.js not found."
  WScript.Quit 1
End If

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34) & " --source=vbs-startup"
WshShell.Run command, 0, False
