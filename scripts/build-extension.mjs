import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';

const ROOT = process.cwd();
const EXT_SRC = path.join(ROOT, 'extension');
const DIST_BASE = path.join(ROOT, 'dist-extension');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateSolidPngIcon(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = size * 4 + 1;
  const raw = Buffer.alloc(rowStride * size);
  const center = (size - 1) / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    const rowStart = y * rowStride;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.hypot(dx, dy);
      const idx = rowStart + 1 + x * 4;

      if (dist <= radius) {
        // Draw minimal waveform bars inside emerald badge
        const nx = (x - center) / radius;
        const ny = Math.abs((y - center) / radius);
        const isBar =
          (Math.abs(nx + 0.35) < 0.09 && ny < 0.32) ||
          (Math.abs(nx) < 0.09 && ny < 0.56) ||
          (Math.abs(nx - 0.35) < 0.09 && ny < 0.38);

        if (isBar) {
          raw[idx] = 255;
          raw[idx + 1] = 255;
          raw[idx + 2] = 255;
          raw[idx + 3] = 255;
        } else {
          raw[idx] = 15; // #0f766e
          raw[idx + 1] = 118;
          raw[idx + 2] = 110;
          raw[idx + 3] = 255;
        }
      } else {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildBrowserTarget(targetName) {
  const outDir = path.join(DIST_BASE, targetName);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const entryPoints = {
    'injected/main-world': path.join(EXT_SRC, 'src/injected/main-world.ts'),
    'content/content-script': path.join(EXT_SRC, 'src/content/content-script.ts'),
    'background/service-worker': path.join(EXT_SRC, 'src/background/service-worker.ts'),
    'popup/popup': path.join(EXT_SRC, 'src/popup/popup.ts'),
    'options/options': path.join(EXT_SRC, 'src/options/options.ts'),
  };

  await build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome116', 'edge116'],
    sourcemap: false,
    minify: false,
  });

  // Copy static HTML/CSS
  const staticPairs = [
    ['src/content/content.css', 'content/content.css'],
    ['src/popup/popup.html', 'popup/popup.html'],
    ['src/popup/popup.css', 'popup/popup.css'],
    ['src/options/options.html', 'options/options.html'],
    ['src/options/options.css', 'options/options.css'],
  ];

  for (const [srcRel, destRel] of staticPairs) {
    const dest = path.join(outDir, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(EXT_SRC, srcRel), dest);
  }

  // Generate PNG icons
  const iconsDir = path.join(outDir, 'assets/icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), generateSolidPngIcon(size));
  }

  // Write browser-specific manifest.json
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'manifest.json'), 'utf8'));
  if (targetName === 'edge') {
    // Edge Chromium supports standard MV3 without minimum_chrome_version warning
    delete manifest.minimum_chrome_version;
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function main() {
  await buildBrowserTarget('chrome');
  await buildBrowserTarget('edge');
  console.log('[build-extension] Built dist-extension/chrome and dist-extension/edge successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
