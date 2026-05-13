Option Explicit

Dim shell, fso, projectDir, pythonwPath, packagePath, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonwPath = fso.BuildPath(projectDir, ".venv\Scripts\pythonw.exe")
packagePath = fso.BuildPath(projectDir, "spectrum_signal_app")

If Not fso.FileExists(pythonwPath) Then
    MsgBox "Virtual environment Python not found:" & vbCrLf & pythonwPath & vbCrLf & _
           "Please create or repair .venv first.", vbCritical, "Launch failed"
    WScript.Quit 1
End If

If Not fso.FolderExists(packagePath) Then
    MsgBox "Application package not found:" & vbCrLf & packagePath, vbCritical, "Launch failed"
    WScript.Quit 1
End If

shell.CurrentDirectory = projectDir
command = """" & pythonwPath & """ -m spectrum_signal_app"
shell.Run command, 0, False
