import type { Game, PlayEvent, PlayStatus } from '@/core/types';
import { fmtClock, fmtConfidence, fmtSituation, playTypeLabel } from './format';

const STATUS: Record<PlayStatus, { label: string; cls: string }> = {
  accepted: { label: 'auto', cls: 'bg-slate-100 text-slate-600' },
  needs_review: { label: 'needs review', cls: 'bg-amber-100 text-amber-800' },
  confirmed: { label: 'confirmed', cls: 'bg-emerald-100 text-emerald-800' },
  deleted: { label: 'deleted', cls: 'bg-slate-200 text-slate-500' },
};

export function confidenceClass(c: number): string {
  if (c >= 0.85) return 'bg-emerald-100 text-emerald-800';
  if (c >= 0.7) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export interface PlayRowProps {
  play: PlayEvent;
  game: Game;
  onEdit: () => void;
}

export function PlayRow({ play, game, onEdit }: PlayRowProps) {
  const deleted = play.status === 'deleted';
  const status = STATUS[play.status];
  const situation = fmtSituation(play, game);
  return (
    <div className={`flex items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm ${deleted ? 'opacity-60' : ''}`}>
      <div className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs text-slate-400">{play.seq}</div>
      <div className="w-16 shrink-0 pt-0.5 text-xs text-slate-500">
        <div>Q{play.quarter}</div>
        <div className="font-mono">{fmtClock(play.clock)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${deleted ? 'line-through' : ''}`}>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{game[play.offense].abbr}</span>
          <span className="text-xs font-medium text-slate-600">{playTypeLabel(play.type)}</span>
          {situation && <span className="text-xs text-slate-500">{situation}</span>}
          <span className="font-mono text-xs font-semibold text-slate-700">
            {play.yards > 0 ? `+${play.yards}` : play.yards} yd
          </span>
          {play.touchdown && <span className="text-xs font-bold text-emerald-700">TD</span>}
        </div>
        <p className={`mt-0.5 text-slate-800 ${deleted ? 'line-through' : ''}`}>{play.description}</p>
        {play.flags.length > 0 && (
          <ul className="mt-0.5 text-xs text-amber-700">
            {play.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClass(play.confidence)}`}>
            {fmtConfidence(play.confidence)}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${status.cls}`}>{status.label}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
