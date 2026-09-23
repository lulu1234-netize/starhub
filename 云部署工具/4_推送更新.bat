@echo off
title 星汇 · 推送更新到 GitHub
cd /d "%~dp0.."

set "GIT=C:\Users\lulu0\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

echo.
echo   ============================================
echo     推送本地更新到 GitHub
echo   ============================================
echo.
echo   （第一次推送时如果弹出凭据选择窗口，
echo    选 none 再点 Select 即可）
echo.

"%GIT%" add -A
"%GIT%" -c user.name="starhub" -c user.email="starhub@users.noreply.github.com" commit -m "更新星汇" 2>nul
if errorlevel 1 echo   （本地没有新改动，直接同步云端数据）

"%GIT%" pull --rebase origin main
if errorlevel 1 (
  echo.
  echo   合并云端数据时出错，把窗口截图发给我就行。
  echo.
  pause
  exit /b
)

"%GIT%" push origin main

echo.
if errorlevel 1 (
  echo   推送失败了，把窗口截图发给我就行。
) else (
  echo   ============================================
  echo     推送成功！
  echo     网页约 1-2 分钟后自动更新：
  echo     https://lulu1234-netize.github.io/starhub/
  echo   ============================================
)
echo.
pause
