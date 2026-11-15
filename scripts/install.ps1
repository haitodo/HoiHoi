$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "HoiHoi - インストール案内"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   HoiHoi - 拡張機能インストール案内 (Edge / Chrome)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

function Resolve-WorkingPnpm {
    $candidates = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $addCandidate = {
        param([string]$Path)
        if ([string]::IsNullOrWhiteSpace($Path)) { return }
        if ($seen.Add($Path)) { $candidates.Add($Path) }
    }

    foreach ($cmd in (Get-Command pnpm -All -ErrorAction SilentlyContinue)) {
        if ($cmd.Source -and ($cmd.Source -match '\.(exe|cmd|bat)$')) {
            & $addCandidate $cmd.Source
        }
    }

    $extraPaths = @(
        $(if ($env:PNPM_HOME) { Join-Path $env:PNPM_HOME "pnpm.exe" }),
        $(if ($env:PNPM_HOME) { Join-Path $env:PNPM_HOME "bin\pnpm.exe" }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "pnpm\bin\pnpm.exe" }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "pnpm\pnpm.exe" }),
        $(if ($env:APPDATA) { Join-Path $env:APPDATA "npm\pnpm.cmd" })
    )
    foreach ($p in $extraPaths) {
        if ($p -and (Test-Path $p)) {
            & $addCandidate $p
        }
    }

    foreach ($candidate in $candidates) {
        try {
            & $candidate --version *> $null
            if ($LASTEXITCODE -eq 0) {
                return $candidate
            }
        } catch {
            # Skip broken shims (e.g. orphaned Corepack shims after Node.js upgrade)
        }
    }

    return $null
}

$rootPath = Split-Path -Parent $PSScriptRoot

Write-Host "[1/2] 拡張機能の最新版をビルドしています..." -ForegroundColor Yellow
Set-Location $rootPath
$pnpmBin = Resolve-WorkingPnpm
if (-not $pnpmBin) {
    Write-Host "[エラー] 動作する pnpm が見つかりませんでした。スタンドアロン版 pnpm をインストールするか PATH を確認してください。" -ForegroundColor Red
    Read-Host "Enterキーを押して終了してください..."
    exit 1
}
$pnpmDir = Split-Path -Parent $pnpmBin
if ($pnpmDir) {
    $env:PATH = "$pnpmDir;$env:PATH"
}
& $pnpmBin build
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
    $browserName = "Google Chrome"
    $extUrl = "chrome://extensions"
    $btnName = "パッケージ化されていない拡張機能を読み込む"
    $devPos = "画面右上"
    Start-Process "chrome.exe"
} else {
    $browserName = "Microsoft Edge"
    $extUrl = "edge://extensions"
    $btnName = "展開して読み込む"
    $devPos = "画面左下または上部"
    Start-Process "msedge.exe"
}

# Copy URL to clipboard for 1-click convenience
try {
    Set-Clipboard -Value $extUrl
    $clipboardNote = "（クリップボードにコピー済み！ アドレスバーで Ctrl + V を押して Enter）"
} catch {
    $clipboardNote = ""
}

Write-Host "`n[2/2] 読み込むフォルダ (dist) をエクスプローラーで開いています..." -ForegroundColor Yellow
Start-Process "explorer.exe" $distPath

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   【ブラウザでの簡単インストール手順】" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  セキュリティ制限のため、ブラウザの内部URLは手動で開く必要があります。" -ForegroundColor Gray
Write-Host ""
Write-Host "  手順A (最速):" -ForegroundColor Yellow
Write-Host "    1. ブラウザのアドレスバーに「 $extUrl 」を入力して Enter" -ForegroundColor White
Write-Host "       $clipboardNote" -ForegroundColor Cyan
Write-Host "    2. 「開発者モード」を ON にする" -ForegroundColor White
Write-Host "    3. 「$btnName」を押し、開いた「dist」フォルダーを選択" -ForegroundColor White
Write-Host "       ※開いたエクスプローラーから「dist」フォルダをブラウザ画面に" -ForegroundColor Gray
Write-Host "         直接ドラッグ＆ドロップするだけでも読み込めます！" -ForegroundColor Gray
Write-Host ""
Write-Host "  手順B (マウス操作のみ):" -ForegroundColor Yellow
Write-Host "    1. ブラウザ右上の「…」（メニュー）をクリック" -ForegroundColor White
Write-Host "    2. 「拡張機能」 → 「拡張機能の管理」をクリック" -ForegroundColor White
Write-Host "    3. 「開発者モード」を ON にして「$btnName」から「dist」を選択" -ForegroundColor White
Write-Host ""
Write-Host "  ★ 読み込み後、ブラウザ右上のパズルピースアイコンから" -ForegroundColor White
Write-Host "     「HoiHoi」をピン留めすると常時使えます！" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

Read-Host "完了したらEnterキーを押してこの画面を閉じてください..."

