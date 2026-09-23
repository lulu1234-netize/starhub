@echo off
title 星汇 · 急救修复并推送
cd /d "%~dp0.."

set "GIT=C:\Users\lulu0\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

echo.
echo   ============================================
echo     急救修复仓库状态并推送
echo   ============================================
echo.

echo   [1/7] 让 Git 走你的 VPN 代理（端口 7890）...
"%GIT%" config http.proxy http://127.0.0.1:7890
"%GIT%" config https.proxy http://127.0.0.1:7890

echo   [2/7] 清理卡住的合并状态...
"%GIT%" rebase --abort 2>nul
"%GIT%" merge --abort 2>nul

echo   [3/7] 把本地改动归拢到 main 分支...
"%GIT%" checkout -f -B main 2>nul

echo   [4/7] 连接 GitHub（连不上会自动重试 3 次）...
"%GIT%" fetch origin main
if errorlevel 1 (
  echo   ... 连不上，15 秒后重试第 1 次
  timeout /t 15 /nobreak >nul
  "%GIT%" fetch origin main
)
if errorlevel 1 (
  echo   ... 还是连不上，15 秒后重试第 2 次
  timeout /t 15 /nobreak >nul
  "%GIT%" fetch origin main
)
if errorlevel 1 (
  echo   ... 最后再试 1 次
  timeout /t 15 /nobreak >nul
  "%GIT%" fetch origin main
)
if errorlevel 1 goto netfail

echo   [5/7] 合并云端数据（冲突时自动以云端为准）...
"%GIT%" rebase -X theirs origin/main
if errorlevel 1 goto fail

echo   [6/7] 推送...
"%GIT%" push origin main
if errorlevel 1 (
  echo   ... 推送没成功，15 秒后自动再试一次
  timeout /t 15 /nobreak >nul
  "%GIT%" push origin main
)
if errorlevel 1 goto fail

echo   [7/7] 完成！
echo.
echo   ============================================
echo     推送成功！
echo     网页约 1-2 分钟后自动更新：
echo     https://lulu1234-netize.github.io/starhub/
echo     然后就可以用手机 Chrome 重新尝试安装了。
echo   ============================================
echo.
pause
exit /b

:netfail
echo.
echo   ============================================
echo     还是连不上 GitHub。请检查：
echo       1. ikuuu 是否处于「已连接」状态
echo       2. 试试换个节点（日本/美国/新加坡）
echo       3. 在浏览器里打开 github.com 看能不能进
echo     确认后重新运行本脚本即可。
echo   ============================================
echo.
pause
exit /b

:fail
echo.
echo   ============================================
echo     出错了，对着这个窗口截图发给我。
echo   ============================================
echo.
pause
