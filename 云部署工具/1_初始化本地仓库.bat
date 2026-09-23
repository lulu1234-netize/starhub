@echo off
title 星汇 · 第 1 步：初始化本地仓库
cd /d "%~dp0.."

set "GIT=C:\Users\lulu0\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

"%GIT%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   没有找到 Git，无法继续。
  echo   请先到 https://git-scm.com 下载安装 Git，再重新运行本脚本。
  echo.
  pause
  exit /b
)

echo.
echo   ============================================
echo     第 1 步 · 初始化本地仓库
echo   ============================================
echo.

if exist ".git" (
  echo   已经初始化过了，跳过。
) else (
  "%GIT%" init
)

for /f "delims=" %%i in ('"%GIT%" config user.email 2^>nul') do set "GHMAIL=%%i"
if not defined GHMAIL (
  set /p GHMAIL=请输入你的 GitHub 邮箱: 
  "%GIT%" config user.email "%GHMAIL%"
  "%GIT%" config user.name "starhub"
)

"%GIT%" add -A
"%GIT%" status --short

echo.
echo   即将提交以上文件。请确认列表里【没有】
echo   data\cookies.json 和 browser-profile
echo   （如果出现了，请立刻关闭窗口并告诉我）
echo.
pause

"%GIT%" commit -m "初始化星汇" 2>nul
if errorlevel 1 (
  echo.
  echo   没有需要提交的新内容（可能已经提交过了）。
)

echo.
echo   ============================================
echo     本地仓库准备好了！
echo   ============================================
echo.
echo   下一步：去 GitHub 网页上新建一个空仓库，
echo   然后运行 3_推送到GitHub.bat
echo.
pause
