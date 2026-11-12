import { initialGameState, pointsForPlay } from '@/core/defaults';
import type { Down, GameState, Penalty, PlayData, TeamSide } from '@/core/types';
import { otherSide } from '@/core/types';

/** Situation fields of GameState that a play can change. */
interface Situation {
  possession: TeamSide | null;
  down: Down | null;
  distance: number | null;
  ballOn: number | null;
}

const clampSpot = (n: number): number => Math.min(99, Math.max(1, Math.round(n)));
const clampSpotOrNull = (n: number | null): number | null => (n === null ? null : clampSpot(n));

/** First and N: goal-to-go aware, 10 if the spot is unknown. */
function firstAnd(possession: TeamSide | null, ballOn: number | null): Situation {
  const spot = clampSpotOrNull(ballOn);
  return {
    possession,
    down: 1,
    distance: spot === null ? 10 : Math.max(1, Math.min(10, 100 - spot)),
    ballOn: spot,
  };
}

const NO_SITUATION = (possession: TeamSide | null): Situation => ({
  possession,
  down: null,
  distance: null,
  ballOn: null,
});

const isWiped = (p: PlayData): boolean =>
  p.type === 'penalty_only' || p.penalties.some((x) => x.accepted && x.noPlay);

/**
 * Move the ball for a list of accepted penalties. Returns the new spot, the net yards the
 * penalties moved the ball toward the offense's goal (negative = backward), and whether a
 * penalty carries an automatic first down. Spot is null if it was unknown.
 */
function applyPenaltyYards(
  penalties: Penalty[],
  offense: TeamSide,
  spot: number | null,
): { spot: number | null; delta: number | null; auto: boolean } {
  let cur = spot;
  let delta: number | null = spot === null ? null : 0;
  let auto = false;
  for (const pen of penalties) {
    if (pen.autoFirstDown) auto = true;
    if (cur === null || delta === null) continue;
    const yards = Math.max(0, pen.yards);
    if (pen.team === offense) {
      const moved = Math.min(yards, Math.floor(cur / 2));
      cur -= moved;
      delta -= moved;
    } else {
      const moved = Math.min(yards, Math.floor((100 - cur) / 2));
      cur += moved;
      delta += moved;
    }
  }
  return { spot: cur, delta, auto };
}

function wipedSituation(p: PlayData, down: Down | null, distance: number | null, ballOn: number | null): Situation {
  const accepted = p.penalties.filter((x) => x.accepted);
  const { spot, delta, auto } = applyPenaltyYards(accepted, p.offense, ballOn);
  const newDistance = distance === null || delta === null ? null : distance - delta;
  if (auto || (newDistance !== null && newDistance <= 0)) return firstAnd(p.offense, spot);
  return {
    possession: p.offense,
    down,
    distance: newDistance === null ? null : Math.max(1, newDistance),
    ballOn: clampSpotOrNull(spot),
  };
}

function scrimmageSituation(
  p: PlayData,
  down: Down | null,
  distance: number | null,
  ballOn: number | null,
): Situation {
  const offense = p.offense;

  if (p.touchdown) return NO_SITUATION(p.scoringTeam ?? offense);
  if (p.safety) return NO_SITUATION(null);
  if (p.passResult === 'intercepted') return firstAnd(otherSide(offense), null);

  const playSpot = ballOn === null ? null : ballOn + p.yards;
  const pens = applyPenaltyYards(
    p.penalties.filter((x) => x.accepted && !x.noPlay),
    offense,
    playSpot,
  );
  const spot = pens.spot;
  const gain = pens.delta === null ? null : p.yards + pens.delta;

  if (p.fumble && p.fumble.recoveredByTeam !== offense) {
    return firstAnd(otherSide(offense), spot === null ? null : 100 - clampSpot(spot));
  }

  const firstDown =
    p.firstDown || pens.auto || (distance !== null && gain === null ? p.yards >= distance : false) ||
    (distance !== null && gain !== null && gain >= distance);
  if (firstDown) return firstAnd(offense, spot);

  if (down === null) return { possession: offense, down: null, distance: null, ballOn: clampSpotOrNull(spot) };

  if (down === 4) return firstAnd(otherSide(offense), spot === null ? null : 100 - clampSpot(spot));

  return {
    possession: offense,
    down: (down + 1) as Down,
    distance: distance === null ? null : Math.max(1, distance - (gain ?? p.yards)),
    ballOn: clampSpotOrNull(spot),
  };
}

function puntSituation(p: PlayData, ballOn: number | null): Situation {
  const offense = p.offense;
  const receiver = otherSide(offense);
  if (p.touchdown) return NO_SITUATION(p.scoringTeam ?? receiver);
  if (p.safety) return NO_SITUATION(null);
  if (p.fumble && p.fumble.recoveredByTeam === offense) return firstAnd(offense, null);
  if (p.kickResult === 'touchback') return firstAnd(receiver, 20);
  if (p.kickResult === 'blocked' || ballOn === null) return firstAnd(receiver, null);
  return firstAnd(receiver, 100 - (ballOn + p.yards) + (p.returnYards ?? 0));
}

function kickoffSituation(p: PlayData): Situation {
  const receiver = otherSide(p.offense);
  if (p.touchdown) return NO_SITUATION(p.scoringTeam ?? receiver);
  return firstAnd(receiver, null);
}

function fieldGoalSituation(p: PlayData, ballOn: number | null): Situation {
  if (p.touchdown) return NO_SITUATION(p.scoringTeam ?? otherSide(p.offense));
  if (p.kickResult === 'good') return NO_SITUATION(p.offense);
  return firstAnd(otherSide(p.offense), ballOn === null ? null : Math.max(20, 100 - ballOn));
}

/** The state AFTER the play. Pure: never mutates its input. */
export function applyPlay(state: GameState, play: PlayData): GameState {
  const down = play.down ?? state.down;
  const distance = play.distance ?? state.distance;
  const ballOn = play.ballOn ?? state.ballOn;

  let next: Situation;
  if (isWiped(play)) {
    next = wipedSituation(play, down, distance, ballOn);
  } else {
    switch (play.type) {
      case 'rush':
      case 'pass':
      case 'sack':
      case 'kneel':
      case 'spike':
        next = scrimmageSituation(play, down, distance, ballOn);
        break;
      case 'punt':
        next = puntSituation(play, ballOn);
        break;
      case 'kickoff':
        next = kickoffSituation(play);
        break;
      case 'field_goal':
        next = fieldGoalSituation(play, ballOn);
        break;
      case 'extra_point':
      case 'two_point':
        next = NO_SITUATION(play.offense);
        break;
      default:
        next = NO_SITUATION(play.offense);
    }
  }

  const score = { ...state.score };
  const points = pointsForPlay(play);
  if (points) score[points.team] += points.points;

  return {
    quarter: play.quarter >= state.quarter ? play.quarter : state.quarter,
    clock: play.clock ?? state.clock,
    possession: next.possession,
    down: next.down,
    distance: next.distance === null ? null : Math.max(1, next.distance),
    ballOn: clampSpotOrNull(next.ballOn),
    score,
  };
}

/** Fold applyPlay over plays, starting from `from` or the initial state. */
export function replayPlays(plays: PlayData[], from?: GameState): GameState {
  return plays.reduce(applyPlay, from ?? initialGameState());
}
