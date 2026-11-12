import { describe, it, expect } from 'vitest';
import { computeStats } from '@/stats';
import type { Game, PlayEvent, TeamSide, PlayerStats, Penalty } from '@/core/types';

const game: Game = {
  id: 'g1',
  title: 'Test',
  createdAt: 0,
  home: {
    name: 'Home',
    abbr: 'HOM',
    roster: [
      { number: 3, name: 'Kyle' },
      { number: 12, name: 'Ace' },
      { number: 22, name: 'Bo' },
      { number: 55, name: 'Dee' },
      { number: 56, name: 'Eli' },
      { number: 81, name: 'Cy' },
    ],
  },
  away: {
    name: 'Away',
    abbr: 'AWY',
    roster: [
      { number: 7, name: 'Gus' },
      { number: 8, name: 'Jed' },
      { number: 21, name: 'Ivy' },
      { number: 75, name: 'Kim' },
      { number: 88, name: 'Hal' },
    ],
  },
};

let seqCounter = 0;
function play(seq: number, p: Partial<PlayEvent>): PlayEvent {
  seqCounter++;
  return {
    id: `p${seq}-${seqCounter}`,
    gameId: 'g1',
    seq,
    streamMs: seq * 1000,
    confidence: 1,
    confidenceDetail: { players: 1, yards: 1, situation: 1 },
    evidence: [],
    status: 'accepted',
    flags: [],
    segmentIds: [],
    quarter: 1,
    clock: null,
    offense: 'home',
    down: null,
    distance: null,
    ballOn: null,
    type: 'rush',
    yards: 0,
    tacklers: [],
    touchdown: false,
    safety: false,
    firstDown: false,
    penalties: [],
    description: '',
    ...p,
  };
}

const pen = (team: TeamSide, yards: number, extra: Partial<Penalty> = {}): Penalty => ({
  team,
  name: 'penalty',
  yards,
  accepted: true,
  noPlay: false,
  ...extra,
});

const plays: PlayEvent[] = [
  // 1. Home rush 5, tackled by away 91 & 92
  play(1, { type: 'rush', rusher: 22, down: 1, yards: 5, tacklers: [91, 92] }),
  // 2. Home complete 12 to 81, first down, tackled by 91
  play(2, { type: 'pass', passer: 12, target: 81, passResult: 'complete', down: 2, yards: 12, firstDown: true, tacklers: [91] }),
  // 3. Home incomplete to 81
  play(3, { type: 'pass', passer: 12, target: 81, passResult: 'incomplete', down: 1 }),
  // 4. Home sack, -7, shared by 91 & 92
  play(4, { type: 'sack', passer: 12, down: 2, yards: -7, tacklers: [91, 92] }),
  // 5. Home 3rd-down completion for 15, converts
  play(5, { type: 'pass', passer: 12, target: 81, passResult: 'complete', down: 3, yards: 15, firstDown: true, tacklers: [92] }),
  // 6. Home 3rd-down rushing TD, 30 yards, converts via TD
  play(6, { type: 'rush', rusher: 22, down: 3, yards: 30, touchdown: true, scoringTeam: 'home' }),
  // 7. Home PAT good
  play(7, { type: 'extra_point', kicker: 3, kickResult: 'good' }),
  // 8. Home kickoff, returned by away 21 for 22, tackled by home 56
  play(8, { type: 'kickoff', kicker: 3, yards: 60, kickResult: 'returned', returner: 21, returnYards: 22, tacklers: [56] }),
  // 9. Away pass intercepted by home 56, tackle by away 75 (belongs to offense)
  play(9, { type: 'pass', offense: 'away', passer: 7, target: 88, passResult: 'intercepted', interceptedBy: 56, down: 1, tacklers: [75] }),
  // 10. Away 3rd-down rush 2, fumble by 21 recovered by home 55 (tackler 75 is offense)
  play(10, {
    type: 'rush', offense: 'away', rusher: 21, down: 3, yards: 2, tacklers: [75],
    fumble: { fumbledBy: 21, recoveredByTeam: 'home', recoveredBy: 55 },
  }),
  // 11. Away 4th-down completion 8, first down, tackled by home 56 & 57
  play(11, { type: 'pass', offense: 'away', passer: 7, target: 88, passResult: 'complete', down: 4, yards: 8, firstDown: true, tacklers: [56, 57] }),
  // 12. Away punt 40, returned by home 22 for 10, tackled by away 75 (kicking team). 4th down not counted.
  play(12, { type: 'punt', offense: 'away', kicker: 8, down: 4, yards: 40, kickResult: 'returned', returner: 22, returnYards: 10, tacklers: [75] }),
  // 13. Home rush wiped by accepted no-play penalty on away (5 yards), firstDown flag still counts
  play(13, {
    type: 'rush', rusher: 22, down: 3, yards: 8, firstDown: true, tacklers: [91],
    penalties: [pen('away', 5, { noPlay: true })],
  }),
  // 14. Penalty only: false start on home
  play(14, { type: 'penalty_only', penalties: [pen('home', 5)] }),
  // 15. Home rush 4 with accepted (not no-play) holding on home, 10 yards: play counts
  play(15, { type: 'rush', rusher: 22, down: 1, yards: 4, penalties: [pen('home', 10)] }),
  // 16. Home kneel -1, passer fallback, declined penalty ignored
  play(16, { type: 'kneel', passer: 12, down: 1, yards: -1, penalties: [pen('away', 15, { accepted: false })] }),
  // 17. Home spike on 3rd down (not a 3rd-down attempt)
  play(17, { type: 'spike', passer: 12, down: 3 }),
  // 18. Home FG good 38
  play(18, { type: 'field_goal', kicker: 3, yards: 38, kickResult: 'good' }),
  // 19. Home FG missed 52
  play(19, { type: 'field_goal', kicker: 3, yards: 52, kickResult: 'no_good' }),
  // 20. Deleted play: must be ignored entirely
  play(20, { type: 'rush', rusher: 22, yards: 99, touchdown: true, scoringTeam: 'home', status: 'deleted' }),
  // 21. Away TD pass 25 (down 1)
  play(21, { type: 'pass', offense: 'away', passer: 7, target: 88, passResult: 'complete', down: 1, yards: 25, touchdown: true, scoringTeam: 'away' }),
  // 22. Away 2-point conversion good
  play(22, { type: 'two_point', offense: 'away', conversionGood: true }),
];

