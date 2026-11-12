import { useId, useMemo, useState } from 'react';
import type { Down, Game, KickResult, PassResult, PlayData, PlayEvent, PlayType, Team, TeamSide } from '@/core/types';
import { otherSide } from '@/core/types';
import { PLAY_TYPES, fmtClock, playTypeLabel } from './format';

export interface PlayEditorProps {
  play: PlayEvent;
  game: Game;
  onSave: (patch: Partial<PlayData>) => void;
  onAccept?: () => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** Label for the accept button (default "Accept as is"). */
  acceptLabel?: string;
}

const PASS_RESULTS: PassResult[] = ['complete', 'incomplete', 'intercepted'];
const KICK_RESULTS: KickResult[] = [
  'good', 'no_good', 'blocked', 'touchback', 'returned', 'fair_catch', 'out_of_bounds', 'downed',
];

const KICKS: PlayType[] = ['punt', 'kickoff', 'field_goal', 'extra_point'];
const isKick = (t: PlayType) => KICKS.includes(t);

/** Which optional fields apply to a play type. */
function fieldsFor(t: PlayType) {
  return {
    situation: t !== 'kickoff',
    passer: t === 'pass' || t === 'sack' || t === 'two_point',
    rusher: t === 'rush' || t === 'kneel' || t === 'two_point',
    target: t === 'pass' || t === 'two_point',
    passResult: t === 'pass',
    interceptedBy: t === 'pass',
    kicker: isKick(t),
    kickResult: isKick(t),
    returner: t === 'punt' || t === 'kickoff',
    returnYards: t === 'punt' || t === 'kickoff',
    tacklers: t === 'rush' || t === 'pass' || t === 'sack' || t === 'punt' || t === 'kickoff',
    conversion: t === 'two_point',
    yards: t !== 'penalty_only' && t !== 'extra_point' && t !== 'two_point' && t !== 'spike',
  };
}

const parseInt0 = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const parseList = (s: string): number[] =>
  s.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

interface Form {
  offense: TeamSide;
  quarter: string;
  clock: string;
  down: string;
  distance: string;
  ballOn: string;
  type: PlayType;
  yards: string;
  passer: string;
  rusher: string;
  target: string;
  kicker: string;
  returner: string;
  returnYards: string;
  passResult: string;
  kickResult: string;
  conversionGood: string;
  tacklers: string;
  interceptedBy: string;
  touchdown: boolean;
  safety: boolean;
  firstDown: boolean;
  description: string;
}

function toForm(p: PlayData): Form {
  return {
    offense: p.offense,
    quarter: str(p.quarter),
    clock: p.clock === null ? '' : fmtClock(p.clock),
    down: str(p.down),
    distance: str(p.distance),
    ballOn: str(p.ballOn),
    type: p.type,
    yards: str(p.yards),
    passer: str(p.passer),
    rusher: str(p.rusher),
    target: str(p.target),
    kicker: str(p.kicker),
    returner: str(p.returner),
    returnYards: str(p.returnYards),
    passResult: p.passResult ?? '',
    kickResult: p.kickResult ?? '',
    conversionGood: p.conversionGood === null || p.conversionGood === undefined ? '' : String(p.conversionGood),
    tacklers: p.tacklers.join(', '),
    interceptedBy: str(p.interceptedBy),
    touchdown: p.touchdown,
    safety: p.safety,
    firstDown: p.firstDown,
    description: p.description,
  };
}

/** "m:ss" or plain seconds -> seconds. */
function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toPatch(orig: PlayData, f: Form): Partial<PlayData> {
  const patch: Record<string, unknown> = {};
  const set = <K extends keyof PlayData>(k: K, v: PlayData[K]) => {
    const o = orig[k];
    const same = Array.isArray(v) && Array.isArray(o) ? v.join(',') === o.join(',') : (o ?? null) === (v ?? null);
    if (!same) patch[k] = v;
  };
  const fl = fieldsFor(f.type);

  set('offense', f.offense);
  set('quarter', parseInt0(f.quarter) ?? orig.quarter);
  set('clock', parseClock(f.clock));
  set('type', f.type);
  set('touchdown', f.touchdown);
  set('safety', f.safety);
  set('firstDown', f.firstDown);
  set('description', f.description.trim());
  if (fl.situation) {
    const d = parseInt0(f.down);
    set('down', (d !== null && d >= 1 && d <= 4 ? d : null) as Down | null);
    set('distance', parseInt0(f.distance));
    set('ballOn', parseInt0(f.ballOn));
  }
  if (fl.yards) set('yards', parseInt0(f.yards) ?? 0);
  if (fl.passer) set('passer', parseInt0(f.passer));
  if (fl.rusher) set('rusher', parseInt0(f.rusher));
  if (fl.target) set('target', parseInt0(f.target));
  if (fl.kicker) set('kicker', parseInt0(f.kicker));
  if (fl.returner) set('returner', parseInt0(f.returner));
  if (fl.returnYards) set('returnYards', parseInt0(f.returnYards));
  if (fl.passResult) set('passResult', (f.passResult || null) as PassResult | null);
  if (fl.kickResult) set('kickResult', (f.kickResult || null) as KickResult | null);
  if (fl.conversion) set('conversionGood', f.conversionGood === '' ? null : f.conversionGood === 'true');
  if (fl.tacklers) set('tacklers', parseList(f.tacklers));
  if (fl.interceptedBy) set('interceptedBy', parseInt0(f.interceptedBy));
  return patch as Partial<PlayData>;
}

