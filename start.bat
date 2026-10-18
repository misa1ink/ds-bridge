@echo off
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion
title DS Bridge

rem ===================================================================
rem  DS Bridge 启动器
rem
rem  双击即可。它会：
rem    1. 检查 Node 版本（需要 22+，项目用到全局 WebSocket）
rem    2. 首次运行生成 config.json 和 API key
rem    3. 检查关键文件是否齐全
rem    4. 启动服务并自动打开控制台
rem
rem  可选参数：
rem    start.bat --install     只做初始化，不启动
rem    start.bat --no-browser  启动但不自动开浏览器
rem    start.bat --status      只探测当前是否在运行
rem
rem  注意：本文件里的路径都用相对路径或 %~dp0。
rem  实测在 for /f 里传含中文的绝对路径会静默失效，所以要先 cd 到本目录。
rem ===================================================================

rem ---------- 0. 切到脚本所在目录 ----------
pushd "%~dp0"
set "APP_DIR=%CD%"
set "PORT=8788"
set "BASE_URL=http://127.0.0.1:%PORT%"
set "NEED_NODE_MAJOR=22"

rem ---------- 参数 ----------
set "ONLY_INSTALL="
set "NO_BROWSER="
set "ONLY_STATUS="
for %%A in (%*) do (
    if /i "%%~A"=="--install"    set "ONLY_INSTALL=1"
    if /i "%%~A"=="--no-browser" set "NO_BROWSER=1"
    if /i "%%~A"=="--status"     set "ONLY_STATUS=1"
)

echo.
echo  ============================================
echo    DS Bridge - DeepSeek 网页端 转 OpenAI 接口
echo  ============================================
echo   目录: %APP_DIR%
echo.

rem ---------- 1. 找 node ----------
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%N"
)

if not defined NODE_EXE (
    echo  [错误] 没找到 node。
    echo.
    echo  请先安装 Node.js 22 或更高版本: https://nodejs.org/
    echo  安装后重新双击本文件。
    goto :fail
)

rem ---------- 2. 版本检查 ----------
set "NODE_VER="
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
if not defined NODE_VER (
    echo  [错误] node 存在但无法执行: %NODE_EXE%
    goto :fail
)

set "VER_NO_V=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%M in ("%VER_NO_V%") do set "NODE_MAJOR=%%M"

if %NODE_MAJOR% LSS %NEED_NODE_MAJOR% (
    echo  [错误] Node 版本太低: %NODE_VER%
    echo         本项目需要 %NEED_NODE_MAJOR% 或更高（用到全局 WebSocket）。
    echo         升级: https://nodejs.org/
    echo.
    goto :fail
)
echo  [1/4] Node %NODE_VER%  OK

rem ---------- 3. 初始化配置 ----------
if not exist "config.json" (
    echo  [2/4] 首次运行，生成配置和 API key ...
    node scripts\init-config.mjs
    if errorlevel 1 (
        echo.
        echo  [错误] 初始化失败，见上面的报错。
        goto :fail
    )
) else (
    echo  [2/4] 配置已存在  OK
)

rem ---------- 4. 文件自检 ----------
set "MISSING="
if not exist "server.mjs"              set "MISSING=!MISSING! server.mjs"
if not exist "lib\deepseek.mjs"        set "MISSING=!MISSING! lib\deepseek.mjs"
if not exist "lib\sites.mjs"           set "MISSING=!MISSING! lib\sites.mjs"
if not exist "wasm\sha3_wasm_bg.wasm"  set "MISSING=!MISSING! wasm\sha3_wasm_bg.wasm"
if not exist "public\index.html"       set "MISSING=!MISSING! public\index.html"

if defined MISSING (
    echo  [错误] 缺少必要文件:!MISSING!
    echo         请确认 ds-bridge 目录是完整的。
    goto :fail
)
echo  [3/4] 文件完整  OK

rem ---------- 只初始化 ----------
if defined ONLY_INSTALL (
    echo.
    echo  初始化完成。之后双击本文件即可启动。
    echo.
    goto :done
)

rem ---------- 已经在跑？ ----------
call :probe
if "!PORT_BUSY!"=="1" (
    echo  [4/4] 服务已经在运行  OK
    echo.
    echo  已有实例在跑，不用重复启动。
    if defined PROBE_INFO echo  状态: !PROBE_INFO!
    echo.
    if not defined NO_BROWSER start "" "%BASE_URL%/"
    goto :done
)

if defined ONLY_STATUS (
    echo  [4/4] 服务未运行。
    goto :done
)

if defined PORT_BUSY_NOTE (
    echo  [提示] 端口 %PORT% 被占用，但不是 ds-bridge 在应答。
    echo         服务启动可能会失败，先关掉占用它的程序。
    echo.
)

rem ---------- 启动 ----------
echo  [4/4] 启动服务 ...
echo.
echo  ============================================
echo   控制台      %BASE_URL%/
echo   酒馆 Base   %BASE_URL%/v1
echo.
echo   关闭这个窗口 = 停止服务。
echo   浏览器窗口别关，登录状态靠它保留。
echo  ============================================
echo.

rem 等服务真正起来再开浏览器，否则会打开一个连不上的页面
if not defined NO_BROWSER (
    start "" /b cmd /c "timeout /t 5 /nobreak >nul & start "" "%BASE_URL%/""
)

node server.mjs
set "EXIT_CODE=%errorlevel%"

echo.
if "%EXIT_CODE%"=="2" (
    echo  端口 %PORT% 被占用，服务没起来。
    echo  可能已经有一个实例在跑，打开 %BASE_URL%/ 看看。
) else if not "%EXIT_CODE%"=="0" (
    echo  服务退出，代码 %EXIT_CODE%。常见原因：
    echo    - 端口被占：关掉别的实例，或改 config.json 的 server.port
    echo    - 找不到浏览器：设 DS_BROWSER 指向 chrome.exe / msedge.exe
    echo    - 配置坏了：删掉 config.json 让它重新生成
)
echo.
goto :done

rem ===================================================================
:probe
rem 探测服务是否在跑，并记录状态摘要到 PROBE_INFO。
rem 用相对路径调用（工作目录已在步骤 0 切好）。
set "PORT_BUSY="
set "PROBE_INFO="
for /f "usebackq delims=" %%H in (`node scripts\probe-status.mjs %PORT% 2^>nul`) do (
    if /i "%%H"=="UP" (
        set "PORT_BUSY=1"
    ) else if /i not "%%H"=="DOWN" (
        set "PROBE_INFO=%%H"
    )
)
exit /b 0

:fail
echo.
echo  启动中止。
echo.
pause
popd
exit /b 1

:done
echo.
pause
popd
exit /b %EXIT_CODE%
