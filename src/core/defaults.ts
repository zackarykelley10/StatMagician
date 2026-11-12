import type { GameState, PlayData, Settings, TeamSide } from './types';
import { otherSide } from './types';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  apiKey: '',
  model: '',
  reviewThreshold: 0.7,
  segmentSec: 30,
  overlapSec: 10,
};

export const initialGameState = (): GameState => ({
  quarter: 1,
  clock: null,
  possession: null,
  down: null,
  distance: null,
  ballOn: null,
  score: { home: 0, away: 0 },
});

/**
 * Points scored on a play and by whom. Shared by the game-state engine and stats so
 * the two can never disagree.
 */
export function pointsForPlay(p: PlayData): { team: TeamSide; points: number } | null {
  const penaltyWipesPlay = p.penalties.some((x) => x.accepted && x.noPlay);
  if (penaltyWipesPlay) return null;
  if (p.touchdown) return { team: p.scoringTeam ?? p.offense, points: 6 };
  if (p.safety) return { team: p.scoringTeam ?? otherSide(p.offense), points: 2 };
  if (p.type === 'field_goal' && p.kickResult === 'good') return { team: p.offense, points: 3 };
  if (p.type === 'extra_point' && p.kickResult === 'good') return { team: p.offense, points: 1 };
  if (p.type === 'two_point' && p.conversionGood) return { team: p.offense, points: 2 };
  return null;
}
