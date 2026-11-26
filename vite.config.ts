import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function ensureReleaseDownloadsPlugin(): Plugin {
  const downloadsDir = path.resolve(__dirname, 'public/downloads');
  const manifestFile = path.join(downloadsDir, 'release-manifest.json');

  const ensureBuilt = () => {
    if (!fs.existsSync(manifestFile)) {
      execFileSync(process.execPath, [path.resolve(__dirname, 'scripts/build-extension.mjs')], {
        stdio: 'inherit',
      });
      execFileSync(process.execPath, [path.resolve(__dirname, 'scripts/package-release.mjs')], {
        stdio: 'inherit',
      });
    }
  };

  return {
    name: 'serve-release-downloads',
    buildStart() {
      ensureBuilt();
    },
    configureServer(server) {
      ensureBuilt();
      server.middlewares.use('/downloads', (req, res, next) => {
        if (!req.url) return next();
        let cleanRel: string;
        try {
          cleanRel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        } catch {
          res.statusCode = 400;
          res.end('Bad request');
          return;
        }
        if (!cleanRel || cleanRel.includes('..') || cleanRel.includes('/') || cleanRel.includes('\\')) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const filePath = path.resolve(downloadsDir, cleanRel);
        if (!filePath.startsWith(downloadsDir + path.sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('Release artifact not found');
          return;
        }
        const stat = fs.statSync(filePath);
        if (cleanRel.endsWith('.zip')) {
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${cleanRel}"`);
        } else if (cleanRel.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        } else {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        }
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      ensureReleaseDownloadsPlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
