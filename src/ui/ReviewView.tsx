import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayData } from '@/core/types';
import { useApp } from '@/store';
import { ClipPlayer } from './ClipPlayer';
import { PlayEditor } from './PlayEditor';
import { confidenceClass } from './PlayRow';
import { fmtClock, fmtConfidence, fmtSituation, playTypeLabel } from './format';

function Bar({ label, value }: { label: string; value: number }) {
  const v = Math.min(1, Math.max(0, value));
  const color = v >= 0.85 ? 'bg-emerald-500' : v >= 0.7 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-slate-600">{fmtConfidence(v)}</span>
    </div>
  );
}

export function ReviewView() {
  const game = useApp((s) => s.game);
  const plays = useApp((s) => s.plays);
  const editPlay = useApp((s) => s.editPlay);
  const acceptPlay = useApp((s) => s.acceptPlay);
  const deletePlay = useApp((s) => s.deletePlay);
  const setView = useApp((s) => s.setView);

  const queue = useMemo(
    () => plays.filter((p) => p.status === 'needs_review').sort((a, b) => a.seq - b.seq),
    [plays],
  );
  const [index, setIndex] = useState(0);
  const count = queue.length;
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1);
  const play = count > 0 ? queue[safeIndex] : undefined;

  const next = () => setIndex(count > 0 ? (safeIndex + 1) % count : 0);
  const prev = () => setIndex(count > 0 ? (safeIndex - 1 + count) % count : 0);
  // After accept/save/delete the item leaves the queue, so the same index is the next item.
  const stay = () => setIndex(safeIndex);

  const handlers = useRef({ next, prev, accept: () => {}, remove: () => {} });
  useEffect(() => {
    handlers.current = {
      next,
      prev,
      accept: () => {
        if (play) {
          void acceptPlay(play.id);
          stay();
        }
      },
      remove: () => {
        if (play) {
          void deletePlay(play.id);
          stay();
        }
      },
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const h = handlers.current;
      switch (e.key) {
        case 'a': case 'A': e.preventDefault(); h.accept(); break;
        case 'd': case 'D': e.preventDefault(); h.remove(); break;
        case 'n': case 'N': case 'ArrowRight': e.preventDefault(); h.next(); break;
        case 'p': case 'P': case 'ArrowLeft': e.preventDefault(); h.prev(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!game) return null;

  if (!play) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="text-3xl">&#10003;</div>
        <h2 className="mt-2 text-lg font-semibold text-slate-800">Nothing to review</h2>
        <p className="mt-1 text-sm text-slate-500">Every play the AI was unsure about has been handled.</p>
        <button
          type="button"
          onClick={() => setView('live')}
          className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Back to live view
        </button>
      </div>
    );
  }

  const situation = fmtSituation(play, game);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">
          Review queue <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-800">{count}</span>
        </h2>
        <p className="text-xs text-slate-500">
          Shortcuts: <kbd className="font-mono">A</kbd> accept, <kbd className="font-mono">D</kbd> delete,{' '}
          <kbd className="font-mono">N</kbd>/<kbd className="font-mono">&rarr;</kbd> next,{' '}
          <kbd className="font-mono">P</kbd>/<kbd className="font-mono">&larr;</kbd> previous
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white lg:max-h-[80vh]">
          {queue.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50 ${
                  i === safeIndex ? 'bg-emerald-50' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-400">#{p.seq}</span>
                  <span className="text-slate-500">
                    Q{p.quarter} {fmtClock(p.clock)}
                  </span>
                  <span className={`rounded-full px-1.5 ${confidenceClass(p.confidence)}`}>{fmtConfidence(p.confidence)}</span>
                </div>
                <div className="mt-0.5 truncate text-slate-700">{p.description || playTypeLabel(p.type)}</div>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ClipPlayer key={play.id} play={play} />

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-white">{game[play.offense].abbr}</span>
                  <span className="font-medium text-slate-600">{playTypeLabel(play.type)}</span>
                  <span className="text-slate-500">Q{play.quarter} {fmtClock(play.clock)}</span>
                  {situation && <span className="text-slate-500">{situation}</span>}
                  <span className="font-mono font-semibold text-slate-700">
                    {play.yards > 0 ? `+${play.yards}` : play.yards} yd
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-800">{play.description}</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-slate-600">Overall</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${confidenceClass(play.confidence)}`}>
                    {fmtConfidence(play.confidence)}
                  </span>
                  <span className="text-slate-500">
                    Evidence: {play.evidence.length > 0 ? play.evidence.join(', ') : 'none'}
                  </span>
                </div>
                <Bar label="Players" value={play.confidenceDetail.players} />
                <Bar label="Yards" value={play.confidenceDetail.yards} />
                <Bar label="Situation" value={play.confidenceDetail.situation} />
              </div>

              <div className="rounded border border-amber-200 bg-amber-50 p-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">Why this needs review</h3>
                {play.flags.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-amber-900">
                    {play.flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-amber-900">No specific reason recorded; overall confidence was low.</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <PlayEditor
              key={play.id}
              play={play}
              game={game}
              acceptLabel="Accept as is (A)"
              onSave={(patch: Partial<PlayData>) => {
                void editPlay(play.id, patch);
                stay();
              }}
              onAccept={() => {
                void acceptPlay(play.id);
                stay();
              }}
              onDelete={() => {
                void deletePlay(play.id);
                stay();
              }}
              onCancel={next}
            />
            <p className="mt-2 text-xs text-slate-500">
              Delete marks this as &quot;Not a play / delete&quot; and removes it from stats. Cancel skips to the next item unchanged.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
