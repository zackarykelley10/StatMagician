/**
 * Core contracts for Football Stat Maker. Every module builds on these types.
 *
 * Conventions
 * - TeamSide: 'home' | 'away'. Jersey numbers identify players within a team.
 * - ballOn: yards from the OFFENSE's own goal line, 1..99 (own 25 => 25, opponent 20 => 80).
 * - Plays are the single source of truth; game state and stats are derived from them.
 */

export type TeamSide = 'home' | 'away';

export const otherSide = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home');

export interface Player {
  number: number;
  name: string;
  position?: string;
}

export interface Team {
  name: string;
  /** Short label as shown on a scorebug, e.g. "LHS". */
  abbr: string;
  /** Jersey colour description to help the AI tell teams apart, e.g. "white with red numbers". */
  jersey?: string;
  roster: Player[];
}

export interface Game {
  id: string;
  title: string;
  createdAt: number;
  home: Team;
  away: Team;
}

export type Down = 1 | 2 | 3 | 4;

export interface GameState {
  quarter: number; // 1..4, 5+ = overtime
  /** Seconds left in the quarter, null if unknown. */
  clock: number | null;
  possession: TeamSide | null;
  down: Down | null;
  distance: number | null;
  ballOn: number | null;
  score: Record<TeamSide, number>;
}

export type PlayType =
  | 'rush'
  | 'pass'
  | 'sack'
  | 'kneel'
  | 'spike'
  | 'punt'
  | 'kickoff'
  | 'field_goal'
  | 'extra_point'
  | 'two_point'
  | 'penalty_only'; // penalty before/without a play (false start, delay of game...)

export type PassResult = 'complete' | 'incomplete' | 'intercepted';

export type KickResult =
  | 'good'
  | 'no_good'
  | 'blocked'
  | 'touchback'
  | 'returned'
  | 'fair_catch'
  | 'out_of_bounds'
  | 'downed';

export interface Penalty {
  /** Team the penalty is called on. */
  team: TeamSide;
  name: string;
  yards: number;
  player?: number | null;
  accepted: boolean;
  /** True if the down is replayed (the play's yardage does not count). */
  noPlay: boolean;
  autoFirstDown?: boolean;
}

export interface Fumble {
  fumbledBy?: number | null;
  /** Team that ends up with the ball. */
  recoveredByTeam: TeamSide;
  recoveredBy?: number | null;
}

/** Where the model got its information from. */
export type EvidenceSource = 'scorebug' | 'announcer' | 'visual';

export interface PlayConfidence {
  /** Who was involved (jersey numbers). 0..1 */
  players: number;
  /** Yardage / result. 0..1 */
  yards: number;
  /** Down, distance, spot, possession. 0..1 */
  situation: number;
}

/** The football content of a play: shared by AI output and stored plays. */
export interface PlayData {
  quarter: number;
  clock: number | null;
  /** Team with the ball at the snap (kicking team on kickoffs/punts/FGs). */
  offense: TeamSide;
  /** Pre-snap situation. Null for kickoffs / tries or if unknown. */
  down: Down | null;
  distance: number | null;
  ballOn: number | null;

  type: PlayType;
  /**
   * rush/pass/sack/kneel: net yards gained by the offense (negative for a loss).
   * punt/kickoff/field_goal: kick distance in yards. Otherwise 0.
   */
  yards: number;

  passer?: number | null;
  rusher?: number | null;
  /** Intended receiver (complete or not). */
  target?: number | null;
  kicker?: number | null;
  returner?: number | null;
  returnYards?: number | null;

  passResult?: PassResult | null;
  kickResult?: KickResult | null;
  /** two_point only: was the try successful. */
  conversionGood?: boolean | null;

  /** Defensive jersey numbers credited with the tackle (or sack). */
  tacklers: number[];
  interceptedBy?: number | null;
  fumble?: Fumble | null;

  touchdown: boolean;
  /** Team that scored on this play (TD, FG, PAT, 2pt, safety). */
  scoringTeam?: TeamSide | null;
  safety: boolean;
  /** Offense gained a first down on this play (by yardage or penalty). */
  firstDown: boolean;

  penalties: Penalty[];
  /** One-sentence human-readable summary. */
  description: string;
}

