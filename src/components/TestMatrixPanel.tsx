import { useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { TEST_MATRIX_ENTRIES } from '../data/projectData';

type FilterMode = 'all' | 'automated' | 'manual';

export function TestMatrixPanel() {
  const [filter, setFilter] = useState<FilterMode>('all');

  const filtered = TEST_MATRIX_ENTRIES.filter((entry) => {
    if (filter === 'automated') return entry.mode.startsWith('Automatisiert');
    if (filter === 'manual') return entry.mode.startsWith('Manuell');
    return true;
  });

  const automatedCount = TEST_MATRIX_ENTRIES.filter((e) =>
    e.mode.startsWith('Automatisiert')
  ).length;
  const manualCount = TEST_MATRIX_ENTRIES.length - automatedCount;

  return (
    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Qualitätsprüfung &amp; Testabgrenzung (Simuliert vs. Live)
          </h2>
          <p className="text-sm text-slate-600">
            {automatedCount} automatisierte Unit-/Simulationsbereiche verifiziert · {manualCount}{' '}
            Live-Abnahme mit echtem WhatsApp Web unter Windows erforderlich.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Alle ({TEST_MATRIX_ENTRIES.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('automated')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'automated'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Automatisiert ({automatedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('manual')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filter === 'manual'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Live-Check ({manualCount})
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Bereich</th>
                <th className="py-3 px-4 font-semibold">Prüfpunkt</th>
                <th className="py-3 px-4 font-semibold">Nachweisart</th>
                <th className="py-3 px-4 font-semibold">Datei / Quelle</th>
                <th className="py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filtered.map((item) => {
                const isVerified = item.status === 'Verifiziert';
                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {item.category}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{item.title}</div>
                      <div className="text-slate-500 mt-0.5">{item.notes}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{item.mode}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {item.target}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${
                          isVerified ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {isVerified ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        {item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Reproduzierbare Testkommandos (Lokal &amp; CI)
        </h3>
        <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 text-xs leading-relaxed overflow-x-auto">
{`npm run typecheck:extension
npm run test:extension
python3 -m unittest discover -s backend/tests -p "test_*.py" -v
npm run build:extension
npm run package:release`}
        </pre>
      </div>
    </section>
  );
}
