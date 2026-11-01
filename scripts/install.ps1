$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Web Image Collector - インストール案内"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Web Image Collector - 拡張機能インストール案内 (Edge / Chrome)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$rootPath = Split-Path -Parent $PSScriptRoot

Write-Host "[1/3] 拡張機能の最新版をビルドしています..." -ForegroundColor Yellow
Set-Location $rootPath
& pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[エラー] ビルドに失敗しました。" -ForegroundColor Red
    Read-Host "Enterキーを押して終了してください..."
    exit $LASTEXITCODE
}
Write-Host "     -> ビルド完了 (dist フォルダ準備完了)" -ForegroundColor Green
Write-Host ""

Write-Host "普段お使いのブラウザを選択してください:" -ForegroundColor White
Write-Host "  [1] Microsoft Edge (推奨)" -ForegroundColor Green
Write-Host "  [2] Google Chrome" -ForegroundColor White
$choice = Read-Host "番号を入力してEnter (未入力は 1)"

$distPath = Join-Path $rootPath "dist"

if ($choice -eq "2") {
    Write-Host "`n[2/3] Google Chrome の拡張機能管理画面を開いています..." -ForegroundColor Yellow
    Start-Process "chrome.exe" "chrome://extensions"
    $btnName = "パッケージ化されていない拡張機能を読み込む"
    $devPos = "画面右上"
} else {
    Write-Host "`n[2/3] Microsoft Edge の拡張機能管理画面を開いています..." -ForegroundColor Yellow
    Start-Process "msedge.exe" "edge://extensions"
    $btnName = "展開して読み込む"
    $devPos = "画面左下または上部"
}

Write-Host "`n[3/3] 読み込むフォルダ (dist) をエクスプローラーで開いています..." -ForegroundColor Yellow
Start-Process "explorer.exe" $distPath

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   【完了までの簡単3ステップ】" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  1. ブラウザ画面の「$devPos」にある「開発者モード」を ON にする" -ForegroundColor White
Write-Host "  2. 表示される「$btnName」をクリックする" -ForegroundColor White
Write-Host "  3. 開いたエクスプローラーの「dist」フォルダーを選択する" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ★ 読み込み後、ブラウザ右上のパズルピースアイコンから" -ForegroundColor White
Write-Host "     「Web Image Collector」をピン留めすると常時使えます！" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

Read-Host "完了したらEnterキーを押してこの画面を閉じてください..."

