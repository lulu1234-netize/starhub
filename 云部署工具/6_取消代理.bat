@echo off
title 取消 Git 代理
cd /d "%~dp0.."

set "GIT=C:\Users\lulu0\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

"%GIT%" config --unset http.proxy 2>nul
"%GIT%" config --unset https.proxy 2>nul

echo.
echo   已取消 Git 的代理设置。
echo   （以后不开 VPN 又想推送时，先跑这个）
echo.
pause
