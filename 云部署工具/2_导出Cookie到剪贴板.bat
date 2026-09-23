@echo off
title 星汇 · 导出微博 Cookie
cd /d "%~dp0.."

set "NODE=C:\Users\lulu0\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE%" set "NODE=node"

echo.
echo   ============================================
echo     导出微博登录 Cookie
echo   ============================================
echo.
echo   即将在后台打开一次浏览器读取登录状态，
echo   大约 10 秒，请不要关闭这个窗口。
echo   （如果微博要求重新扫码，请完成登录）
echo.
pause

"%NODE%" collector\export_cookies.js

echo.
"%NODE%" collector\copy_cookie.js

echo.
echo   如果上面提示"已复制到剪贴板"，就可以去 GitHub 粘贴了：
echo     仓库 → 设置(Settings) → 机密和变量(Secrets and variables)
echo     → 操作(Actions) → 新建仓库机密(New repository secret)
echo     名称(Name):  WEIBO_COOKIE
echo     机密(Secret): 直接 Ctrl+V 粘贴
echo.
echo   注意：Cookie 一般能用数周。失效后（页面没新内容）
echo   重新运行本脚本，再回 GitHub 把那个机密覆盖更新即可。
echo.
pause