// Shuffle input order to prove seq ordering/robustness (stats here are order-independent aside from sorting).
const shuffled = [...plays].reverse();
const stats = computeStats(game, shuffled);

function pl(team: TeamSide, number: number): PlayerStats {
  const p = stats.players.find((x) => x.team === team && x.number === number);
  if (!p) throw new Error(`no player ${team} ${number}`);
  return p;
}

describe('team stats: home', () => {
  const t = stats.teams.home;
  it('points, first downs, plays', () => {
    expect(t.points).toBe(10); // TD 6 + XP 1 + FG 3
    expect(t.firstDowns).toBe(3); // plays 2, 5 and the wiped play 13
    expect(t.totalPlays).toBe(9); // 4 rush/kneel + 3 pass + spike + sack
  });
  it('rushing and passing', () => {
    expect(t.rushAtt).toBe(4); // plays 1, 6, 15, 16(kneel)
    expect(t.rushYards).toBe(38); // 5 + 30 + 4 - 1
    expect(t.passAtt).toBe(4); // 2, 3, 5 + spike
    expect(t.passComp).toBe(2);
    expect(t.passYards).toBe(20); // 12 + 15 - 7 net
    expect(t.totalYards).toBe(58);
  });
  it('sacks, turnovers, penalties', () => {
    expect(t.sacksAllowed).toBe(1);
    expect(t.sackYardsLost).toBe(7);
    expect(t.turnovers).toBe(0);
    expect(t.interceptionsThrown).toBe(0);
    expect(t.fumblesLost).toBe(0);
    expect(t.penalties).toBe(2);
    expect(t.penaltyYards).toBe(15);
  });
  it('third/fourth down', () => {
    expect(t.thirdDownAtt).toBe(2); // 5 and 6 only
    expect(t.thirdDownConv).toBe(2);
    expect(t.fourthDownAtt).toBe(0);
    expect(t.fourthDownConv).toBe(0);
    expect(t.punts).toBe(0);
  });
});

