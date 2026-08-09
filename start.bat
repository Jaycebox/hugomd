@echo off
rem ============================================================
rem  hugomd dev launcher (ASCII wrapper -> start.ps1)
rem  Usage:
rem    start.bat                         -> normal debug (with logs)
rem    start.bat --remote-debugging-port=9222
rem                                      -> renderer debug (chrome://inspect)
rem    start.bat --inspect=9229          -> main process debug (VS Code)
rem  Extra args are passed through to electron.
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
