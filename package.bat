@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ======================================================================
echo    HoiHoi - 拡張機能パッケージ化 (CRX / ZIP 生成)
echo ======================================================================
echo.

call pnpm package
if %ERRORLEVEL% neq 0 (
    echo.
    echo [エラー] パッケージ化中にエラーが発生しました。
    pause
    exit /b %ERRORLEVEL%
)

echo 出力先フォルダー (release) をエクスプローラーで開きます...
start explorer "%~dp0release"
echo.
pause
