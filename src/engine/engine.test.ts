import { describe, expect, it } from 'vitest';
import { initialGameState } from '@/core/defaults';
import type { GameState, PlayData } from '@/core/types';
import { applyPlay, replayPlays } from './index';

const play = (o: Partial<PlayData> = {}): PlayData => ({
  quarter: 1,
  clock: null,
  offense: 'home',
  down: 1,
  distance: 10,
  ballOn: 25,
  type: 'rush',
  yards: 0,
  tacklers: [],
  touchdown: false,
  safety: false,
  firstDown: false,
  penalties: [],
  description: '',
  ...o,
});

const st = (o: Partial<GameState> = {}): GameState => ({
  ...initialGameState(),
  possession: 'home',
  down: 1,
  distance: 10,
  ballOn: 25,
  ...o,
});

const pen = (o: Partial<PlayData['penalties'][number]> = {}) => ({
  team: 'home' as const,
  name: 'Holding',
  yards: 10,
  accepted: true,
  noPlay: false,
  ...o,
});

describe('quarter, clock, score', () => {
  it('uses play quarter/clock when later, keeps state quarter otherwise', () => {
    expect(applyPlay(st({ quarter: 1 }), play({ quarter: 2, clock: 600 })).quarter).toBe(2);
    expect(applyPlay(st({ quarter: 3 }), play({ quarter: 2 })).quarter).toBe(3);
  });
  it('clock falls back to state when play clock is null', () => {
    expect(applyPlay(st({ clock: 300 }), play({ clock: null })).clock).toBe(300);
    expect(applyPlay(st({ clock: 300 }), play({ clock: 280 })).clock).toBe(280);
  });
  it('adds points for scoring plays', () => {
    const s = applyPlay(st(), play({ touchdown: true, scoringTeam: 'home', yards: 75 }));
    expect(s.score).toEqual({ home: 6, away: 0 });
  });
  it('does not mutate the input', () => {
    const s = st();
    const copy = JSON.parse(JSON.stringify(s));
    applyPlay(s, play({ touchdown: true, yards: 75 }));
    expect(s).toEqual(copy);
  });
});

describe('scrimmage plays', () => {
  it('short gain advances the down', () => {
    const s = applyPlay(st(), play({ yards: 4 }));
    expect(s).toMatchObject({ possession: 'home', down: 2, distance: 6, ballOn: 29 });
  });
  it('loss increases distance', () => {
    const s = applyPlay(st(), play({ type: 'sack', yards: -7 }));
    expect(s).toMatchObject({ down: 2, distance: 17, ballOn: 18 });
  });
  it('incomplete pass keeps the spot', () => {
    const s = applyPlay(st(), play({ type: 'pass', passResult: 'incomplete' }));
    expect(s).toMatchObject({ down: 2, distance: 10, ballOn: 25 });
  });
  it('gain >= distance is a first down', () => {
    const s = applyPlay(st({ down: 3, distance: 7 }), play({ down: 3, distance: 7, yards: 9 }));
    expect(s).toMatchObject({ possession: 'home', down: 1, distance: 10, ballOn: 34 });
  });
  it('play.firstDown flag gives a first down', () => {
    const s = applyPlay(st(), play({ yards: 2, firstDown: true }));
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 27 });
  });
  it('first down near goal line is goal to go', () => {
    const s = applyPlay(st(), play({ ballOn: 80, yards: 12 }));
    expect(s).toMatchObject({ down: 1, distance: 8, ballOn: 92 });
  });
  it('turnover on downs flips possession and field', () => {
    const s = applyPlay(st(), play({ down: 4, distance: 5, ballOn: 50, yards: 2 }));
    expect(s).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: 48 });
  });
  it('kneel and spike use the same rules', () => {
    expect(applyPlay(st(), play({ type: 'kneel', yards: -1 }))).toMatchObject({ down: 2, distance: 11, ballOn: 24 });
    expect(applyPlay(st(), play({ type: 'spike' }))).toMatchObject({ down: 2, distance: 10, ballOn: 25 });
  });
  it('touchdown: scoring team keeps ball, situation nulled', () => {
    const s = applyPlay(st(), play({ type: 'pass', yards: 75, touchdown: true, scoringTeam: 'home' }));
    expect(s).toMatchObject({ possession: 'home', down: null, distance: null, ballOn: null });
  });
  it('defensive touchdown gives possession to the scoring team', () => {
    const s = applyPlay(
      st(),
      play({ type: 'pass', passResult: 'intercepted', touchdown: true, scoringTeam: 'away' }),
    );
    expect(s.possession).toBe('away');
    expect(s.score.away).toBe(6);
    expect(s.ballOn).toBeNull();
  });
  it('safety nulls everything including possession', () => {
    const s = applyPlay(st(), play({ ballOn: 3, yards: -4, safety: true, scoringTeam: 'away' }));
    expect(s).toMatchObject({ possession: null, down: null, distance: null, ballOn: null });
    expect(s.score).toEqual({ home: 0, away: 2 });
  });
  it('interception flips possession, first and 10, unknown spot', () => {
    const s = applyPlay(st(), play({ type: 'pass', passResult: 'intercepted' }));
    expect(s).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: null });
  });
  it('fumble recovered by the defense flips and mirrors the spot', () => {
    const s = applyPlay(
      st(),
      play({ ballOn: 40, yards: 3, fumble: { recoveredByTeam: 'away' } }),
    );
    expect(s).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: 57 });
  });
  it('fumble recovered by the offense is a normal play', () => {
    const s = applyPlay(st(), play({ yards: 3, fumble: { recoveredByTeam: 'home' } }));
    expect(s).toMatchObject({ possession: 'home', down: 2, distance: 7, ballOn: 28 });
  });
});

