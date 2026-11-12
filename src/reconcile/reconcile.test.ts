import { describe, expect, it } from 'vitest';
import type { ExtractedPlay, Game, PlayEvent } from '@/core/types';
import { CUT_FLAG, confirmPlay, currentState, reconcile } from './index';

const game: Game = {
  id: 'g1', title: 'Test', createdAt: 0,
  home: { name: 'Lions', abbr: 'LIO', roster: [{ number: 12, name: 'QB One' }, { number: 22, name: 'RB Two' }, { number: 80, name: 'WR Three' }] },
  away: { name: 'Bears', abbr: 'BEA', roster: [{ number: 55, name: 'LB Five' }, { number: 31, name: 'DB Six' }] },
};

const play = (over: Partial<ExtractedPlay> = {}): ExtractedPlay => ({
  startSec: 5, endSec: 10, complete: true, quarter: 1, clock: 600, offense: 'home',
  down: 1, distance: 10, ballOn: 25, type: 'rush', yards: 4, rusher: 22, tacklers: [55],
  touchdown: false, safety: false, firstDown: false, penalties: [], description: 'run for 4',
  confidence: { players: 0.9, yards: 0.9, situation: 0.9 }, evidence: ['scorebug', 'announcer'],
  ...over,
});

let n = 0;
const run = (existing: PlayEvent[], startMs: number, plays: ExtractedPlay[], id = `s${startMs}`) =>
  reconcile({ game, existing, segment: { id, startMs }, result: { plays }, threshold: 0.7, newId: () => `p${++n}` });

describe('reconcile', () => {
  it('adds a confident, consistent play as accepted', () => {
    const out = run([], 0, [play()]);
    expect(out.added).toBe(1);
    expect(out.plays[0]).toMatchObject({ status: 'accepted', seq: 1, streamMs: 5000, flags: [] });
  });

  it('merges the same play seen in an overlapping clip', () => {
    const a = run([], 0, [play({ startSec: 25, endSec: 29 })]);
    // next clip starts at 20s; same play is at 5s there (stream 25s), model is 2s off
    const b = run(a.plays, 20_000, [play({ startSec: 7, endSec: 11 })]);
    expect(b.added).toBe(0);
    expect(b.duplicates).toBe(1);
    expect(b.plays).toHaveLength(1);
    expect(b.plays[0].segmentIds).toEqual(['s0', 's20000']);
  });

  it('replaces a cut-off play with the complete view from the next clip', () => {
    const a = run([], 0, [play({ startSec: 28, endSec: 30, complete: false, yards: 0, description: 'cut' })]);
    expect(a.plays[0].flags).toContain(CUT_FLAG);
    expect(a.plays[0].status).toBe('needs_review');
    const b = run(a.plays, 20_000, [play({ startSec: 8, endSec: 14, yards: 6, description: 'run for 6' })]);
    expect(b.replaced).toBe(1);
    expect(b.plays).toHaveLength(1);
    expect(b.plays[0]).toMatchObject({ yards: 6, status: 'accepted', id: a.plays[0].id });
  });

  it('keeps consecutive plays separate and in order', () => {
    const a = run([], 0, [play()]);
    const b = run(a.plays, 20_000, [play({ startSec: 15, down: 2, distance: 6, ballOn: 29, yards: 3 })]);
    expect(b.plays.map((p) => p.seq)).toEqual([1, 2]);
    expect(b.plays[1].status).toBe('accepted');
  });

  it('flags a play that contradicts the game state', () => {
    const a = run([], 0, [play()]); // next should be 2nd & 6 at the 29
    const b = run(a.plays, 20_000, [play({ startSec: 15, down: 1, distance: 10, ballOn: 60 })]);
    const p = b.plays[1];
    expect(p.status).toBe('needs_review');
    expect(p.flags.some((f) => f.startsWith('Down'))).toBe(true);
    expect(p.flags.some((f) => f.startsWith('Ball position'))).toBe(true);
  });

  it('flags jersey numbers that are not on the roster', () => {
    const out = run([], 0, [play({ rusher: 47 })]);
    expect(out.plays[0].status).toBe('needs_review');
    expect(out.plays[0].flags[0]).toMatch(/#47/);
  });

  it('sends low model confidence to review', () => {
    const out = run([], 0, [play({ confidence: { players: 0.3, yards: 0.9, situation: 0.9 } })]);
    expect(out.plays[0].status).toBe('needs_review');
  });

  it('never overwrites a human-confirmed play', () => {
    const a = run([], 0, [play({ startSec: 25 })]);
    const confirmed = [confirmPlay(a.plays[0], { yards: 7 })];
    const b = run(confirmed, 20_000, [play({ startSec: 5, yards: 4, confidence: { players: 1, yards: 1, situation: 1 } })]);
    expect(b.plays[0]).toMatchObject({ yards: 7, status: 'confirmed' });
  });

  it('does not resurrect a deleted play', () => {
    const a = run([], 0, [play({ startSec: 25 })]);
    const deleted = [{ ...a.plays[0], status: 'deleted' as const }];
    const b = run(deleted, 20_000, [play({ startSec: 5 })]);
    expect(b.plays).toHaveLength(1);
    expect(b.plays[0].status).toBe('deleted');
  });

  it('warns when the scorebug disagrees with the charted score', () => {
    const out = reconcile({
      game, existing: [], segment: { id: 's', startMs: 0 }, threshold: 0.7,
      result: { plays: [play()], scorebug: { homeScore: 7, awayScore: 0 } },
    });
    expect(out.warnings).toHaveLength(1);
  });

  it('derives current state from counted plays', () => {
    const a = run([], 0, [play()]);
    expect(currentState(a.plays)).toMatchObject({ possession: 'home', down: 2, distance: 6, ballOn: 29 });
  });
});
