# hhAPP 调试启动脚本 (UTF-8)
# 用法:
#   start.bat                        -> 普通调试（带日志）
#   start.bat --remote-debugging-port=9222
#                                    -> 渲染层调试（Chrome 打开 chrome://inspect）
#   start.bat --inspect=9229         -> 主进程调试（VS Code attach）
# 额外参数原样透传给 electron

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "=============================================="
Write-Host "  hhAPP 调试模式（Electron + Hugo 笔记 App）"
Write-Host "=============================================="
Write-Host ""

# ---- 依赖自检: node_modules ----
if (-not (Test-Path 'node_modules\.bin\electron.cmd')) {
    Write-Host '[1/2] 缺少 node_modules，正在执行 npm install ...'
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[错误] npm install 失败，请检查网络。'
        Read-Host '按回车退出'
        exit 1
    }
}

# ---- 依赖自检: monaco vendor ----
if (-not (Test-Path 'src\renderer\vendor\monaco\vs\loader.js')) {
    Write-Host '[2/2] 缺少 monaco 编辑器资源，正在执行 copy-monaco ...'
    node scripts\copy-monaco.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[错误] copy-monaco 失败。'
        Read-Host '按回车退出'
        exit 1
    }
}

Write-Host "[启动] electron . --enable-logging $args"
Write-Host '[提示] 日志实时输出在本窗口，关闭窗口即退出应用'
Write-Host ''

# ---- 启动（--enable-logging 让渲染层 console 也输出到本窗口）----
& 'node_modules\.bin\electron.cmd' . --enable-logging @args
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host ''
    Write-Host "[错误] 启动失败（exit code = $code），请查看上方日志。常见原因:"
    Write-Host '  - npm install 失败（可设置镜像: npm config set registry https://registry.npmmirror.com）'
    Write-Host '  - hugo 二进制缺失（应用内设置页可下载）'
    Read-Host '按回车退出'
    exit $code
}

Write-Host ''
Write-Host '应用已退出。'
Read-Host '按回车关闭窗口'