describe('penalties', () => {
  it('penalty_only on offense: back yards, replay down, distance grows', () => {
    const s = applyPlay(
      st({ down: 2, distance: 6, ballOn: 40 }),
      play({ type: 'penalty_only', down: 2, distance: 6, ballOn: 40, penalties: [pen({ yards: 5, noPlay: true })] }),
    );
    expect(s).toMatchObject({ possession: 'home', down: 2, distance: 11, ballOn: 35 });
  });
  it('offensive penalty is capped at half the distance to own goal', () => {
    const s = applyPlay(
      st(),
      play({ type: 'penalty_only', ballOn: 6, distance: 10, penalties: [pen({ yards: 10, noPlay: true })] }),
    );
    expect(s).toMatchObject({ ballOn: 3, distance: 13, down: 1 });
  });
  it('defensive penalty moves ball forward and shortens distance', () => {
    const s = applyPlay(
      st(),
      play({ type: 'penalty_only', down: 3, distance: 8, ballOn: 50, penalties: [pen({ team: 'away', yards: 5, noPlay: true })] }),
    );
    expect(s).toMatchObject({ down: 3, distance: 3, ballOn: 55 });
  });
  it('defensive penalty is capped at half the distance to the goal', () => {
    const s = applyPlay(
      st(),
      play({ type: 'penalty_only', ballOn: 94, distance: 6, down: 2, penalties: [pen({ team: 'away', yards: 15, noPlay: true })] }),
    );
    // half of 6 = 3 -> spot 97, distance 6-3 = 3
    expect(s).toMatchObject({ ballOn: 97, distance: 3, down: 2 });
  });
  it('defensive penalty covering the distance gives a first down', () => {
    const s = applyPlay(
      st(),
      play({ type: 'penalty_only', down: 3, distance: 4, ballOn: 50, penalties: [pen({ team: 'away', yards: 10, noPlay: true })] }),
    );
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 60 });
  });
  it('autoFirstDown gives first and N', () => {
    const s = applyPlay(
      st(),
      play({ type: 'penalty_only', down: 3, distance: 20, ballOn: 30, penalties: [pen({ team: 'away', yards: 5, noPlay: true, autoFirstDown: true })] }),
    );
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 35 });
  });
  it('declined penalty is ignored', () => {
    const s = applyPlay(
      st(),
      play({ yards: 4, penalties: [pen({ accepted: false, noPlay: true })] }),
    );
    expect(s).toMatchObject({ down: 2, distance: 6, ballOn: 29 });
  });
  it('accepted noPlay penalty on a real play wipes the yardage and no score', () => {
    const s = applyPlay(
      st(),
      play({ yards: 60, touchdown: true, penalties: [pen({ yards: 10, noPlay: true })] }),
    );
    expect(s.score).toEqual({ home: 0, away: 0 });
    expect(s).toMatchObject({ possession: 'home', down: 1, distance: 20, ballOn: 15 });
  });
  it('defense penalty tacked on after the play', () => {
    const s = applyPlay(
      st(),
      play({ yards: 4, penalties: [pen({ team: 'away', yards: 5 })] }),
    );
    expect(s).toMatchObject({ down: 2, distance: 1, ballOn: 34 });
  });
  it('defense penalty tacked on can produce a first down', () => {
    const s = applyPlay(
      st(),
      play({ yards: 6, penalties: [pen({ team: 'away', yards: 5 })] }),
    );
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 36 });
  });
  it('offense penalty tacked on after the play, no replay of down', () => {
    const s = applyPlay(
      st(),
      play({ yards: 5, penalties: [pen({ yards: 10 })] }),
    );
    // spot 30, back 10 -> 20, net gain -5 -> distance 15
    expect(s).toMatchObject({ down: 2, distance: 15, ballOn: 20 });
  });
  it('autoFirstDown on a tacked-on penalty', () => {
    const s = applyPlay(
      st(),
      play({ yards: 1, penalties: [pen({ team: 'away', yards: 5, autoFirstDown: true })] }),
    );
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 31 });
  });
});

