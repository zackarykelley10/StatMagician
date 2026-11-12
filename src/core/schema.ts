import type { Down, ExtractedPlay, ExtractionResult, Penalty, PlayType, TeamSide } from './types';

/**
 * JSON schema for ExtractionResult, restricted to the OpenAPI subset that
 * structured-output APIs accept (type / properties / items / enum / required / nullable).
 */
const int = { type: 'integer' } as const;
const nInt = { type: 'integer', nullable: true } as const;
const num = { type: 'number' } as const;
const bool = { type: 'boolean' } as const;
const side = { type: 'string', enum: ['home', 'away'] } as const;

export const PLAY_TYPES: PlayType[] = [
  'rush', 'pass', 'sack', 'kneel', 'spike', 'punt', 'kickoff',
  'field_goal', 'extra_point', 'two_point', 'penalty_only',
];
const PASS_RESULTS = ['complete', 'incomplete', 'intercepted'] as const;
const KICK_RESULTS = [
  'good', 'no_good', 'blocked', 'touchback', 'returned', 'fair_catch', 'out_of_bounds', 'downed',
] as const;
const EVIDENCE = ['scorebug', 'announcer', 'visual'] as const;

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    plays: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: num,
          endSec: num,
          complete: bool,
          quarter: int,
          clock: nInt,
          offense: side,
          down: nInt,
          distance: nInt,
          ballOn: nInt,
          type: { type: 'string', enum: PLAY_TYPES },
          yards: int,
          passer: nInt,
          rusher: nInt,
          target: nInt,
          kicker: nInt,
          returner: nInt,
          returnYards: nInt,
          passResult: { type: 'string', enum: PASS_RESULTS, nullable: true },
          kickResult: { type: 'string', enum: KICK_RESULTS, nullable: true },
          conversionGood: { type: 'boolean', nullable: true },
          tacklers: { type: 'array', items: int },
          interceptedBy: nInt,
          fumble: {
            type: 'object',
            nullable: true,
            properties: { fumbledBy: nInt, recoveredByTeam: side, recoveredBy: nInt },
            required: ['recoveredByTeam'],
          },
          touchdown: bool,
          scoringTeam: { ...side, nullable: true },
          safety: bool,
          firstDown: bool,
          penalties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                team: side,
                name: { type: 'string' },
                yards: int,
                player: nInt,
                accepted: bool,
                noPlay: bool,
                autoFirstDown: bool,
              },
              required: ['team', 'name', 'yards', 'accepted', 'noPlay'],
            },
          },
          description: { type: 'string' },
          confidence: {
            type: 'object',
            properties: { players: num, yards: num, situation: num },
            required: ['players', 'yards', 'situation'],
          },
          evidence: { type: 'array', items: { type: 'string', enum: EVIDENCE } },
        },
        required: [
          'startSec', 'endSec', 'complete', 'quarter', 'offense', 'type', 'yards',
          'tacklers', 'touchdown', 'safety', 'firstDown', 'penalties', 'description',
          'confidence', 'evidence',
        ],
      },
    },
    scorebug: {
      type: 'object',
      nullable: true,
      properties: {
        quarter: nInt, clock: nInt, homeScore: nInt, awayScore: nInt, down: nInt, distance: nInt,
      },
    },
  },
  required: ['plays'],
} as const;

// ---------- Lenient normaliser: never trust model output ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const toNum = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const toInt = (v: unknown, d = 0): number => Math.round(toNum(v, d));
const toNInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const toSide = (v: unknown, d: TeamSide = 'home'): TeamSide => (v === 'away' ? 'away' : v === 'home' ? 'home' : d);
const toNSide = (v: unknown): TeamSide | null => (v === 'home' || v === 'away' ? v : null);
const clamp01 = (v: unknown, d = 0.5): number => Math.min(1, Math.max(0, toNum(v, d)));
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | null =>
  typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : null;