describe('team stats: away', () => {
  const t = stats.teams.away;
  it('points, first downs, plays', () => {
    expect(t.points).toBe(8); // TD 6 + 2pt
    expect(t.firstDowns).toBe(1);
    expect(t.totalPlays).toBe(4); // 3 pass + 1 rush
  });
  it('rushing and passing', () => {
    expect(t.rushAtt).toBe(1);
    expect(t.rushYards).toBe(2);
    expect(t.passAtt).toBe(3);
    expect(t.passComp).toBe(2);
    expect(t.passYards).toBe(33);
    expect(t.totalYards).toBe(35);
  });
  it('turnovers and penalties', () => {
    expect(t.interceptionsThrown).toBe(1);
    expect(t.fumblesLost).toBe(1);
    expect(t.turnovers).toBe(2);
    expect(t.penalties).toBe(1); // wiped-play penalty still counts
    expect(t.penaltyYards).toBe(5);
    expect(t.sacksAllowed).toBe(0);
  });
  it('third/fourth down and punting', () => {
    expect(t.thirdDownAtt).toBe(1);
    expect(t.thirdDownConv).toBe(0);
    expect(t.fourthDownAtt).toBe(1);
    expect(t.fourthDownConv).toBe(1);
    expect(t.punts).toBe(1);
    expect(t.puntYards).toBe(40);
  });
});

describe('player stats', () => {
  it('home QB 12', () => {
    const p = pl('home', 12);
    expect(p.name).toBe('Ace');
    expect(p.passing).toEqual({ att: 4, comp: 2, yards: 27, td: 0, int: 0, sacked: 1, sackYards: 7, long: 15 });
    expect(p.rushing).toEqual({ att: 1, yards: -1, td: 0, long: 0, fumbles: 0 }); // kneel via passer fallback
  });
  it('home RB 22', () => {
    const p = pl('home', 22);
    expect(p.rushing).toEqual({ att: 3, yards: 39, td: 1, long: 30, fumbles: 0 });
    expect(p.returns.puntReturns).toBe(1);
    expect(p.returns.puntReturnYards).toBe(10);
  });
  it('home WR 81', () => {
    expect(pl('home', 81).receiving).toEqual({ targets: 3, rec: 2, yards: 27, td: 0, long: 15 });
  });
  it('home kicker 3', () => {
    expect(pl('home', 3).kicking).toEqual({ fgMade: 1, fgAtt: 2, fgLong: 38, xpMade: 1, xpAtt: 1 });
  });
  it('away QB 7 and WR 88', () => {
    expect(pl('away', 7).passing).toEqual({ att: 3, comp: 2, yards: 33, td: 1, int: 1, sacked: 0, sackYards: 0, long: 25 });
    expect(pl('away', 88).receiving).toEqual({ targets: 3, rec: 2, yards: 33, td: 1, long: 25 });
  });
  it('away RB 21: fumble and kick return', () => {
    const p = pl('away', 21);
    expect(p.rushing).toEqual({ att: 1, yards: 2, td: 0, long: 2, fumbles: 1 });
    expect(p.returns.kickReturns).toBe(1);
    expect(p.returns.kickReturnYards).toBe(22);
  });
  it('away punter 8', () => {
    expect(pl('away', 8).punting).toEqual({ punts: 1, yards: 40, long: 40 });
  });
  it('defensive turnovers', () => {
    expect(pl('home', 56).defense.int).toBe(1);
    expect(pl('home', 55).defense.fumbleRecoveries).toBe(1);
  });
  it('tackles: defense, offense after turnovers, kicking team', () => {
    expect(pl('away', 91).defense.tackles).toBe(3); // 1, 2, 4 (wiped play 13 excluded)
    expect(pl('away', 92).defense.tackles).toBe(3); // 1, 4, 5
    expect(pl('away', 75).defense.tackles).toBe(3); // interception, fumble recovery, punt
    expect(pl('home', 56).defense.tackles).toBe(2); // kickoff + play 11
    expect(pl('home', 57).defense.tackles).toBe(1);
  });
  it('sacks split among tacklers', () => {
    expect(pl('away', 91).defense.sacks).toBeCloseTo(0.5);
    expect(pl('away', 92).defense.sacks).toBeCloseTo(0.5);
  });
  it('names: roster or #number', () => {
    expect(pl('away', 91).name).toBe('#91');
    expect(pl('home', 57).name).toBe('#57');
    expect(pl('away', 75).name).toBe('Kim');
  });
  it('only players with nonzero stats are listed', () => {
    // Roster players with no activity (none of the fixture touches home 3's roster-mates like 99) never appear
    expect(stats.players.length).toBe(new Set(stats.players.map((x) => `${x.team}-${x.number}`)).size);
    expect(stats.players.some((x) => x.team === 'home' && x.number === 99)).toBe(false);
    // 12 players in the fixture roster minus none unused: every listed player has some nonzero stat
    for (const p of stats.players) {
      const nums = Object.values(p).flatMap((v) => (typeof v === 'object' ? Object.values(v as object) : []));
      expect(nums.some((n) => n !== 0)).toBe(true);
    }
  });
});