describe('punts', () => {
  it('flips possession and mirrors the landing spot', () => {
    const s = applyPlay(st(), play({ type: 'punt', down: 4, distance: 8, ballOn: 30, yards: 40, kickResult: 'downed' }));
    expect(s).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: 30 });
  });
  it('return yards add to the receiving team spot', () => {
    const s = applyPlay(st(), play({ type: 'punt', ballOn: 30, yards: 40, kickResult: 'returned', returnYards: 12 }));
    expect(s.ballOn).toBe(42);
    expect(s.possession).toBe('away');
  });
  it('touchback is the 20', () => {
    const s = applyPlay(st(), play({ type: 'punt', ballOn: 50, yards: 55, kickResult: 'touchback' }));
    expect(s).toMatchObject({ possession: 'away', ballOn: 20, down: 1, distance: 10 });
  });
  it('blocked punt has unknown spot', () => {
    const s = applyPlay(st(), play({ type: 'punt', ballOn: 30, yards: 0, kickResult: 'blocked' }));
    expect(s).toMatchObject({ possession: 'away', ballOn: null, down: 1, distance: 10 });
  });
  it('clamps to 1..99', () => {
    const s = applyPlay(st(), play({ type: 'punt', ballOn: 60, yards: 45, kickResult: 'downed' }));
    expect(s.ballOn).toBe(1); // 100 - 105 -> clamp
  });
  it('unknown spot gives null ballOn', () => {
    const s = applyPlay(st({ ballOn: null }), play({ type: 'punt', ballOn: null, yards: 40, kickResult: 'downed' }));
    expect(s).toMatchObject({ possession: 'away', ballOn: null });
  });
  it('fumble recovered by kicking team keeps possession', () => {
    const s = applyPlay(
      st(),
      play({ type: 'punt', ballOn: 30, yards: 40, kickResult: 'returned', fumble: { recoveredByTeam: 'home' } }),
    );
    expect(s).toMatchObject({ possession: 'home', down: 1, distance: 10, ballOn: null });
  });
  it('punt return touchdown', () => {
    const s = applyPlay(
      st(),
      play({ type: 'punt', ballOn: 30, yards: 40, kickResult: 'returned', touchdown: true, scoringTeam: 'away' }),
    );
    expect(s).toMatchObject({ possession: 'away', down: null, ballOn: null });
    expect(s.score.away).toBe(6);
  });
});

