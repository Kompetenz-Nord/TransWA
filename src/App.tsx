import { useState } from 'react';
import { Download } from 'lucide-react';
import { WhatsAppSimulatorPanel } from './components/WhatsAppSimulatorPanel';
import { WhisperServerPanel } from './components/WhisperServerPanel';
import { TestMatrixPanel } from './components/TestMatrixPanel';
import { ReleasePackagesPanel } from './components/ReleasePackagesPanel';
import { downloadVerifiedZip } from './utils/downloadZip';

type ActiveSection = 'adapter' | 'server' | 'tests' | 'packages';

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('adapter');
  const [downloadingTop, setDownloadingTop] = useState(false);

  const handleTopDownload = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (downloadingTop) return;
    setDownloadingTop(true);
    try {
      await downloadVerifiedZip(
        '/downloads/WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip',
        'WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip'
      );
    } finally {
      setDownloadingTop(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-3.5 flex items-center justify-between gap-3 md:gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('adapter');
            }}
            className="text-sm sm:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap truncate font-display"
          >
            WhatsApp Local AI Transcriber
          </a>

          <nav aria-label="Hauptnavigation" className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveSection('adapter')}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b-2 ${
                activeSection === 'adapter'
                  ? 'border-emerald-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Adapter-Labor
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('server')}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b-2 ${
                activeSection === 'server'
                  ? 'border-emerald-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Whisper-Server
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('tests')}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b-2 ${
                activeSection === 'tests'
                  ? 'border-emerald-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Testmatrix
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('packages')}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b-2 ${
                activeSection === 'packages'
                  ? 'border-emerald-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Pakete &amp; Setup
            </button>
          </nav>

          <div className="shrink-0">
            <a
              href="/downloads/WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip"
              download="WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip"
              onClick={handleTopDownload}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="sm:hidden">{downloadingTop ? 'Lade...' : 'Paket (.zip)'}</span>
              <span className="hidden sm:inline">
                {downloadingTop ? 'Lade ZIP...' : 'Windows-Paket (.zip)'}
              </span>
            </a>
          </div>
        </div>

        {/* Mobile Secondary Nav */}
        <div className="md:hidden border-t border-slate-100 px-3 py-2 grid grid-cols-4 gap-1 text-[11px] font-medium">
          {(
            [
              ['adapter', 'Adapter'],
              ['server', 'Server'],
              ['tests', 'Tests'],
              ['packages', 'Pakete'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`px-2 py-1.5 rounded-md text-center whitespace-nowrap truncate ${
                activeSection === id
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl w-full mx-auto px-6 py-8 flex-1 space-y-6">
        {/* Clean Editorial Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="space-y-1.5 max-w-3xl">
            <div className="text-xs font-medium text-slate-500">
              Manifest V3 · Chrome &amp; Edge · Interne WhatsApp-Medienmodule · Whisper Small
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Lokale KI-Sprachtranskription direkt in WhatsApp Business Web
            </h1>
          </div>
          <div className="text-xs text-slate-600 md:text-right shrink-0">
            <div>100 % lokal auf 127.0.0.1:8765</div>
            <div className="text-slate-500">Keine Cloud-APIs · Kein Play-Klick</div>
          </div>
        </div>

        {activeSection === 'adapter' && <WhatsAppSimulatorPanel />}
        {activeSection === 'server' && <WhisperServerPanel />}
        {activeSection === 'tests' && <TestMatrixPanel />}
        {activeSection === 'packages' && <ReleasePackagesPanel />}
      </main>
    </div>
  );
}