describe('edge cases', () => {
  it('empty input yields zeroed teams', () => {
    const s = computeStats(game, []);
    expect(s.players).toEqual([]);
    expect(s.teams.home.points).toBe(0);
    expect(s.teams.away.totalPlays).toBe(0);
  });

  it('null jerseys are skipped for players but team totals count', () => {
    const s = computeStats(game, [
      play(1, { type: 'rush', rusher: null, yards: 7 }),
      play(2, { type: 'pass', passer: null, target: null, passResult: 'complete', yards: 9 }),
    ]);
    expect(s.players).toEqual([]);
    expect(s.teams.home.rushAtt).toBe(1);
    expect(s.teams.home.rushYards).toBe(7);
    expect(s.teams.home.passComp).toBe(1);
    expect(s.teams.home.passYards).toBe(9);
    expect(s.teams.home.totalPlays).toBe(2);
  });

  it('processes in seq order, not array order', () => {
    // Order doesn't change totals, but this ensures no crash with unsorted input and no mutation.
    const input = [play(3, { type: 'rush', rusher: 22, yards: 3 }), play(1, { type: 'rush', rusher: 22, yards: 1 })];
    const copy = input.map((p) => p.seq);
    const s = computeStats(game, input);
    expect(input.map((p) => p.seq)).toEqual(copy);
    expect(s.teams.home.rushYards).toBe(4);
  });

  it('a wiped play contributes only penalty stats', () => {
    const s = computeStats(game, [
      play(1, {
        type: 'pass', passer: 12, target: 81, passResult: 'complete', yards: 20, touchdown: true,
        scoringTeam: 'home', tacklers: [91], penalties: [pen('home', 10, { noPlay: true })],
      }),
    ]);
    expect(s.teams.home.points).toBe(0);
    expect(s.teams.home.passAtt).toBe(0);
    expect(s.teams.home.totalPlays).toBe(0);
    expect(s.teams.home.penalties).toBe(1);
    expect(s.teams.home.penaltyYards).toBe(10);
    expect(s.players).toEqual([]);
  });

  it('fumble recovered by own team is not lost; punt fumble is on receiving team', () => {
    const s = computeStats(game, [
      play(1, { type: 'rush', rusher: 22, yards: 3, fumble: { fumbledBy: 22, recoveredByTeam: 'home', recoveredBy: 12 } }),
      play(2, {
        type: 'punt', offense: 'away', kicker: 8, yards: 40, returner: 22, returnYards: 5,
        fumble: { fumbledBy: 22, recoveredByTeam: 'away', recoveredBy: 75 }, tacklers: [75],
      }),
    ]);
    expect(pl2(s, 'home', 22).rushing.fumbles).toBe(2);
    expect(s.teams.home.fumblesLost).toBe(1); // only the punt fumble, lost to away
    expect(s.teams.home.turnovers).toBe(1);
    expect(pl2(s, 'away', 75).defense.fumbleRecoveries).toBe(1);
    expect(pl2(s, 'home', 12)?.defense.fumbleRecoveries ?? 0).toBe(0);
  });

  it('touchdown by defense (pick-six) is not credited as a passing/receiving TD', () => {
    const s = computeStats(game, [
      play(1, {
        type: 'pass', passer: 12, target: 81, passResult: 'intercepted', interceptedBy: 56,
        touchdown: true, scoringTeam: 'away',
      }),
    ]);
    expect(s.teams.away.points).toBe(6);
    expect(pl2(s, 'home', 12).passing.td).toBe(0);
    expect(pl2(s, 'home', 12).passing.int).toBe(1);
  });
});

function pl2(s: ReturnType<typeof computeStats>, team: TeamSide, number: number): PlayerStats {
  return s.players.find((x) => x.team === team && x.number === number) as PlayerStats;
}
