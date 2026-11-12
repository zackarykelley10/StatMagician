import { describe, expect, it } from 'vitest';
import type { Game } from '@/core/types';
import { fmtClock, fmtConfidence, fmtSituation } from './format';

const game: Game = {
  id: 'g', title: 't', createdAt: 0,
  home: { name: 'Home', abbr: 'HOM', roster: [] },
  away: { name: 'Away', abbr: 'OPP', roster: [] },
};

describe('format', () => {
  it('clock', () => {
    expect(fmtClock(125)).toBe('2:05');
    expect(fmtClock(null)).toBe('–:––');
  });
  it('confidence', () => expect(fmtConfidence(0.824)).toBe('82%'));
  it('situation', () => {
    expect(fmtSituation({ down: 2, distance: 7, ballOn: 66, offense: 'home' }, game)).toBe('2nd & 7 at OPP 34');
    expect(fmtSituation({ down: 1, distance: 4, ballOn: 96, offense: 'home' }, game)).toBe('1st & Goal at OPP 4');
    expect(fmtSituation({ down: 3, distance: 3, ballOn: 25, offense: 'home' }, game)).toBe('3rd & 3 at HOM 25');
    expect(fmtSituation({ down: 1, distance: 10, ballOn: 50, offense: 'away' }, game)).toBe('1st & 10 at 50');
  });
});
