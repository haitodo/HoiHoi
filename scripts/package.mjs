import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const keyPath = resolve(rootDir, 'key.pem');
const publicManifestPath = resolve(rootDir, 'public', 'manifest.json');
const distDir = resolve(rootDir, 'dist');
const releaseDir = resolve(rootDir, 'release');

/**
 * Derives the 32-character Chrome Extension ID from the DER-encoded SPKI public key.
 * Algorithm: SHA256(spkiDer) -> take first 16 bytes (128 bits) -> map each nibble to 'a'-'p'.
 */
function deriveExtensionId(spkiDer) {
  const hash = createHash('sha256').update(spkiDer).digest();
  return Array.from(hash.subarray(0, 16))
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 0x0f)))
    .join('');
}

/**
 * Finds Google Chrome or Microsoft Edge executable on the system.
 */
function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Runs a pnpm command without triggering Node's shell-arg deprecation warning.
 */
function runPnpm(pnpmBin, args, options = {}) {
  if (process.platform === 'win32' && (pnpmBin === 'pnpm' || /\.(cmd|bat)$/i.test(pnpmBin))) {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', pnpmBin, ...args], options);
  }
  return execFileSync(pnpmBin, args, options);
}

/**
 * Resolves a working pnpm executable, skipping broken Corepack shims left behind
 * when Node.js is upgraded to a version without bundled Corepack (e.g. Node 25+).
 */
