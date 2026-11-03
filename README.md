# HoiHoi - Chrome 拡張機能 (Manifest V3)

Webページ上の画像を検出し、Chrome Side Panel 上で選択・一括ダウンロードする Chrome 拡張機能の MVP 実装プロジェクトです。

## 重要なドキュメント

1. **[spec.md](spec.md)**: 利用者向け機能仕様書 (MVP版 v1.1)
2. **[design.md](design.md)**: **コアアーキテクチャ技術設計書** (必須の7大ガードレール、データ構造、非同期同期モデル、別のAIへの実装委譲タスク一覧)
3. **[performance.md](performance.md)**: 未使用時の停止条件、リソース上限、回帰テスト、実ブラウザでの確認手順

---

## 開発ルール・制約事項

- **パッケージマネージャー**: `pnpm` のみ使用（`npm` / `yarn` / `bun` の使用は厳禁）
- **対応ブラウザ**: Chrome 116 以降（`action.onClicked` と `chrome.sidePanel.open` の連携）
- **ビルドツール**: Vite 6（Side Panel + Background SW の ESM ビルド と、動的注入 Content Script の単一 IIFE ビルドの2段構成）
- **UI フレームワーク**: React 19 + TypeScript + `@tanstack/react-virtual`（仮想スクロール）

---

## コマンド一覧

```powershell
# 依存関係のインストール (pnpm 必須)
pnpm install

# 型チェックと拡張機能のビルド (dist/ に出力)
pnpm build

# 単体テストの実行 (Vitest)
pnpm test

# 拡張機能のパッケージ化 (CRX / ZIP 生成 & 拡張機能ID固定化)
pnpm package
# または Windows エクスプローラーで package.bat をダブルクリック
```

### パッケージ化と拡張機能IDの固定化について

Chrome 拡張機能は通常、読み込みフォルダのパスやパッケージ化のたびに生成される秘密鍵によって32桁の拡張機能ID（例: `aknfdhacadhkkenklgmjklchcfjjnghh`）が変化します。IDが変わってしまうと、ブラウザに保存された設定（`chrome.storage`）や権限許可、ツールバーのピン留めが初期化されてしまいます。

本プロジェクトでは**ID固定化の自動管理機構**（[scripts/package.mjs](scripts/package.mjs)）を導入しています：

1. **秘密鍵 (`key.pem`) の永続化**:
   - 初回パッケージ化時に RSA 秘密鍵 `key.pem` を自動生成し、以降はこの鍵を一貫して使用します。
   - `key.pem` は Git 管理対象外（`.gitignore`）となっています。安全に保管してください。
2. **マニフェスト (`manifest.json`) の公開鍵 (`key`) 自動同期**:
   - 秘密鍵から導出された公開鍵が `public/manifest.json` の `"key"` フィールドに自動設定されます。
   - これにより、`dist` を**「パッケージ化されていない拡張機能」として読み込んだ場合でも、常に全く同じ32桁の固定ID**になります。
3. **パッケージ成果物 (`release/`)**:
   - `hoihoi-v{version}.zip`: Chrome Web Store や Edge アドオンストア提出用、またはZIP展開配布用
   - `hoihoi-v{version}.crx`: Chromium ブラウザ直接インストール用の自己署名パッケージ

---

### Chrome / Edge への読み込み方法

1. Google Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリックし、このリポジトリの `dist` ディレクトリを選択する

---

## 実装状況（完了）

### ページを切り替えても同じ保存フォルダへ

自動生成するフォルダ名は、URLで確認できるページ番号と一致する「2ページ」「Page 2」「第2页」等の独立した表記を取り除きます。例えば「写真集 - 微图坊」と「写真集 - 2ページ - 微图坊」は、どちらも「写真集 - 微图坊」へ保存します。画面には元のタイトルを表示し、作品名の巻数・年・単なる数字は保持します。URLからページ番号を確認できない場合や、明示したフォルダ名はそのまま使います。

### 必要なときだけ使う追加スキャン

