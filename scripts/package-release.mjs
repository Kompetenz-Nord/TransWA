import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'extension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const VERSION = process.env.RELEASE_VERSION?.replace(/^v/i, '') || manifest.version || '1.0.0';

const DIST_EXT = path.join(ROOT, 'dist-extension');
const DIST_RELEASE = path.join(ROOT, 'dist-release');
const CHECKSUMS_DIR = path.join(ROOT, 'installer/checksums');
const PUBLIC_DOWNLOADS = path.join(ROOT, 'public/downloads');

if (!fs.existsSync(path.join(DIST_EXT, 'chrome')) || !fs.existsSync(path.join(DIST_EXT, 'edge'))) {
  throw new Error('dist-extension/chrome oder dist-extension/edge fehlt. Bitte zuerst build:extension ausführen.');
}

fs.rmSync(DIST_RELEASE, { recursive: true, force: true });
fs.mkdirSync(DIST_RELEASE, { recursive: true });
fs.mkdirSync(CHECKSUMS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DOWNLOADS, { recursive: true });

const chromeZipName = `WhatsApp-Local-AI-Transcriber-Chrome-v${VERSION}.zip`;
const edgeZipName = `WhatsApp-Local-AI-Transcriber-Edge-v${VERSION}.zip`;
const windowsZipName = `WhatsApp-Local-AI-Transcriber-Windows-v${VERSION}.zip`;

const chromeZipPath = path.join(DIST_RELEASE, chromeZipName);
const edgeZipPath = path.join(DIST_RELEASE, edgeZipName);
const windowsZipPath = path.join(DIST_RELEASE, windowsZipName);

// Create deterministic ZIP archives using Python's built-in zipfile module (works on Linux, macOS, Windows)
const pythonZipScript = `
import os, sys, zipfile

def zip_dir(src_dir, out_zip, prefix=""):
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src_dir):
            dirs.sort()
            files.sort()
            for fname in files:
                if fname.endswith(".pyc") or "__pycache__" in root or ".venv" in root:
                    continue
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, src_dir).replace("\\\\", "/")
                arcname = f"{prefix}/{rel_path}" if prefix else rel_path
                info = zipfile.ZipInfo(arcname, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 0
                info.external_attr = 0x20
                with open(full_path, "rb") as f:
                    zf.writestr(info, f.read())
    with zipfile.ZipFile(out_zip, "r") as zf_check:
        bad = zf_check.testzip()
        if bad is not None:
            raise RuntimeError(f"Corrupt ZIP entry: {bad}")

mode = sys.argv[1]
if mode == "dir":
    zip_dir(sys.argv[2], sys.argv[3])
elif mode == "windows":
    out_zip = sys.argv[2]
    root_dir = sys.argv[3]
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        def add_tree(src, arc_prefix):
            for r, dirs, files in os.walk(src):
                dirs[:] = sorted([d for d in dirs if d not in (".venv", "__pycache__", ".pytest_cache")])
                files.sort()
                for fname in files:
                    if fname.endswith(".pyc"):
                        continue
                    fp = os.path.join(r, fname)
                    rel = os.path.relpath(fp, src).replace("\\\\", "/")
                    arc = f"{arc_prefix}/{rel}" if arc_prefix else rel
                    info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.create_system = 0
                    info.external_attr = 0x20
                    with open(fp, "rb") as f:
                        zf.writestr(info, f.read())
        add_tree(os.path.join(root_dir, "dist-extension", "chrome"), "extensions/chrome")
        add_tree(os.path.join(root_dir, "dist-extension", "edge"), "extensions/edge")
        add_tree(os.path.join(root_dir, "backend"), "backend")
        add_tree(os.path.join(root_dir, "installer"), "installer")
        for doc in ("README.md", "SECURITY.md", "PRIVACY.md"):
            p = os.path.join(root_dir, doc)
            if os.path.exists(p):
                info = zipfile.ZipInfo(doc, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 0
                info.external_attr = 0x20
                with open(p, "rb") as f:
                    zf.writestr(info, f.read())
    with zipfile.ZipFile(out_zip, "r") as zf_check:
        bad = zf_check.testzip()
        if bad is not None:
            raise RuntimeError(f"Corrupt ZIP entry: {bad}")
`;

const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

execFileSync(pythonBin, ['-c', pythonZipScript, 'dir', path.join(DIST_EXT, 'chrome'), chromeZipPath], {
  stdio: 'inherit',
});
execFileSync(pythonBin, ['-c', pythonZipScript, 'dir', path.join(DIST_EXT, 'edge'), edgeZipPath], {
  stdio: 'inherit',
});
execFileSync(pythonBin, ['-c', pythonZipScript, 'windows', windowsZipPath, ROOT], {
  stdio: 'inherit',
});

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const checksumLines = [chromeZipName, edgeZipName, windowsZipName].map((name) => {
  const full = path.join(DIST_RELEASE, name);
  return `${sha256File(full)}  ${name}`;
});

const checksumContent = checksumLines.join('\n') + '\n';
fs.writeFileSync(path.join(DIST_RELEASE, 'SHA256SUMS.txt'), checksumContent, 'utf8');
fs.writeFileSync(path.join(CHECKSUMS_DIR, 'SHA256SUMS.txt'), checksumContent, 'utf8');

// Copy release ZIPs + checksums into public/downloads for web downloads & metadata manifest
for (const old of fs.readdirSync(PUBLIC_DOWNLOADS)) {
  fs.unlinkSync(path.join(PUBLIC_DOWNLOADS, old));
}
const releaseManifest = [];
for (const name of [chromeZipName, edgeZipName, windowsZipName]) {
  const src = path.join(DIST_RELEASE, name);
  const dest = path.join(PUBLIC_DOWNLOADS, name);
  fs.copyFileSync(src, dest);
  releaseManifest.push({
    fileName: name,
    sha256: sha256File(src),
    bytes: fs.statSync(src).size,
    url: `/downloads/${name}`,
  });
}
fs.copyFileSync(path.join(DIST_RELEASE, 'SHA256SUMS.txt'), path.join(PUBLIC_DOWNLOADS, 'SHA256SUMS.txt'));
fs.writeFileSync(
  path.join(PUBLIC_DOWNLOADS, 'release-manifest.json'),
  JSON.stringify({ version: VERSION, generatedAt: new Date().toISOString(), assets: releaseManifest }, null, 2) + '\n',
  'utf8'
);

console.log('[package-release] Generated release packages:');
for (const item of releaseManifest) {
  console.log(`  - ${item.fileName} (${item.bytes} bytes, sha256=${item.sha256})`);
}
