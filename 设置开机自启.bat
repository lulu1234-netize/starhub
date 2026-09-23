@echo off
chcp 65001 >nul
title 星汇 · 设置开机自动运行
cd /d "%~dp0"

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy /Y "静默运行.vbs" "%STARTUP%\星汇采集服务.vbs" >nul

if errorlevel 1 (
  echo.
  echo   设置失败，请以正常权限重新运行本文件。
) else (
  echo.
  echo   已设置开机自动运行。
  echo.
  echo   以后开机会自动在后台启动采集服务（无窗口），
  echo   每 10 分钟自动抓取一次侯明昊的微博新动态。
  echo.
  echo   启动目录：%STARTUP%\星汇采集服务.vbs
  echo   如需取消，删除该文件即可。
  echo.
  echo   现在是否立即启动一次？
)
echo.
choice /C YN /M "立即启动采集服务"
if errorlevel 2 goto :end
wscript "%STARTUP%\星汇采集服务.vbs"
echo 已在后台启动，打开 http://localhost:8787 查看
:end
echo.
pause
