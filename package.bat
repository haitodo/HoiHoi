@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ======================================================================
echo    HoiHoi - 拡張機能パッケージ化 (CRX / ZIP 生成)
echo ======================================================================
echo.

set "PNPM_BIN="
call :find_pnpm
if not defined PNPM_BIN (
    echo.
    echo [エラー] 動作する pnpm が見つかりませんでした。
    echo Node.js の新バージョンでは Corepack が同梱されないため、
    echo 古い Corepack shim ^(pnpm.CMD^) が残っている場合は失敗します。
    echo スタンドアロン版 pnpm をインストールするか、PATH を確認してください。
    pause
    exit /b 1
)

call "%PNPM_BIN%" package
if %ERRORLEVEL% neq 0 (
    echo.
    echo [エラー] パッケージ化中にエラーが発生しました。
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 出力先フォルダー (release) をエクスプローラーで開きます...
start explorer "%~dp0release"
echo.
pause
exit /b 0

:find_pnpm
call :try_pnpm pnpm
if defined PNPM_BIN exit /b 0

for /f "delims=" %%I in ('where pnpm 2^>nul') do (
    if not "%%~xI"=="" (
        call :try_pnpm "%%~I"
        if defined PNPM_BIN exit /b 0
    )
)

if defined PNPM_HOME (
    call :try_pnpm "%PNPM_HOME%\pnpm.exe"
    if defined PNPM_BIN exit /b 0
    call :try_pnpm "%PNPM_HOME%\bin\pnpm.exe"
    if defined PNPM_BIN exit /b 0
)

if defined LOCALAPPDATA (
    call :try_pnpm "%LOCALAPPDATA%\pnpm\bin\pnpm.exe"
    if defined PNPM_BIN exit /b 0
    call :try_pnpm "%LOCALAPPDATA%\pnpm\pnpm.exe"
    if defined PNPM_BIN exit /b 0
)

if defined APPDATA (
    call :try_pnpm "%APPDATA%\npm\pnpm.cmd"
    if defined PNPM_BIN exit /b 0
)
exit /b 1

:try_pnpm
set "CANDIDATE=%~1"
if "%CANDIDATE%"=="" exit /b 1
if /i "%CANDIDATE%"=="pnpm" (
    call pnpm --version > nul 2>&1
    if errorlevel 1 exit /b 1
    set "PNPM_BIN=pnpm"
    exit /b 0
)
if not exist "%CANDIDATE%" exit /b 1
call "%CANDIDATE%" --version > nul 2>&1
if errorlevel 1 exit /b 1
set "PNPM_BIN=%CANDIDATE%"
set "PATH=%~dp1;%PATH%"
exit /b 0
