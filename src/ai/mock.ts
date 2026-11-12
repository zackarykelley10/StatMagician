import type {
  AIProvider, ExtractedPlay, ExtractionContext, ExtractionResult, Player, Segment, TeamSide,
} from '@/core/types';
import { ProviderError } from './errors';

const DELAY_MS = 400;

interface Ctx {
  off: TeamSide;
  def: TeamSide;
  /** Jersey number of the i-th roster entry for a side (fallback if no roster). */
  n: (side: TeamSide, i: number, fb: number) => number;
  quarter: number;
  clock: number;
}

type PlayInit = Partial<ExtractedPlay> & Pick<ExtractedPlay, 'type' | 'yards' | 'description'>;

const base = (c: Ctx, p: PlayInit): ExtractedPlay => ({
  startSec: 5, endSec: 12, complete: true,
  quarter: c.quarter, clock: c.clock, offense: c.off,
  down: null, distance: null, ballOn: null,
  tacklers: [], touchdown: false, safety: false, firstDown: false, penalties: [],
  confidence: { players: 0.92, yards: 0.9, situation: 0.9 },
  evidence: ['scorebug', 'announcer', 'visual'],
  ...p,
});

/** A scripted game: a kickoff, a home touchdown drive, then an away series. Cycles by segment index. */
const SCRIPT: Array<(c: Ctx) => ExtractedPlay[]> = [
  (c) => [
    base(c, {
      type: 'kickoff', offense: c.def, yards: 58, kicker: c.n(c.def, 5, 3), kickResult: 'returned',
      returner: c.n(c.off, 1, 21), returnYards: 17, tacklers: [c.n(c.off, 3, 55)],
      startSec: 4, endSec: 14, description: 'Kickoff returned to the 25.',
    }),
    base(c, {
      type: 'rush', down: 1, distance: 10, ballOn: 25, yards: 4, rusher: c.n(c.off, 2, 22),
      tacklers: [c.n(c.def, 3, 55)], startSec: 20, endSec: 26, description: 'Run up the middle for 4.',
    }),
  ],
  (c) => [
    base(c, {
      type: 'pass', down: 2, distance: 6, ballOn: 29, yards: 11, passer: c.n(c.off, 0, 7),
      target: c.n(c.off, 4, 81), passResult: 'complete', firstDown: true, tacklers: [c.n(c.def, 4, 24)],
      startSec: 3, endSec: 10, description: 'Complete over the middle for 11 and a first down.',
    }),
    base(c, {
      type: 'rush', down: 1, distance: 10, ballOn: 40, yards: 6, rusher: c.n(c.off, 2, 22),
      tacklers: [c.n(c.def, 1, 32)], startSec: 18, endSec: 25,
      confidence: { players: 0.45, yards: 0.85, situation: 0.9 },
      description: 'Run off tackle for 6 (ball carrier number hard to read).',
    }),
  ],
  (c) => [
    base(c, {
      type: 'pass', down: 2, distance: 4, ballOn: 46, yards: 0, passer: c.n(c.off, 0, 7),
      target: c.n(c.off, 5, 88), passResult: 'incomplete', startSec: 6, endSec: 11,
      description: 'Incomplete pass intended for the tight end.',
    }),
  ],
  (c) => [
    base(c, {
      // 87 is deliberately not on the roster (see mock docs): demo for the review flow.
      type: 'pass', down: 3, distance: 4, ballOn: 46, yards: 14, passer: c.n(c.off, 0, 7), target: 87,
      passResult: 'complete', firstDown: true, tacklers: [c.n(c.def, 4, 24)], startSec: 7, endSec: 14,
      confidence: { players: 0.5, yards: 0.9, situation: 0.9 },
      description: 'Complete to #87 for 14 and a first down.',
    }),
  ],
  () => [],
  (c) => [
    base(c, {
      type: 'rush', down: 1, distance: 10, ballOn: 90, yards: 10, rusher: c.n(c.off, 2, 22),
      touchdown: true, scoringTeam: c.off, startSec: 8, endSec: 15, description: 'Touchdown run from the 10.',
    }),
    base(c, {
      type: 'extra_point', yards: 20, kicker: c.n(c.off, 6, 9), kickResult: 'good',
      scoringTeam: c.off, startSec: 24, endSec: 28, description: 'Extra point is good.',
    }),
  ],
  (c) => [
    base(c, {
      type: 'kickoff', yards: 62, kicker: c.n(c.off, 6, 9), kickResult: 'touchback',
      startSec: 3, endSec: 9, description: 'Kickoff into the end zone for a touchback.',
    }),
    base(c, {
      type: 'rush', offense: c.def, down: 1, distance: 10, ballOn: 25, yards: 3, rusher: c.n(c.def, 2, 28),
      tacklers: [c.n(c.off, 3, 55)], startSec: 17, endSec: 23, description: 'Run for 3.',
    }),
  ],
  (c) => [
    base(c, {
      type: 'sack', offense: c.def, down: 2, distance: 7, ballOn: 28, yards: -7, passer: c.n(c.def, 0, 12),
      tacklers: [c.n(c.off, 1, 91)], startSec: 5, endSec: 12, description: 'Quarterback sacked for a loss of 7.',
    }),
    base(c, {
      type: 'punt', offense: c.def, down: 4, distance: 15, ballOn: 21, yards: 41, kicker: c.n(c.def, 6, 5),
      kickResult: 'fair_catch', returner: c.n(c.off, 1, 21), startSec: 20, endSec: 27,
      confidence: { players: 0.55, yards: 0.5, situation: 0.8 }, description: 'Punt of about 41 yards, fair catch.',
    }),
  ],
];

const pick = (roster: Player[], i: number, fb: number): number =>
  roster.length ? roster[i % roster.length].number : fb;

export const mockProvider: AIProvider = {
  id: 'mock',
  label: 'Mock (demo, no network)',
  defaultModel: 'mock-1',
  async extractPlays(segment: Segment, ctx: ExtractionContext, opts): Promise<ExtractionResult> {
    if (opts.signal?.aborted) throw new ProviderError('aborted', 'Aborted');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, DELAY_MS);
      opts.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new ProviderError('aborted', 'Aborted'));
        },
        { once: true },
      );
    });
    const dur = Math.max(2, (segment.endMs - segment.startMs) / 1000);
    const rosterOf = (s: TeamSide) => (s === 'home' ? ctx.home.roster : ctx.away.roster);
    const c: Ctx = {
      off: 'home',
      def: 'away',
      n: (side, i, fb) => pick(rosterOf(side), i, fb),
      quarter: Math.max(1, ctx.state.quarter),
      clock: Math.max(60, ctx.state.clock ?? 720),
    };
    const idx = ((segment.index % SCRIPT.length) + SCRIPT.length) % SCRIPT.length;
    const plays = SCRIPT[idx](c).map((p) => {
      const startSec = Math.min(p.startSec, Math.max(0, dur - 2));
      const endSec = Math.min(Math.max(p.endSec, startSec + 1), dur);
      return { ...p, startSec, endSec };
    });
    return {
      plays,
      scorebug: {
        quarter: c.quarter,
        clock: c.clock,
        homeScore: ctx.state.score.home,
        awayScore: ctx.state.score.away,
      },
    };
  },
};
