@echo off
title 星汇 · 第 3 步：推送到 GitHub
cd /d "%~dp0.."

set "GIT=C:\Users\lulu0\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
if not exist "%GIT%" set "GIT=git"

"%GIT%" --version >nul 2>&1
if errorlevel 1 (
  echo 没有找到 Git，请先安装 Git 或运行 1_初始化本地仓库.bat
  pause
  exit /b
)

echo.
echo   ============================================
echo     第 3 步 · 推送到 GitHub
echo   ============================================
echo.
echo   需要三样东西（都在 GitHub 网页上拿到）：
echo     1. 仓库地址：形如
echo        https://github.com/lulu1234-netize/starhub.git
echo     2. 你的 GitHub 用户名：lulu1234-netize
echo     3. Personal Access Token（个人访问令牌）
echo.
echo   Token 获取（中文界面对照）：
echo     GitHub 右上角头像 → 设置(Settings)
echo     → 开发者设置(Developer settings)
echo     → 个人访问令牌(Personal access tokens)
echo     → 令牌(经典) Tokens (classic)
echo     → 生成新令牌(经典) Generate new token (classic)
echo     勾选 repo（全部）和 workflow（这两个词界面上就是英文）
echo     有效期选 90 days（90天）或 No expiration（无期限）
echo     生成后立刻复制（只显示这一次）
echo.
echo   ============================================
echo.

set /p REPO=粘贴仓库地址: 
set /p GHUSER=输入 GitHub 用户名: 
set /p GHTOKEN=粘贴 Token: 

set "TAIL=%REPO:https://github.com/=%"
set "TAIL=%TAIL:http://github.com/=%"
set "URL=https://%GHUSER%:%GHTOKEN%@github.com/%TAIL%"

"%GIT%" branch -M main
"%GIT%" remote remove origin >nul 2>&1
"%GIT%" remote add origin "%URL%"

echo.
echo   正在推送，请稍候（可能需要十几秒）...
"%GIT%" push -u origin main

echo.
if errorlevel 1 (
  echo   ============================================
  echo     推送失败了。常见原因：
  echo       1. Token 没勾选 repo 或 workflow 权限
  echo       2. Token 复制不完整 / 已过期
  echo       3. 仓库地址粘贴错了
  echo     修正后重新运行本脚本即可。
  echo   ============================================
) else (
  echo   ============================================
  echo     推送成功！
  echo     接下来去 GitHub 网页完成最后三步：
  echo       A. 设置(Settings) → 机密和变量(Secrets and variables)
  echo          → 操作(Actions) → 新建仓库机密(New repository secret)
  echo          名称填 WEIBO_COOKIE
  echo          （运行 2_导出Cookie到剪贴板.bat 会自动复制到剪贴板）
  echo       B. 设置(Settings) → 操作(Actions) → 常规(General)
  echo          → 工作流权限 改 读取和写入(Read and write)
  echo       C. 设置(Settings) → 页面(Pages) → 从分支部署
  echo          (Deploy from a branch) → main → / (root) → 保存(Save)
  echo   ============================================
)
echo.
pause