describe('kickoffs', () => {
  it('receiving team gets the ball, first and 10, unknown spot', () => {
    const s = applyPlay(initialGameState(), play({ type: 'kickoff', down: null, distance: null, ballOn: null, yards: 55 }));
    expect(s).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: null });
  });
  it('return touchdown', () => {
    const s = applyPlay(
      initialGameState(),
      play({ type: 'kickoff', down: null, distance: null, ballOn: null, touchdown: true, scoringTeam: 'away' }),
    );
    expect(s).toMatchObject({ possession: 'away', down: null, ballOn: null });
    expect(s.score.away).toBe(6);
  });
});

describe('field goals and tries', () => {
  it('good field goal: kicking team keeps possession, nulls', () => {
    const s = applyPlay(st(), play({ type: 'field_goal', down: 4, ballOn: 80, yards: 37, kickResult: 'good' }));
    expect(s).toMatchObject({ possession: 'home', down: null, distance: null, ballOn: null });
    expect(s.score.home).toBe(3);
  });
  it('missed field goal: flips, spot is mirror of the kick spot', () => {
    const s = applyPlay(st(), play({ type: 'field_goal', down: 4, ballOn: 70, yards: 47, kickResult: 'no_good' }));
    expect(s).toMatchObject({ possession: 'away', ballOn: 30, down: 1, distance: 10 });
  });
  it('missed field goal near goal line is at least the 20', () => {
    const s = applyPlay(st(), play({ type: 'field_goal', down: 4, ballOn: 92, yards: 25, kickResult: 'no_good' }));
    expect(s.ballOn).toBe(20);
  });
  it('missed field goal with unknown spot', () => {
    const s = applyPlay(st({ ballOn: null }), play({ type: 'field_goal', ballOn: null, kickResult: 'blocked' }));
    expect(s).toMatchObject({ possession: 'away', ballOn: null, down: 1, distance: 10 });
  });
  it('extra point scores and nulls the situation', () => {
    const s = applyPlay(
      st({ possession: 'home' }),
      play({ type: 'extra_point', down: null, distance: null, ballOn: null, kickResult: 'good' }),
    );
    expect(s).toMatchObject({ possession: 'home', down: null, distance: null, ballOn: null });
    expect(s.score.home).toBe(1);
  });
  it('two point conversion', () => {
    const good = applyPlay(st(), play({ type: 'two_point', conversionGood: true }));
    const bad = applyPlay(st(), play({ type: 'two_point', conversionGood: false }));
    expect(good.score.home).toBe(2);
    expect(bad.score.home).toBe(0);
    expect(bad).toMatchObject({ possession: 'home', down: null, ballOn: null });
  });
});

describe('tolerance for unknowns', () => {
  it('falls back to state values when play values are null', () => {
    const s = applyPlay(
      st({ down: 2, distance: 5, ballOn: 40 }),
      play({ down: null, distance: null, ballOn: null, yards: 3 }),
    );
    expect(s).toMatchObject({ down: 3, distance: 2, ballOn: 43 });
  });
  it('play values win over state values', () => {
    const s = applyPlay(
      st({ down: 2, distance: 5, ballOn: 40 }),
      play({ down: 1, distance: 10, ballOn: 20, yards: 3 }),
    );
    expect(s).toMatchObject({ down: 2, distance: 7, ballOn: 23 });
  });
  it('unknown ballOn gives null spot, still advances the down', () => {
    const s = applyPlay(initialGameState(), play({ down: 1, distance: 10, ballOn: null, yards: 4 }));
    expect(s).toMatchObject({ possession: 'home', down: 2, distance: 6, ballOn: null });
  });
  it('unknown down gives null down/distance but known spot', () => {
    const s = applyPlay(initialGameState(), play({ down: null, distance: null, ballOn: 30, yards: 4 }));
    expect(s).toMatchObject({ down: null, distance: null, ballOn: 34 });
  });
  it('unknown distance but a first-down flag still resets', () => {
    const s = applyPlay(initialGameState(), play({ down: 2, distance: null, ballOn: 30, yards: 12, firstDown: true }));
    expect(s).toMatchObject({ down: 1, distance: 10, ballOn: 42 });
  });
  it('unknown down on a possible 4th down does not guess a turnover', () => {
    const s = applyPlay(initialGameState(), play({ down: null, distance: null, ballOn: 30, yards: 1 }));
    expect(s.possession).toBe('home');
  });
  it('penalty with unknown spot yields null spot and distance', () => {
    const s = applyPlay(
      initialGameState(),
      play({ type: 'penalty_only', down: 2, distance: null, ballOn: null, penalties: [pen({ yards: 5, noPlay: true })] }),
    );
    expect(s).toMatchObject({ possession: 'home', down: 2, distance: null, ballOn: null });
  });
});

