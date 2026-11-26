import { useEffect, useState } from 'react';
import { Download, FileCheck2, Terminal } from 'lucide-react';
import type { ReleaseManifest } from '../data/projectData';
import { downloadVerifiedZip } from '../utils/downloadZip';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function ReleasePackagesPanel() {
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/downloads/release-manifest.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ReleaseManifest>;
      })
      .then((data) => {
        if (active) setManifest(data);
      })
      .catch((err: Error) => {
        if (active) setLoadError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDownload = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    url: string,
    fileName: string
  ) => {
    e.preventDefault();
    setDownloadError(null);
    setDownloadingFile(fileName);
    try {
      await downloadVerifiedZip(url, fileName);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Download fehlgeschlagen.'
      );
    } finally {
      setDownloadingFile(null);
    }
  };

  const getLabelForAsset = (fileName: string): { title: string; subtitle: string } => {
    if (fileName.includes('Chrome')) {
      return {
        title: 'Paket A · Google Chrome',
        subtitle: 'Entpackte MV3-Erweiterung für chrome://extensions (Entwicklermodus)',
      };
    }
    if (fileName.includes('Edge')) {
      return {
        title: 'Paket B · Microsoft Edge',
        subtitle: 'Entpackte MV3-Erweiterung für edge://extensions (Entwicklermodus)',
      };
    }
    return {
      title: 'Paket C · Windows Komplettinstallation',
      subtitle: 'Chrome + Edge + lokaler Whisper-Server + Install.ps1 + README_DE.md',
    };
  };

  return (
    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Installationspakete &amp; SHA-256-Prüfsummen
        </h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          Alle Pakete werden reproduzierbar aus diesem Repository gebaut. Laden Sie die fertigen
          ZIP-Archive direkt herunter oder lösen Sie einen automatischen GitHub Release über einen
          Versions-Tag wie <span className="font-mono text-slate-900">v1.0.0</span> aus.
        </p>
        {downloadError && (
          <p className="text-xs font-medium text-red-700 pt-1">{downloadError}</p>
        )}
      </div>

      {loadError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
          Release-Manifest konnte nicht geladen werden ({loadError}). Führen Sie{' '}
          <span className="font-mono">npm run build:extension &amp;&amp; npm run package:release</span> aus.
        </div>
      ) : !manifest ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-white border border-slate-200 rounded-xl p-5 h-44 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {manifest.assets.map((asset) => {
            const info = getLabelForAsset(asset.fileName);
            const isBusy = downloadingFile === asset.fileName;
            return (
              <div
                key={asset.fileName}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="text-xs font-medium text-emerald-700">{info.title}</div>
                  <div className="font-mono text-xs font-semibold text-slate-900 break-all">
                    {asset.fileName}
                  </div>
                  <p className="text-xs text-slate-600">{info.subtitle}</p>
                </div>

                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Größe</span>
                    <span className="font-mono tabular-nums text-slate-800">
                      {formatBytes(asset.bytes)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <span>SHA-256:</span>
                    <div className="font-mono text-[10px] text-slate-700 break-all mt-0.5">
                      {asset.sha256}
                    </div>
                  </div>
                  <a
                    href={asset.url}
                    download={asset.fileName}
                    onClick={(e) => void handleDownload(e, asset.url, asset.fileName)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isBusy ? 'Prüfe & lade ZIP...' : 'Paket herunterladen'}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileCheck2 className="w-4 h-4 text-emerald-700" />
            <span>Installation in Chrome &amp; Edge (Windows 10/11)</span>
          </div>
          <ol className="list-decimal list-inside space-y-2 text-xs text-slate-700 leading-relaxed">
            <li>
              <strong>Windows-Setup ausführen:</strong> Komplettpaket entpacken und{' '}
              <span className="font-mono">.\installer\Install.ps1</span> ohne Adminrechte starten.
              Das Skript richtet Python, Whisper Small und das lokale Client-Token ein.
            </li>
            <li>
              <strong>Chrome:</strong> <span className="font-mono">chrome://extensions</span> öffnen,
              oben rechts <strong>Entwicklermodus</strong> aktivieren, auf{' '}
              <strong>Entpackte Erweiterung laden</strong> klicken und den Ordner{' '}
              <span className="font-mono">chrome</span> wählen.
            </li>
            <li>
              <strong>Edge:</strong> <span className="font-mono">edge://extensions</span> öffnen,{' '}
              <strong>Entwicklermodus</strong> aktivieren, <strong>Entpacktes Element laden</strong>{' '}
              klicken und den Ordner <span className="font-mono">edge</span> wählen.
            </li>
            <li>
              <strong>Token hinterlegen:</strong> In den Erweiterungsoptionen das erzeugte{' '}
              <span className="font-mono">auth.token</span> eintragen und Verbindung zu{' '}
              <span className="font-mono">127.0.0.1:8765</span> testen.
            </li>
          </ol>
          <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            Hinweis: Chrome/Edge blockieren ohne Entwicklermodus selbst gehostete ZIP-Erweiterungen
            auf Windows. Für Rollouts ohne Entwicklermodus können die Pakete A &amp; B im Chrome Web
            Store bzw. Microsoft Edge Add-ons Store veröffentlicht werden.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Terminal className="w-4 h-4 text-emerald-700" />
            <span>GitHub-Repository verbinden &amp; Release v1.0.0 auslösen</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Die Workflows <span className="font-mono">.github/workflows/test.yml</span>,{' '}
            <span className="font-mono">build.yml</span> und{' '}
            <span className="font-mono">release.yml</span> prüfen automatisch TypeScript, Extension-Tests,
            Backend-Tests und erzeugen die 3 Release-ZIPs samt <span className="font-mono">SHA256SUMS.txt</span>.
          </p>
          <pre className="p-3.5 rounded-lg bg-slate-900 text-slate-100 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
{`git init
git add .
git commit -m "Initial release v1.0.0"
git branch -M main
git remote add origin https://github.com/<USER>/whatsapp-business-local-ai-transcriber.git
git push -u origin main

git tag v1.0.0
git push origin v1.0.0`}
          </pre>
        </div>
      </div>
    </section>
  );
}
