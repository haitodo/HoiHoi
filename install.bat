@echo off
chcp 65001 > nul
title Web Image Collector - Chrome 拡張機能 インストールガイド

echo ======================================================================
echo    Web Image Collector - インストール案内
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

echo [2/3] Google Chrome の拡張機能管理画面を開いています...
start chrome.exe "chrome://extensions"
echo.

echo [3/3] 読み込むフォルダ (dist) をエクスプローラーで開いています...
explorer.exe "%~dp0dist"
echo.

echo ======================================================================
echo    【完了までの簡単3ステップ】
echo ======================================================================
echo   1. 開いた Chrome 画面の右上にある「デベロッパー モード」を ON にする
echo   2. 左上に現れる「パッケージ化されていない拡張機能を読み込む」をクリック
echo   3. 開いたエクスプローラーの「dist」フォルダーを選択する
echo.
echo   ★ 読み込みが完了したら、Chrome 右上のパズルピースアイコンから
echo      「Web Image Collector」をピン留めすると便利です！
echo ======================================================================
echo.
echo 何かキーを押すとこの画面を閉じます...
pause > nul
