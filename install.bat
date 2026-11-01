@echo off
chcp 65001 > nul
title Web Image Collector - 拡張機能 インストールガイド

echo ======================================================================
echo    Web Image Collector - インストール案内 (Edge / Chrome 両対応)
echo ======================================================================
echo.

echo [1/3] 拡張機能の最新版をビルドしています...
call pnpm build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] ビルドに失敗しました。
    pause
    exit /b %ERRORLEVEL%
)
echo      -> ビルド完了 (dist フォルダ準備完了)
echo.

echo 普段お使いのブラウザを選択してください:
echo   [1] Microsoft Edge (推奨)
echo   [2] Google Chrome
echo.
set /p BROWSER_CHOICE="番号を入力してEnter (未入力は 1): "

if "%BROWSER_CHOICE%"=="2" (
    echo.
    echo [2/3] Google Chrome の拡張機能管理画面を開いています...
    start chrome.exe "chrome://extensions"
    set "BUTTON_NAME=パッケージ化されていない拡張機能を読み込む"
    set "DEV_POS=画面右上"
) else (
    echo.
    echo [2/3] Microsoft Edge の拡張機能管理画面を開いています...
    start msedge.exe "edge://extensions"
    set "BUTTON_NAME=展開して読み込む"
    set "DEV_POS=画面左側メニューまたは上部"
)

echo.
echo [3/3] 読み込むフォルダ (dist) をエクスプローラーで開いています...
explorer.exe "%~dp0dist"
echo.

echo ======================================================================
echo    【完了までの簡単3ステップ】
echo ======================================================================
echo   1. 開いたブラウザ画面の %DEV_POS% にある「開発者モード」を ON にする
echo   2. 表示される「%BUTTON_NAME%」をクリックする
echo   3. 開いたエクスプローラーの「dist」フォルダーを選択する
echo.
echo   ★ 読み込みが完了したら、ツールバー右上の拡張機能アイコン(パズルピース)
echo      から「Web Image Collector」をピン留めすると便利です！
echo ======================================================================
echo.
echo 何かキーを押すとこの画面を閉じます...
pause > nul
