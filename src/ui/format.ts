import type { Down, Game, PlayType, TeamSide } from '@/core/types';
import { otherSide } from '@/core/types';

/** Seconds -> "m:ss"; null/invalid -> "–:––". */
export function fmtClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–:––';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function fmtConfidence(c: number): string {
  return `${Math.round(Math.min(1, Math.max(0, c)) * 100)}%`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export interface SituationLike {
  down: Down | null;
  distance: number | null;
  ballOn: number | null;
  /** PlayData */
  offense?: TeamSide | null;
  /** GameState */
  possession?: TeamSide | null;
}

/** Yard-line text: own side => "ABBR n", opponent side => "ABBR (100-n)", midfield "50". */
export function fmtYardLine(ballOn: number | null, offense: TeamSide | null | undefined, game: Game): string {
  if (ballOn === null || ballOn === undefined) return '';
  if (ballOn === 50) return '50';
  if (!offense) return ballOn > 50 ? `${100 - ballOn}` : `${ballOn}`;
  if (ballOn > 50) return `${game[otherSide(offense)].abbr} ${100 - ballOn}`;
  return `${game[offense].abbr} ${ballOn}`;
}

/** e.g. "2nd & 7 at OPP 34", "1st & Goal at OPP 4". Missing parts are omitted. */
export function fmtSituation(s: SituationLike, game: Game): string {
  const side = s.offense ?? s.possession ?? null;
  let dd = '';
  if (s.down !== null && s.down !== undefined) {
    const goal = s.ballOn !== null && s.distance !== null && s.ballOn + s.distance >= 100;
    const dist = goal ? 'Goal' : s.distance !== null ? String(s.distance) : '?';
    dd = `${ordinal(s.down)} & ${dist}`;
  }
  const spot = fmtYardLine(s.ballOn, side, game);
  if (dd && spot) return `${dd} at ${spot}`;
  return dd || (spot ? `Ball on ${spot}` : '');
}

const TYPE_LABELS: Record<PlayType, string> = {
  rush: 'Rush',
  pass: 'Pass',
  sack: 'Sack',
  kneel: 'Kneel',
  spike: 'Spike',
  punt: 'Punt',
  kickoff: 'Kickoff',
  field_goal: 'Field goal',
  extra_point: 'Extra point',
  two_point: '2-pt try',
  penalty_only: 'Penalty',
};

export const PLAY_TYPES = Object.keys(TYPE_LABELS) as PlayType[];

export function playTypeLabel(t: PlayType): string {
  return TYPE_LABELS[t] ?? t;
}
