' 星汇 · 后台静默运行（无窗口）
' 由「设置开机自启.bat」复制到 Windows 启动目录后，开机即自动运行采集服务
Dim shell, node, workDir
Set shell = CreateObject("WScript.Shell")
node = "C:\Users\lulu0\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
workDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
If Not CreateObject("Scripting.FileSystemObject").FileExists(node) Then node = "node"
shell.CurrentDirectory = workDir
shell.Run """" & node & """ """ & workDir & "\server.js""", 0, False
