@echo off
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion
title DS Bridge - push to GitHub

rem ===================================================================
rem  把本仓库推到 GitHub。
rem
rem  用法：
rem      push-github.bat                    交互式，会问你仓库地址
rem      push-github.bat 用户名 仓库名       直接推送
rem
rem  前提：你在 GitHub 上已经建好一个空仓库（不要勾 README /
rem        .gitignore / license，否则首次推送会冲突）。
rem
rem  凭据：第一次推送会弹浏览器让你登录 GitHub，之后会记住。
rem ===================================================================

pushd "%~dp0"

echo.
echo  ============================================
echo    推送到 GitHub
echo  ============================================
echo.

rem ---------- 检查是不是 git 仓库 ----------
if not exist ".git" (
    echo  [错误] 这里不是 git 仓库。
    goto :fail
)

rem ---------- 取仓库地址 ----------
set "OWNER=%~1"
set "REPO=%~2"

if not defined OWNER (
    set /p "OWNER=GitHub 用户名: "
)
if not defined REPO (
    set /p "REPO=仓库名（例如 ds-bridge）: "
)

if not defined OWNER (
    echo  [错误] 用户名不能为空。
    goto :fail
)
if not defined REPO (
    echo  [错误] 仓库名不能为空。
    goto :fail
)

set "REMOTE_URL=https://github.com/!OWNER!/!REPO!.git"
echo.
echo  将要推送到: !REMOTE_URL!
echo.

rem ---------- 提交身份 ----------
set "GIT_NAME="
for /f "delims=" %%N in ('git config user.name 2^>nul') do set "GIT_NAME=%%N"
if not defined GIT_NAME (
    echo  [提示] 还没设置 git 提交身份，用 !OWNER! 作为默认值。
    git config user.name "!OWNER!"
    git config user.email "!OWNER!@users.noreply.github.com"
)

rem ---------- 一次提交都没？先提交 ----------
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
    echo  [提示] 还没有任何提交，先创建初始提交。
    git add -A
    git -c user.name="!OWNER!" -c user.email="!OWNER!@users.noreply.github.com" commit -m "Initial commit"
)

rem ---------- 设置 remote ----------
git remote remove origin >nul 2>&1
git remote add origin "!REMOTE_URL!"

echo.
echo  推送中...（首次会弹出 GitHub 登录窗口）
echo.
git push -u origin main

if errorlevel 1 (
    echo.
    echo  ============================================
    echo   推送失败。常见原因：
    echo.
    echo   1. 仓库不存在或名字写错
    echo      先在 GitHub 上建好空仓库，注意大小写。
    echo.
    echo   2. 远程仓库不是空的
    echo      建仓库时勾了 README / gitignore / license。
    echo      解法 A：删掉那个仓库重建，什么都别勾。
    echo      解法 B：允许合并不相关的历史：
    echo          git pull origin main --allow-unrelated-histories
    echo          git push -u origin main
    echo.
    echo   3. 认证失败
    echo      需要 Personal Access Token 而不是密码。
    echo      生成: https://github.com/settings/tokens  ^(勾 repo^)
    echo      用户名填 GitHub 用户名，密码填那个 token。
    echo.
    echo   4. 网络连不上 github.com
    echo      GitHub API 在本机被拦过 ^(返回 403^)。
    echo      挂代理后再试：
    echo          git config --global http.proxy http://127.0.0.1:端口
    echo.
    goto :fail
)

echo.
echo  ============================================
echo   推送成功
echo   仓库地址: https://github.com/!OWNER!/!REPO!
echo  ============================================
echo.
goto :done

:fail
echo.
echo  已中止。
echo.
pause
popd
exit /b 1

:done
pause
popd
exit /b 0
