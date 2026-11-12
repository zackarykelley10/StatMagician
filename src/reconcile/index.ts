import { initialGameState } from '@/core/defaults';
import type {
  EvidenceSource,
  ExtractedPlay,
  ExtractionResult,
  Game,
  GameState,
  PlayConfidence,
  PlayData,
  PlayEvent,
  PlayStatus,
  PlayType,
  Team,
  TeamSide,
} from '@/core/types';
import { isCounted, otherSide } from '@/core/types';
import { applyPlay, replayPlays } from '@/engine';

/** Flag put on plays that were only seen partially (clip boundary). */
export const CUT_FLAG = 'Play was cut off by a clip boundary';

const TIME_WINDOW_MS = 6_000;
const CUT_WINDOW_MS = 15_000;
const SITUATION_WINDOW_MS = 12_000;

const SCRIMMAGE: PlayType[] = ['rush', 'pass', 'sack', 'kneel', 'spike'];
const isScrimmage = (t: PlayType) => SCRIMMAGE.includes(t);

const sortByTime = (plays: PlayEvent[]) =>
  plays.slice().sort((a, b) => a.streamMs - b.streamMs || a.seq - b.seq);

/** Game state implied by all counted plays, in order. */
export function currentState(plays: PlayEvent[]): GameState {
  return replayPlays(sortByTime(plays.filter(isCounted)));
}

// ---------- Confidence ----------

export interface Evaluation {
  confidence: number;
  detail: PlayConfidence;
  flags: string[];
  status: PlayStatus;
}

function onRoster(team: Team, n: number | null | undefined): boolean {
  if (n === null || n === undefined) return true;
  if (team.roster.length === 0) return true; // nothing to check against
  return team.roster.some((p) => p.number === n);
}

/** Which jersey numbers on a play belong to which side. */
function jerseysBySide(p: PlayData): Array<{ side: TeamSide; n: number; role: string }> {
  const off = p.offense;
  const def = otherSide(off);
  const out: Array<{ side: TeamSide; n: number; role: string }> = [];
  const add = (side: TeamSide, n: number | null | undefined, role: string) => {
    if (n !== null && n !== undefined) out.push({ side, n, role });
  };
  add(off, p.passer, 'passer');
  add(off, p.rusher, 'ball carrier');
  add(off, p.target, 'receiver');
  add(off, p.kicker, 'kicker');
  add(def, p.interceptedBy, 'interceptor');
  const isKick = p.type === 'punt' || p.type === 'kickoff';
  if (isKick) add(def, p.returner, 'returner');
  const possessionChanged =
    p.passResult === 'intercepted' || (p.fumble && p.fumble.recoveredByTeam !== off);
  if (!possessionChanged) {
    for (const t of p.tacklers) add(isKick ? off : def, t, 'tackler');
  }
  return out;
}

/**
 * Score a play: combine the model's own confidence with independent checks
 * (roster, continuity with the game state, internal consistency, evidence).
 */
