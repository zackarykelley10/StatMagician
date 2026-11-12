import type { ProviderId, Settings } from '@/core/types';
import { useApp } from '@/store';

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'mock', label: 'Demo (no AI, scripted plays)' },
];

const MIN_CLIP_SEC = 15;
const MAX_CLIP_SEC = 60;
const MIN_OVERLAP_SEC = 5;
const MAX_OVERLAP_SEC = 20;
const MIN_THRESHOLD = 0.3;
const MAX_THRESHOLD = 0.95;

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 aria-[invalid=true]:border-red-500';
const helpClass = 'mt-1 text-xs text-slate-500';

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);

  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  const overlapInvalid = settings.overlapSec >= settings.segmentSec;
  const clipInvalid = settings.segmentSec < MIN_CLIP_SEC || settings.segmentSec > MAX_CLIP_SEC;
  const overlapOutOfRange = settings.overlapSec < MIN_OVERLAP_SEC || settings.overlapSec > MAX_OVERLAP_SEC;

  const readNumber = (raw: string, fallback: number) => {
    const n = Number(raw);
    return raw.trim() === '' || Number.isNaN(n) ? fallback : n;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 text-slate-900">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">Changes are saved automatically.</p>
      </header>

      <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(e) => e.preventDefault()}>
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">AI provider</h2>

          <div>
            <label htmlFor="settings-provider" className="block text-sm font-medium text-slate-700">
              Provider
            </label>
            <select
              id="settings-provider"
              value={settings.provider}
              onChange={(e) => update({ provider: e.target.value as ProviderId })}
              className={inputClass}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="settings-api-key" className="block text-sm font-medium text-slate-700">
              API key
            </label>
            <input
              id="settings-api-key"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className={inputClass}
            />
            <p className={helpClass}>Stored only in this browser. Sent only to the AI provider.</p>
          </div>

          <div>
            <label htmlFor="settings-model" className="block text-sm font-medium text-slate-700">
              Model
            </label>
            <input
              id="settings-model"
              type="text"
              placeholder="Provider default"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              className={inputClass}
            />
            <p className={helpClass}>Leave empty to use the provider's default model.</p>
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-200 pt-5">
          <h2 className="text-lg font-semibold text-slate-800">Review</h2>

          <div>
            <label htmlFor="settings-threshold" className="block text-sm font-medium text-slate-700">
              Review threshold: {Math.round(settings.reviewThreshold * 100)}%
            </label>
            <input
              id="settings-threshold"
              type="range"
              min={MIN_THRESHOLD}
              max={MAX_THRESHOLD}
              step={0.05}
              value={settings.reviewThreshold}
              onChange={(e) => update({ reviewThreshold: readNumber(e.target.value, settings.reviewThreshold) })}
              className="mt-2 w-full accent-emerald-600"
            />
            <p className={helpClass}>Plays below this confidence go to the review queue</p>
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-200 pt-5">
          <h2 className="text-lg font-semibold text-slate-800">Clips</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-clip" className="block text-sm font-medium text-slate-700">
                Clip length (seconds)
              </label>
              <input
                id="settings-clip"
                type="number"
                min={MIN_CLIP_SEC}
                max={MAX_CLIP_SEC}
                step={1}
                value={settings.segmentSec}
                aria-invalid={clipInvalid}
                onChange={(e) => update({ segmentSec: readNumber(e.target.value, settings.segmentSec) })}
                className={inputClass}
              />
              {clipInvalid && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  Enter a clip length from {MIN_CLIP_SEC} to {MAX_CLIP_SEC} seconds.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="settings-overlap" className="block text-sm font-medium text-slate-700">
                Overlap (seconds)
              </label>
              <input
                id="settings-overlap"
                type="number"
                min={MIN_OVERLAP_SEC}
                max={MAX_OVERLAP_SEC}
                step={1}
                value={settings.overlapSec}
                aria-invalid={overlapInvalid || overlapOutOfRange}
                onChange={(e) => update({ overlapSec: readNumber(e.target.value, settings.overlapSec) })}
                className={inputClass}
              />
              {overlapOutOfRange && !overlapInvalid && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  Enter an overlap from {MIN_OVERLAP_SEC} to {MAX_OVERLAP_SEC} seconds.
                </p>
              )}
              {overlapInvalid && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  Overlap must be less than the clip length.
                </p>
              )}
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