const inputCls =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'col-span-2 sm:col-span-4' : ''}`}>
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function RosterList({ id, team }: { id: string; team: Team }) {
  return (
    <datalist id={id}>
      {team.roster.map((p) => (
        <option key={p.number} value={p.number}>
          {p.number} – {p.name}
        </option>
      ))}
    </datalist>
  );
}

export function PlayEditor({ play, game, onSave, onAccept, onDelete, onCancel, acceptLabel }: PlayEditorProps) {
  const [f, setF] = useState<Form>(() => toForm(play));
  const uid = useId();
  const offId = `${uid}-off`;
  const defId = `${uid}-def`;
  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const fl = fieldsFor(f.type);
  const patch = useMemo(() => toPatch(play, f), [play, f]);
  const dirty = Object.keys(patch).length > 0;
  const kick = isKick(f.type);
  // Kick returners belong to the receiving team; tacklers on kicks are the kicking team.
  const tackleList = kick ? offId : defId;

  const jersey = (k: 'passer' | 'rusher' | 'target' | 'kicker' | 'returner' | 'interceptedBy', label: string, list: string) => (
    <Field label={label}>
      <input
        type="number"
        min={0}
        max={99}
        list={list}
        className={inputCls}
        value={f[k]}
        onChange={(e) => upd(k, e.target.value)}
      />
    </Field>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(patch);
      }}
    >
      <RosterList id={offId} team={game[f.offense]} />
      <RosterList id={defId} team={game[otherSide(f.offense)]} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Offense">
          <select className={inputCls} value={f.offense} onChange={(e) => upd('offense', e.target.value as TeamSide)}>
            <option value="home">{game.home.abbr} (home)</option>
            <option value="away">{game.away.abbr} (away)</option>
          </select>
        </Field>
        <Field label="Quarter">
          <input type="number" min={1} className={inputCls} value={f.quarter} onChange={(e) => upd('quarter', e.target.value)} />
        </Field>
        <Field label="Clock (m:ss)">
          <input className={inputCls} value={f.clock} placeholder="12:00" onChange={(e) => upd('clock', e.target.value)} />
        </Field>
        <Field label="Play type">
          <select className={inputCls} value={f.type} onChange={(e) => upd('type', e.target.value as PlayType)}>
            {PLAY_TYPES.map((t) => (
              <option key={t} value={t}>
                {playTypeLabel(t)}
              </option>
            ))}
          </select>
        </Field>

        {fl.situation && (
          <>
            <Field label="Down">
              <select className={inputCls} value={f.down} onChange={(e) => upd('down', e.target.value)}>
                <option value="">–</option>
                {[1, 2, 3, 4].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Distance">
              <input type="number" min={0} className={inputCls} value={f.distance} onChange={(e) => upd('distance', e.target.value)} />
            </Field>
            <Field label="Ball on (yds from own goal)">
              <input type="number" min={1} max={99} className={inputCls} value={f.ballOn} onChange={(e) => upd('ballOn', e.target.value)} />
            </Field>
          </>
        )}
        {fl.yards && (
          <Field label={kick ? 'Kick distance' : 'Yards'}>
            <input type="number" className={inputCls} value={f.yards} onChange={(e) => upd('yards', e.target.value)} />
          </Field>
        )}

        {fl.passer && jersey('passer', 'Passer #', offId)}
        {fl.rusher && jersey('rusher', 'Rusher #', offId)}
        {fl.target && jersey('target', 'Target #', offId)}
        {fl.passResult && (
          <Field label="Pass result">
            <select className={inputCls} value={f.passResult} onChange={(e) => upd('passResult', e.target.value)}>
              <option value="">–</option>
              {PASS_RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        )}
        {fl.interceptedBy && jersey('interceptedBy', 'Intercepted by #', defId)}
        {fl.kicker && jersey('kicker', 'Kicker #', offId)}
        {fl.kickResult && (
          <Field label="Kick result">
            <select className={inputCls} value={f.kickResult} onChange={(e) => upd('kickResult', e.target.value)}>
              <option value="">–</option>
              {KICK_RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
        )}
        {fl.returner && jersey('returner', 'Returner #', defId)}
        {fl.returnYards && (
          <Field label="Return yards">
            <input type="number" className={inputCls} value={f.returnYards} onChange={(e) => upd('returnYards', e.target.value)} />
          </Field>
        )}
        {fl.conversion && (
          <Field label="Try result">
            <select className={inputCls} value={f.conversionGood} onChange={(e) => upd('conversionGood', e.target.value)}>
              <option value="">–</option>
              <option value="true">good</option>
              <option value="false">failed</option>
            </select>
          </Field>
        )}
        {fl.tacklers && (
          <Field label="Tacklers # (comma-separated)" wide>
            <input
              className={inputCls}
              value={f.tacklers}
              placeholder="e.g. 54, 31"
              list={tackleList}
              onChange={(e) => upd('tacklers', e.target.value)}
            />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-slate-700">
        {([['touchdown', 'Touchdown'], ['safety', 'Safety'], ['firstDown', 'First down']] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={f[k]} onChange={(e) => upd(k, e.target.checked)} className="accent-emerald-600" />
            {label}
          </label>
        ))}
      </div>

      <Field label="Description" wide>
        <textarea className={inputCls} rows={2} value={f.description} onChange={(e) => upd('description', e.target.value)} />
      </Field>

      {play.flags.length > 0 && (
        <ul className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {play.flags.map((fg, i) => (
            <li key={i}>{fg}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!dirty}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save changes
        </button>
        {onAccept && (
          <button
            type="button"
            onClick={onAccept}
            className="rounded border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            {acceptLabel ?? 'Accept as is'}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            Delete play
          </button>
        )}
        <button type="button" onClick={onCancel} className="ml-auto rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