export function evaluate(
  p: PlayData,
  raw: PlayConfidence,
  evidence: EvidenceSource[],
  complete: boolean,
  before: GameState,
  game: Game,
  threshold: number,
): Evaluation {
  const flags: string[] = [];
  let { players, yards, situation } = raw;

  // 1. Roster check
  for (const j of jerseysBySide(p)) {
    if (!onRoster(game[j.side], j.n)) {
      flags.push(`#${j.n} (${j.role}) is not on the ${game[j.side].name} roster`);
      players *= 0.5;
    }
  }

  // 2. Someone has to have the ball
  const missing =
    (p.type === 'rush' && p.rusher == null) ||
    ((p.type === 'pass' || p.type === 'sack') && p.passer == null) ||
    (p.type === 'pass' && p.passResult === 'complete' && p.target == null) ||
    ((p.type === 'punt' || p.type === 'field_goal') && p.kicker == null);
  if (missing) {
    flags.push('Key player not identified');
    players = Math.min(players, 0.4);
  }

  // 3. Continuity with the game so far
  let checked = 0;
  let agreed = 0;
  const check = (label: string, expected: number | string | null, got: number | string | null, tol = 0) => {
    if (expected === null || got === null) return;
    checked++;
    const ok =
      typeof expected === 'number' && typeof got === 'number'
        ? Math.abs(expected - got) <= tol
        : expected === got;
    if (ok) agreed++;
    else {
      flags.push(`${label}: expected ${expected}, clip shows ${got}`);
      situation *= 0.6;
    }
  };
  if (isScrimmage(p.type) || p.type === 'punt' || p.type === 'field_goal' || p.type === 'penalty_only') {
    check('Possession', before.possession, p.offense);
    if (before.possession === p.offense) {
      check('Down', before.down, p.down);
      check('Distance', before.distance, p.distance, 1);
      check('Ball position', before.ballOn, p.ballOn, 3);
    }
  }
  if (checked >= 3 && agreed === checked) situation = Math.max(situation, 0.9);
  if (isScrimmage(p.type) && (p.down === null || p.distance === null)) {
    flags.push('Down and distance not read');
    situation = Math.min(situation, 0.5);
  }

  // 4. Internal consistency
  const wiped = p.type === 'penalty_only' || p.penalties.some((x) => x.accepted && x.noPlay);
  if (!wiped && isScrimmage(p.type)) {
    const byPenalty = p.penalties.some((x) => x.accepted);
    if (p.firstDown && p.distance !== null && p.yards < p.distance && !byPenalty) {
      flags.push(`First down marked but gain (${p.yards}) is short of the distance (${p.distance})`);
      yards *= 0.6;
    }
    if (!p.firstDown && !p.touchdown && p.distance !== null && p.yards >= p.distance && !byPenalty && !p.fumble) {
      flags.push(`Gain (${p.yards}) reaches the distance (${p.distance}) but no first down marked`);
      yards *= 0.7;
    }
    if (p.touchdown && (p.scoringTeam ?? p.offense) === p.offense && p.ballOn !== null && Math.abs(p.ballOn + p.yards - 100) > 3) {
      flags.push(`Touchdown but ${p.yards} yards from the ${p.ballOn} does not reach the goal line`);
      yards *= 0.6;
    }
    if (p.type === 'pass' && !p.passResult) {
      flags.push('Pass result not determined');
      yards = Math.min(yards, 0.4);
    }
  }

  // 5. Evidence and visibility
  const sources = new Set(evidence).size;
  let factor = sources >= 2 ? 1 : sources === 1 ? 0.92 : 0.8;
  if (!complete) {
    flags.push(CUT_FLAG);
    factor *= 0.7;
  }

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const detail: PlayConfidence = { players: clamp(players), yards: clamp(yards), situation: clamp(situation) };
  const weighted = 0.4 * detail.players + 0.35 * detail.yards + 0.25 * detail.situation;
  const weakest = Math.min(detail.players, detail.yards, detail.situation);
  // One badly wrong field should not be averaged away.
  const confidence = clamp(Math.min(weighted, weakest + 0.2) * factor);

  return { confidence, detail, flags, status: confidence < threshold ? 'needs_review' : 'accepted' };
}

// ---------- De-duplication ----------

function sameSituation(a: PlayData, b: PlayData): boolean {
  return (
    a.down !== null && a.distance !== null && a.ballOn !== null &&
    a.down === b.down && a.distance === b.distance && a.ballOn === b.ballOn &&
    a.offense === b.offense && a.quarter === b.quarter
  );
}

function isDuplicate(existing: PlayEvent, cand: PlayData, candMs: number, candComplete: boolean): boolean {
  const kind = existing.type === cand.type || (isScrimmage(existing.type) && isScrimmage(cand.type));
  if (!kind) return false;
  const dt = candMs - existing.streamMs;
  if (Math.abs(dt) <= TIME_WINDOW_MS) return true;
  // A play cut off at the start of a clip is stamped with the clip start, later than the real snap.
  if (!candComplete && dt >= 0 && dt <= CUT_WINDOW_MS) return true;
  if (existing.flags.includes(CUT_FLAG) && dt <= 0 && dt >= -CUT_WINDOW_MS) return true;
  return Math.abs(dt) <= SITUATION_WINDOW_MS && sameSituation(existing, cand);
}

// ---------- Reconcile one clip's output into the play list ----------

export interface ReconcileInput {
  game: Game;
  /** All stored plays for the game (any status). */
  existing: PlayEvent[];
  segment: { id: string; startMs: number };
  result: ExtractionResult;
  threshold: number;
  newId?: () => string;
}