const toDown = (v: unknown): Down | null => {
  const n = toNInt(v);
  return n !== null && n >= 1 && n <= 4 ? (n as Down) : null;
};
const toJersey = (v: unknown): number | null => {
  const n = toNInt(v);
  return n !== null && n >= 0 && n <= 99 ? n : null;
};

function normPenalty(v: unknown): Penalty | null {
  if (!isObj(v)) return null;
  return {
    team: toSide(v.team),
    name: typeof v.name === 'string' ? v.name : 'Penalty',
    yards: Math.abs(toInt(v.yards)),
    player: toJersey(v.player),
    accepted: v.accepted !== false,
    noPlay: v.noPlay === true,
    autoFirstDown: v.autoFirstDown === true,
  };
}

function normPlay(v: unknown): ExtractedPlay | null {
  if (!isObj(v)) return null;
  const type = oneOf(v.type, PLAY_TYPES);
  if (!type) return null;
  const conf = isObj(v.confidence) ? v.confidence : {};
  const fum = isObj(v.fumble) ? v.fumble : null;
  const ballOn = toNInt(v.ballOn);
  return {
    startSec: Math.max(0, toNum(v.startSec)),
    endSec: Math.max(0, toNum(v.endSec)),
    complete: v.complete !== false,
    quarter: Math.max(1, toInt(v.quarter, 1)),
    clock: toNInt(v.clock),
    offense: toSide(v.offense),
    down: toDown(v.down),
    distance: toNInt(v.distance),
    ballOn: ballOn !== null && ballOn >= 1 && ballOn <= 99 ? ballOn : null,
    type,
    yards: toInt(v.yards),
    passer: toJersey(v.passer),
    rusher: toJersey(v.rusher),
    target: toJersey(v.target),
    kicker: toJersey(v.kicker),
    returner: toJersey(v.returner),
    returnYards: toNInt(v.returnYards),
    passResult: oneOf(v.passResult, PASS_RESULTS),
    kickResult: oneOf(v.kickResult, KICK_RESULTS),
    conversionGood: typeof v.conversionGood === 'boolean' ? v.conversionGood : null,
    tacklers: Array.isArray(v.tacklers)
      ? v.tacklers.map(toJersey).filter((n): n is number => n !== null)
      : [],
    interceptedBy: toJersey(v.interceptedBy),
    fumble: fum
      ? {
          fumbledBy: toJersey(fum.fumbledBy),
          recoveredByTeam: toSide(fum.recoveredByTeam, toSide(v.offense)),
          recoveredBy: toJersey(fum.recoveredBy),
        }
      : null,
    touchdown: v.touchdown === true,
    scoringTeam: toNSide(v.scoringTeam),
    safety: v.safety === true,
    firstDown: v.firstDown === true,
    penalties: Array.isArray(v.penalties)
      ? v.penalties.map(normPenalty).filter((p): p is Penalty => p !== null)
      : [],
    description: typeof v.description === 'string' ? v.description : '',
    confidence: {
      players: clamp01(conf.players),
      yards: clamp01(conf.yards),
      situation: clamp01(conf.situation),
    },
    evidence: Array.isArray(v.evidence)
      ? v.evidence.map((e) => oneOf(e, EVIDENCE)).filter((e): e is (typeof EVIDENCE)[number] => e !== null)
      : [],
  };
}

/** Turn arbitrary parsed JSON into a safe ExtractionResult. Invalid plays are dropped. */
export function parseExtractionResult(json: unknown): ExtractionResult {
  if (!isObj(json)) return { plays: [] };
  const plays = Array.isArray(json.plays)
    ? json.plays.map(normPlay).filter((p): p is ExtractedPlay => p !== null)
    : [];
  plays.sort((a, b) => a.startSec - b.startSec);
  const sb = isObj(json.scorebug) ? json.scorebug : null;
  return {
    plays,
    scorebug: sb
      ? {
          quarter: toNInt(sb.quarter),
          clock: toNInt(sb.clock),
          homeScore: toNInt(sb.homeScore),
          awayScore: toNInt(sb.awayScore),
          down: toDown(sb.down),
          distance: toNInt(sb.distance),
        }
      : null,
  };
}
