@echo off
chcp 65001 >nul
title 星汇 · 明星动态聚合（自动采集服务）
cd /d "%~dp0"

set NODE=C:\Users\lulu0\.workbuddy\binaries\node\versions\22.22.2-3\node.exe
if not exist "%NODE%" set NODE=node

echo.
echo   ============================================
echo     星汇 · 明星动态聚合
echo   ============================================
echo.
echo   服务地址： http://localhost:8787
echo   采集频率： 每 10 分钟自动抓取一次微博新动态
echo.
echo   手机使用： 与电脑连同一个 WiFi，
echo              浏览器打开上面打印的局域网地址，
echo              然后"添加到主屏幕"即可当 App 用
echo.
echo   ★ 这个窗口请保持开着（关掉就停止自动采集）
echo   ★ 首次打开或登录态过期时会弹出浏览器窗口
echo.
echo   ============================================
echo.

start "" http://localhost:8787
"%NODE%" server.js

echo.
echo 服务已停止。
pause
