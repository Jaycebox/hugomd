# hugomd 调试启动脚本（极简）
# 用法: start.bat [electron 参数...]  （参数原样透传）
# 示例: start.bat --remote-debugging-port=9222

Set-Location $PSScriptRoot
Write-Host '[hugomd] 启动中...（关闭窗口即退出）'
& 'node_modules\.bin\electron.cmd' . --enable-logging @args
Write-Host '[hugomd] 应用已退出。'
Read-Host '按回车关闭窗口'