/** A play as returned by an AI provider for one clip. */
export interface ExtractedPlay extends PlayData {
  /** Seconds from the start of the clip to the snap / end of play. */
  startSec: number;
  endSec: number;
  /** False if the play is cut off by the start or end of the clip. */
  complete: boolean;
  confidence: PlayConfidence;
  evidence: EvidenceSource[];
}

export interface ExtractionResult {
  plays: ExtractedPlay[];
  /** What the scorebug showed at the end of the clip, if visible. */
  scorebug?: {
    quarter?: number | null;
    clock?: number | null;
    homeScore?: number | null;
    awayScore?: number | null;
    down?: Down | null;
    distance?: number | null;
  } | null;
}

export type PlayStatus =
  | 'accepted' // auto-accepted by the reconciler
  | 'needs_review' // low confidence, waiting in the review queue
  | 'confirmed' // a human confirmed or edited it
  | 'deleted';

/** A stored play. */
export interface PlayEvent extends PlayData {
  id: string;
  gameId: string;
  /** Order within the game (ascending). */
  seq: number;
  /** Stream time of the snap, ms since capture start. Used for dedupe and clip replay. */
  streamMs: number;
  /** Overall confidence 0..1 after reconciliation. */
  confidence: number;
  confidenceDetail: PlayConfidence;
  evidence: EvidenceSource[];
  status: PlayStatus;
  /** Human-readable reasons this play was flagged, e.g. "Jersey 47 not on home roster". */
  flags: string[];
  segmentIds: string[];
}

/** Plays that count toward state and stats. */
export const isCounted = (p: PlayEvent): boolean => p.status !== 'deleted';

/** A recorded clip of the stream. */
export interface Segment {
  id: string;
  gameId: string;
  index: number;
  /** ms since capture start. */
  startMs: number;
  endMs: number;
  blob: Blob;
  mimeType: string;
}

export interface ExtractionContext {
  home: Team;
  away: Team;
  /** Game state before this clip, as best known. */
  state: GameState;
  /** Last few stored plays, oldest first. */
  recentPlays: PlayEvent[];
}

export interface ProviderOptions {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AIProvider {
  id: ProviderId;
  label: string;
  defaultModel: string;
  extractPlays(segment: Segment, ctx: ExtractionContext, opts: ProviderOptions): Promise<ExtractionResult>;
}

export type ProviderId = 'gemini' | 'mock';

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  model: string; // '' = provider default
  /** Plays with overall confidence below this go to the review queue. */
  reviewThreshold: number;
  segmentSec: number;
  overlapSec: number;
}

// ---------- Stats output (produced by src/stats, rendered by the UI) ----------

export interface PlayerStats {
  team: TeamSide;
  number: number;
  name: string; // from roster, or "#<number>" if unknown
  passing: { att: number; comp: number; yards: number; td: number; int: number; sacked: number; sackYards: number; long: number };
  rushing: { att: number; yards: number; td: number; long: number; fumbles: number };
  receiving: { targets: number; rec: number; yards: number; td: number; long: number };
  defense: { tackles: number; sacks: number; int: number; fumbleRecoveries: number };
  kicking: { fgMade: number; fgAtt: number; fgLong: number; xpMade: number; xpAtt: number };
  punting: { punts: number; yards: number; long: number };
  returns: { kickReturns: number; kickReturnYards: number; puntReturns: number; puntReturnYards: number };
}

export interface TeamStats {
  team: TeamSide;
  points: number;
  firstDowns: number;
  totalPlays: number; // offensive plays from scrimmage (rush + pass + sack)
  totalYards: number; // net rushing + net passing
  rushAtt: number;
  rushYards: number;
  passAtt: number;
  passComp: number;
  /** Net passing yards (gross passing minus sack yards). */
  passYards: number;
  sacksAllowed: number;
  sackYardsLost: number;
  turnovers: number;
  interceptionsThrown: number;
  fumblesLost: number;
  penalties: number;
  penaltyYards: number;
  thirdDownAtt: number;
  thirdDownConv: number;
  fourthDownAtt: number;
  fourthDownConv: number;
  punts: number;
  puntYards: number;
}

export interface GameStats {
  teams: Record<TeamSide, TeamStats>;
  players: PlayerStats[];
}