画像モードの「追加スキャン（必要なときだけ）」を開き、目的のボタンを押します。設定は保存されず、通常のスキャンで自動実行されません。

- **寸法を取得**: 未読み込み画像の寸法を調べ、サイズフィルターに反映します。画像の読み込み通信が発生します。
- **自動スクロール**: ページを順にスクロールして遅延読み込みを促し、完了・停止後に元の位置へ戻します。手動スクロール操作をした場合はその位置を優先して停止します。
- **別ページの画像を収集**: ページ番号・ページ送り欄・`rel="next"`等とURL構造を照合し、同じ一覧の別ページから本文画像を集めます。`?page=2`、`?paged=2`、`/page/2/`やカーソル形式などに対応します。ページ送りを特定できない場合や複数の候補が混在する場合は通信を始めず停止します。v2phは専用の画像抽出ルールも使用します。収集後、必要に応じて「寸法を取得」を実行できます。

実行中は「停止」で中断でき、対象変更・再スキャン・パネル閉鎖でも停止します。処理は1回につき最大2分、別ページ収集は最大50ページです。追加された画像は通常どおり選択して保存します。

別ページ収集は、同一オリジン・同じページ送りのURL構造・同じ検索条件に限定します。取得したHTMLに存在する画像が対象です。JavaScriptのボタン操作で初めて生成されるページや、判別できない独自URL形式は追加対応が必要で、自動スクロールが適する場合もあります。

仕様書（`spec.md`）および設計書（`design.md`）の全要件・全タスクの実装が完了し、本番ビルドおよび単体テストが正常に通過しています。

- **Step 1: 共有純粋ロジック (完了)**:
  - `src/shared/url-utils.ts`: URL解決・スキーム検証・CDNカンマ混入srcset解析・CSS背景url解析・拡張子判定・形式推定
  - `src/shared/filename-utils.ts`: Windows予約デバイス名（CON, PRN等）対応・禁止文字サニタイズ・100文字制限・重複回避
  - `src/**/__tests__/*`: 監視の寿命・キャッシュ・保存復旧・キュー・ストリーム転送を含む回帰テスト
- **Step 2: Content Script スキャナ (完了)**:
  - `src/content/dom-extractor.ts`: img/picture/css-bg/svg/lazy/a.href からの候補グループ抽出、32KB超 data: URL の退避
  - `src/content/chunk-runner.ts`: 8msタイムスライス走査、40件/50msバッチ送信、MutationObserver（150msデバウンス）、キャプチャ load イベントによる寸法追従
  - `src/content/blob-reader.ts`: ページオリジン内でのオンデマンド blob: → Data URL 変換（25MB上限）
  - `src/content/scanner.ts`: `window.__WIC_SCANNER__` による多重登録防止ガード付き単一 IIFE エントリ
- **Step 3: Background Service Worker (完了)**:
  - `src/background/session-store.ts`: tabId別セッション管理、occurrenceKey重複防止、10MBクォータ保護、直列デバウンス永続化
  - `src/background/tab-coordinator.ts`: activeTab起動時のスクリプト注入、ページ遷移 stale 検知、再スキャン制御
  - `src/background/download-manager.ts`: 同時実行3件FIFOキュー、blob解決連携、InterruptReason分類、SW再起動時の突合
  - `src/background/index.ts`: 同期 sidePanel.open ガード付き Service Worker エントリ
- **Step 4: Side Panel UI (完了)**:
  - `src/sidepanel/hooks/useActiveTabId.ts`: tabs権限不要のアクティブタブ追跡
  - `src/sidepanel/hooks/useTabSession.ts`: revision 自己修復型 Delta 購読
  - `src/sidepanel/components/*`: Header, FilterBar, SelectionToolbar, ImageGrid (TanStack Virtual 行仮想化), ImageCard, DownloadFooter, EmptyOrStatusView
  - `src/sidepanel/App.tsx`: 統合レイアウト・フィルター・選択状態管理