function findWorkingPnpm() {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidate) => {
    if (!candidate) return;
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  if (process.platform === 'win32') {
    try {
      const found = execFileSync('where.exe', ['pnpm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of found.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && /\.(exe|cmd|bat|com)$/i.test(trimmed)) {
          addCandidate(trimmed);
        }
      }
    } catch {
      // Fall through to well-known standalone pnpm locations
    }

    const extraPaths = [
      process.env.PNPM_HOME && join(process.env.PNPM_HOME, 'pnpm.exe'),
      process.env.PNPM_HOME && join(process.env.PNPM_HOME, 'bin', 'pnpm.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm', 'bin', 'pnpm.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.exe'),
      process.env.APPDATA && join(process.env.APPDATA, 'npm', 'pnpm.cmd'),
    ];
    for (const candidate of extraPaths) {
      if (candidate && existsSync(candidate)) {
        addCandidate(candidate);
      }
    }
    addCandidate('pnpm');
  } else {
    addCandidate('pnpm');
    try {
      const found = execFileSync('which', ['-a', 'pnpm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of found.split(/\r?\n/)) {
        addCandidate(line);
      }
    } catch {
      // Fall through to well-known standalone pnpm locations
    }

    const home = process.env.HOME;
    const extraPaths = [
      process.env.PNPM_HOME && join(process.env.PNPM_HOME, 'pnpm'),
      home && join(home, '.local', 'share', 'pnpm', 'pnpm'),
      home && join(home, '.pnpm', 'pnpm'),
    ];
    for (const candidate of extraPaths) {
      if (candidate && existsSync(candidate)) {
        addCandidate(candidate);
      }
    }
  }

  for (const candidate of candidates) {
    try {
      runPnpm(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Skip broken shims (e.g. orphaned Corepack shims after Node.js upgrade)
    }
  }

  throw new Error(
    '動作する pnpm が見つかりませんでした。Node.js 更新により Corepack shim が無効になっている場合は、スタンドアロン版 pnpm をインストールするか PATH を確認してください。',
  );
}

/**
 * Formats byte size into human readable string.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  console.log('\n======================================================================');
  console.log('   HoiHoi - 拡張機能パッケージ化 & ID固定化ビルド');
  console.log('======================================================================\n');

  // 1. Ensure private key exists, or generate a permanent one
  let privateKeyPem;
  let isNewKey = false;
  if (existsSync(keyPath)) {
    console.log(`[1/5] 既存の署名鍵を使用します: ${keyPath}`);
    privateKeyPem = readFileSync(keyPath, 'utf8');
  } else {
    console.log(`[1/5] 新しい署名鍵 (key.pem) を生成しています (初回のみ)...`);
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
    isNewKey = true;
    console.log(`     -> 秘密鍵を保存しました: ${keyPath}`);
  }

  // Derive public key and 32-character Extension ID
  const privKeyObj = createPrivateKey(privateKeyPem);
  const pubKeyObj = createPublicKey(privKeyObj);
  const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  const pubKeyBase64 = spkiDer.toString('base64');
  const extensionId = deriveExtensionId(spkiDer);

  console.log(`     -> 固定拡張機能ID: ${extensionId}`);

  // 2. Synchronize manifest.json "key" field
  console.log(`[2/5] public/manifest.json の "key" フィールドを確認中...`);
  const manifestRaw = readFileSync(publicManifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  if (manifest.key !== pubKeyBase64) {
    manifest.key = pubKeyBase64;
    writeFileSync(publicManifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('     -> "key" (公開鍵) を manifest.json に設定しました (ID固定化完了)');
  } else {
    console.log('     -> "key" (公開鍵) は最新の鍵と一致しています');
  }

  const version = manifest.version || '0.1.0';

  // 3. Run production build
  const pnpmBin = findWorkingPnpm();
  const pnpmDir = dirname(pnpmBin);
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const buildEnv = pnpmDir && pnpmDir !== '.'
    ? { ...process.env, PATH: `${pnpmDir}${pathSep}${process.env.PATH || ''}` }
    : process.env;
  console.log(`\n[3/5] 最新コードをビルドしています (pnpm build)...`);
  runPnpm(pnpmBin, ['build'], { cwd: rootDir, stdio: 'inherit', env: buildEnv });

  // 4. Create release directory & packages
  console.log(`\n[4/5] 配布パッケージを生成しています...`);
  mkdirSync(releaseDir, { recursive: true });

  const zipName = `hoihoi-v${version}.zip`;
  const crxName = `hoihoi-v${version}.crx`;
  const targetZipPath = join(releaseDir, zipName);
  const targetCrxPath = join(releaseDir, crxName);

  // Generate ZIP package (For Chrome Web Store / Edge Add-ons / Manual sharing)
  if (existsSync(targetZipPath)) {
    unlinkSync(targetZipPath);
  }

  try {
    // Try tar.exe (built-in on Windows 10/11 and unix)
    execSync(`tar -a -c -f "${targetZipPath}" -C "${distDir}" .`, { stdio: 'pipe' });
  } catch {
    // Fallback to powershell Compress-Archive
    const psCmd = `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${targetZipPath}" -Force`;
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'inherit' });
  }

  const zipSize = statSync(targetZipPath).size;
  console.log(`     -> ZIPパッケージ作成: release/${zipName} (${formatBytes(zipSize)})`);

  // Generate CRX package using Chrome or Edge
  const browser = findBrowserExecutable();
  let crxCreated = false;
  if (browser) {
    const tempCrxOutput = resolve(rootDir, 'dist.crx');
    if (existsSync(tempCrxOutput)) unlinkSync(tempCrxOutput);
    if (existsSync(targetCrxPath)) unlinkSync(targetCrxPath);

    try {
      execFileSync(browser, [
        `--pack-extension=${distDir}`,
        `--pack-extension-key=${keyPath}`,
        '--no-message-box',
      ]);

      if (existsSync(tempCrxOutput)) {
        copyFileSync(tempCrxOutput, targetCrxPath);
        unlinkSync(tempCrxOutput);
        const crxSize = statSync(targetCrxPath).size;
        console.log(`     -> CRXパッケージ作成: release/${crxName} (${formatBytes(crxSize)})`);
        crxCreated = true;
      }
    } catch (e) {
      console.warn(`     [注意] ブラウザによるCRX生成をスキップしました: ${e.message}`);
    }
  } else {
    console.warn('     [注意] Chrome / Edge が検出されなかったため、CRX生成をスキップしました (ZIPは正常に生成されました)。');
  }

  // 5. Summary
  console.log('\n======================================================================');
  console.log('   ★ パッケージ化が正常に完了しました！');
  console.log('======================================================================');
  console.log(`  【拡張機能ID】  : ${extensionId}`);
  console.log(`  【バージョン】  : v${version}`);
  console.log(`  【出力フォルダ】: ${releaseDir}`);
  console.log('');
  console.log('  生成物一覧:');
  console.log(`    1. release/${zipName}`);
  console.log('       -> Chrome Web Store / Edge アドオンストア提出用、またはZIP共有用');
  if (crxCreated) {
    console.log(`    2. release/${crxName}`);
    console.log('       -> Chromiumブラウザ用 CRXパッケージ');
  }
  console.log(`    3. key.pem (${isNewKey ? '新規作成' : '保持中'})`);
  console.log('       -> 署名用の秘密鍵です。この鍵を保持することで、次回以降の機能強化時も');
  console.log('          拡張機能の32桁IDが永久に変わりません！');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('\n[エラー] パッケージ化中にエラーが発生しました:', err);
  process.exit(1);
});