describe('replayPlays', () => {
  it('returns the initial state for no plays', () => {
    expect(replayPlays([])).toEqual(initialGameState());
  });
  it('starts from a given state', () => {
    const from = st({ quarter: 2 });
    expect(replayPlays([], from)).toEqual(from);
  });

  it('plays a full drive: kickoff, runs, pass, penalty, punt-less TD, PAT, kickoff', () => {
    const plays: PlayData[] = [
      // kickoff by home, away receives
      play({ type: 'kickoff', offense: 'home', down: null, distance: null, ballOn: null, yards: 60, quarter: 1, clock: 720 }),
      // away has ball; spot learned from the next play's pre-snap data
      play({ offense: 'away', down: 1, distance: 10, ballOn: 25, yards: 5, clock: 690 }),
      // 2nd and 5 -> first down run for 6
      play({ offense: 'away', down: null, distance: null, ballOn: null, yards: 6, clock: 660 }),
      // 1st and 10 at 36: false start
      play({
        offense: 'away', type: 'penalty_only', down: null, distance: null, ballOn: null, clock: 655,
        penalties: [pen({ team: 'away', name: 'False start', yards: 5, noPlay: true })],
      }),
      // 1st and 15 at 31: incomplete pass
      play({ offense: 'away', type: 'pass', down: null, distance: null, ballOn: null, passResult: 'incomplete', yards: 0, clock: 640 }),
      // 2nd and 15 at 31: completion for 20, first down
      play({ offense: 'away', type: 'pass', down: null, distance: null, ballOn: null, passResult: 'complete', yards: 20, firstDown: true, clock: 620 }),
      // 1st and 10 at 51: long pass TD for 49
      play({
        offense: 'away', type: 'pass', down: null, distance: null, ballOn: null, passResult: 'complete', yards: 49, touchdown: true,
        scoringTeam: 'away', clock: 600,
      }),
      // PAT
      play({ offense: 'away', type: 'extra_point', down: null, distance: null, ballOn: null, kickResult: 'good', clock: 600 }),
      // kickoff by away
      play({ offense: 'away', type: 'kickoff', down: null, distance: null, ballOn: null, yards: 62, clock: 595 }),
    ];

    const afterKickoff = replayPlays(plays.slice(0, 1));
    expect(afterKickoff).toMatchObject({ possession: 'away', down: 1, distance: 10, ballOn: null, clock: 720 });

    const afterRun = replayPlays(plays.slice(0, 2));
    expect(afterRun).toMatchObject({ possession: 'away', down: 2, distance: 5, ballOn: 30 });

    const afterFirst = replayPlays(plays.slice(0, 3));
    expect(afterFirst).toMatchObject({ down: 1, distance: 10, ballOn: 36 });

    const afterFlag = replayPlays(plays.slice(0, 4));
    expect(afterFlag).toMatchObject({ down: 1, distance: 15, ballOn: 31 });

    const afterIncomplete = replayPlays(plays.slice(0, 5));
    expect(afterIncomplete).toMatchObject({ down: 2, distance: 15, ballOn: 31 });

    const afterPass = replayPlays(plays.slice(0, 6));
    expect(afterPass).toMatchObject({ down: 1, distance: 10, ballOn: 51 });

    const afterTd = replayPlays(plays.slice(0, 7));
    expect(afterTd).toMatchObject({ possession: 'away', down: null, distance: null, ballOn: null });
    expect(afterTd.score).toEqual({ home: 0, away: 6 });

    const afterPat = replayPlays(plays.slice(0, 8));
    expect(afterPat.score).toEqual({ home: 0, away: 7 });

    const end = replayPlays(plays);
    expect(end).toMatchObject({ possession: 'home', down: 1, distance: 10, ballOn: null, clock: 595, quarter: 1 });
    expect(end.score).toEqual({ home: 0, away: 7 });
  });
});
