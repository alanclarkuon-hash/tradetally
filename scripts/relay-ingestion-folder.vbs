Option Explicit
' WScript is a windowless host; the Node relay also starts with no console.
Dim args, files, shell, config, node, relay, command, result
Set args = WScript.Arguments
If args.Count <> 2 Then WScript.Quit 2
Set files = CreateObject("Scripting.FileSystemObject")
config = files.GetAbsolutePathName(args(0))
node = files.GetAbsolutePathName(args(1))
relay = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "relay-ingestion-folder.cjs")
If Not files.FileExists(config) Or Not files.FileExists(node) Or Not files.FileExists(relay) Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
command = Quoted(node) & " " & Quoted(relay) & " " & Quoted(config)
result = shell.Run(command, 0, True)
WScript.Quit result
Function Quoted(value)
 If InStr(value, Chr(34)) > 0 Or InStr(value, vbCr) > 0 Or InStr(value, vbLf) > 0 Then WScript.Quit 2
 Quoted = Chr(34) & value & Chr(34)
End Function