export interface ReconcileOutput {
  /** Full play list after merging, re-sequenced in time order. */
  plays: PlayEvent[];
  added: number;
  replaced: number;
  duplicates: number;
  warnings: string[];
}

function toPlayData(e: ExtractedPlay): PlayData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { startSec, endSec, complete, confidence, evidence, ...data } = e;
  return data;
}

export function reconcile(input: ReconcileInput): ReconcileOutput {
  const { game, segment, result, threshold } = input;
  const newId = input.newId ?? (() => crypto.randomUUID());
  let plays = sortByTime(input.existing);
  let added = 0;
  let replaced = 0;
  let duplicates = 0;

  const stateBefore = (ms: number, excludeId?: string): GameState =>
    replayPlays(plays.filter((p) => isCounted(p) && p.streamMs < ms && p.id !== excludeId));

  for (const ex of result.plays.slice().sort((a, b) => a.startSec - b.startSec)) {
    const data = toPlayData(ex);
    const streamMs = Math.round(segment.startMs + ex.startSec * 1000);
    const dup = plays.find((p) => isDuplicate(p, data, streamMs, ex.complete));

    if (dup) {
      duplicates++;
      const segmentIds = dup.segmentIds.includes(segment.id) ? dup.segmentIds : [...dup.segmentIds, segment.id];
      // Never override a human decision.
      if (dup.status === 'confirmed' || dup.status === 'deleted') {
        plays = plays.map((p) => (p.id === dup.id ? { ...p, segmentIds } : p));
        continue;
      }
      const dupCut = dup.flags.includes(CUT_FLAG);
      const ms = dupCut && ex.complete ? streamMs : dup.streamMs;
      const ev = evaluate(data, ex.confidence, ex.evidence, ex.complete, stateBefore(ms, dup.id), game, threshold);
      const better = (dupCut && ex.complete) || (ex.complete === !dupCut && ev.confidence > dup.confidence + 0.05);
      if (better) {
        replaced++;
        const merged: PlayEvent = {
          ...data, id: dup.id, gameId: dup.gameId, seq: dup.seq, streamMs: ms,
          confidence: ev.confidence, confidenceDetail: ev.detail, evidence: ex.evidence,
          status: ev.status, flags: ev.flags, segmentIds,
        };
        plays = sortByTime(plays.map((p) => (p.id === dup.id ? merged : p)));
      } else {
        plays = plays.map((p) => (p.id === dup.id ? { ...p, segmentIds } : p));
      }
      continue;
    }

    const ev = evaluate(data, ex.confidence, ex.evidence, ex.complete, stateBefore(streamMs), game, threshold);
    added++;
    plays = sortByTime([
      ...plays,
      {
        ...data, id: newId(), gameId: game.id, seq: Number.MAX_SAFE_INTEGER, streamMs,
        confidence: ev.confidence, confidenceDetail: ev.detail, evidence: ex.evidence,
        status: ev.status, flags: ev.flags, segmentIds: [segment.id],
      },
    ]);
  }

  plays = plays.map((p, i) => (p.seq === i + 1 ? p : { ...p, seq: i + 1 }));

  // Cross-check the derived score against the scorebug.
  const warnings: string[] = [];
  const sb = result.scorebug;
  if (sb && sb.homeScore != null && sb.awayScore != null) {
    const s = currentState(plays).score;
    if (s.home !== sb.homeScore || s.away !== sb.awayScore) {
      warnings.push(
        `Scorebug shows ${game.home.abbr} ${sb.homeScore} - ${game.away.abbr} ${sb.awayScore}, charted plays give ${s.home} - ${s.away}. A scoring play may be missing or wrong.`,
      );
    }
  }

  return { plays, added, replaced, duplicates, warnings };
}

/** Apply a human edit: the play becomes trusted and is never overwritten by the AI. */
export function confirmPlay(play: PlayEvent, patch: Partial<PlayData> = {}): PlayEvent {
  return {
    ...play, ...patch, status: 'confirmed', confidence: 1,
    confidenceDetail: { players: 1, yards: 1, situation: 1 }, flags: [],
  };
}

export { applyPlay, initialGameState };
