import { describe, expect, it } from 'vitest';
import type { Game, GameStats, PlayEvent, PlayerStats, TeamStats } from '@/core/types';
import { formatClock, playerStatsCsv, playsCsv, slugify, teamStatsCsv, toCsv } from './csv';

const game: Game = {
  id: 'g1',
  title: 'Lions vs Tigers',
  createdAt: 0,
  home: { name: 'Lions, Varsity', abbr: 'LHS', roster: [] },
  away: { name: 'Tigers "A"', abbr: 'TAS', roster: [] },
};

function teamStats(side: 'home' | 'away', o: Partial<TeamStats> = {}): TeamStats {
  return {
    team: side,
    points: 0,
    firstDowns: 0,
    totalPlays: 0,
    totalYards: 0,
    rushAtt: 0,
    rushYards: 0,
    passAtt: 0,
    passComp: 0,
    passYards: 0,
    sacksAllowed: 0,
    sackYardsLost: 0,
    turnovers: 0,
    interceptionsThrown: 0,
    fumblesLost: 0,
    penalties: 0,
    penaltyYards: 0,
    thirdDownAtt: 0,
    thirdDownConv: 0,
    fourthDownAtt: 0,
    fourthDownConv: 0,
    punts: 0,
    puntYards: 0,
    ...o,
  };
}

function playerStats(o: Partial<PlayerStats> = {}): PlayerStats {
  return {
    team: 'home',
    number: 12,
    name: 'John Smith',
    passing: { att: 0, comp: 0, yards: 0, td: 0, int: 0, sacked: 0, sackYards: 0, long: 0 },
    rushing: { att: 0, yards: 0, td: 0, long: 0, fumbles: 0 },
    receiving: { targets: 0, rec: 0, yards: 0, td: 0, long: 0 },
    defense: { tackles: 0, sacks: 0, int: 0, fumbleRecoveries: 0 },
    kicking: { fgMade: 0, fgAtt: 0, fgLong: 0, xpMade: 0, xpAtt: 0 },
    punting: { punts: 0, yards: 0, long: 0 },
    returns: { kickReturns: 0, kickReturnYards: 0, puntReturns: 0, puntReturnYards: 0 },
    ...o,
  };
}

function play(o: Partial<PlayEvent> = {}): PlayEvent {
  return {
    id: 'p',
    gameId: 'g1',
    seq: 1,
    streamMs: 0,
    quarter: 1,
    clock: 754,
    offense: 'home',
    down: 1,
    distance: 10,
    ballOn: 25,
    type: 'rush',
    yards: 4,
    tacklers: [],
    touchdown: false,
    safety: false,
    firstDown: false,
    penalties: [],
    description: 'Rush for 4',
    confidence: 0.9,
    confidenceDetail: { players: 1, yards: 1, situation: 1 },
    evidence: ['scorebug'],
    status: 'accepted',
    flags: [],
    segmentIds: [],
    ...o,
  };
}

describe('toCsv', () => {
  it('leaves plain cells unquoted and uses CRLF line endings', () => {
    expect(toCsv([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2\r\n');
  });

  it('quotes cells containing commas, quotes, or line breaks and doubles inner quotes', () => {
    expect(toCsv([['x,y', 'say "hi"', 'line1\nline2', 'cr\rhere']])).toBe(
      '"x,y","say ""hi""","line1\nline2","cr\rhere"\r\n',
    );
  });

  it('keeps empty cells and returns an empty string for no rows', () => {
    expect(toCsv([['', 'a', '']])).toBe(',a,\r\n');
    expect(toCsv([])).toBe('');
  });
});

describe('teamStatsCsv', () => {
  it('writes header with team names and derived rows as attempts-style strings', () => {
    const stats: GameStats = {
      teams: {
        home: teamStats('home', {
          points: 14,
          passAtt: 20,
          passComp: 12,
          thirdDownAtt: 11,
          thirdDownConv: 4,
          penalties: 5,
          penaltyYards: 45,
          punts: 2,
          puntYards: 81,
        }),
        away: teamStats('away', { points: 7 }),
      },
      players: [],
    };
    const lines = teamStatsCsv(game, stats).split('\r\n');
    expect(lines[0]).toBe('Stat,"Lions, Varsity","Tigers ""A"""');
    expect(lines).toContain('Points,14,7');
    expect(lines).toContain('Completions-attempts,12-20,0-0');
    expect(lines).toContain('Third down,4-11,0-0');
    expect(lines).toContain('Penalties-yards,5-45,0-0');
    expect(lines).toContain('Punts-avg,2-40.5,0-0.0');
  });
});

describe('playerStatsCsv', () => {
  it('writes team, number, name and prefixed numeric columns, one row per player', () => {
    const stats: GameStats = {
      teams: { home: teamStats('home'), away: teamStats('away') },
      players: [
        playerStats({
          passing: { att: 20, comp: 12, yards: 180, td: 2, int: 1, sacked: 3, sackYards: 21, long: 40 },
        }),
        playerStats({ team: 'away', number: 4, name: '#4', rushing: { att: 9, yards: 50, td: 1, long: 22, fumbles: 0 } }),
      ],
    };
    // Comma-free team names so a naive split on ',' stays aligned with the columns.
    const simpleGame: Game = { ...game, home: { ...game.home, name: 'Lions' } };
    const lines = playerStatsCsv(simpleGame, stats).split('\r\n');
    const header = lines[0].split(',');
    expect(header.slice(0, 3)).toEqual(['Team', 'Number', 'Name']);
    expect(header).toContain('pass_att');
    expect(header).toContain('pass_sack_yards');
    expect(header).toContain('rush_yards');
    expect(header).toContain('ret_punt_return_yards');
    expect(lines).toHaveLength(4); // header, two players, trailing empty after final CRLF

    const passRow = lines[1].split(',');
    expect(passRow.slice(0, 3)).toEqual(['Lions', '12', 'John Smith']);
    expect(passRow[header.indexOf('pass_att')]).toBe('20');
    expect(passRow[header.indexOf('pass_yards')]).toBe('180');

    const rushRow = lines[2].split(',');
    expect(rushRow[0]).toBe('"Tigers ""A"""');
    expect(rushRow[header.indexOf('rush_att')]).toBe('9');
    expect(rushRow[header.indexOf('rush_yards')]).toBe('50');
  });
});

describe('playsCsv', () => {
  it('writes play-by-play in seq order, excludes deleted plays, and formats clock and team', () => {
    const plays = [
      play({ id: 'b', seq: 2, offense: 'away', clock: 61, down: null, distance: null, ballOn: null, type: 'kickoff', yards: 60, description: 'Kick, deep', status: 'confirmed', confidence: 0.5 }),
      play({ id: 'x', seq: 1, status: 'deleted' }),
      play({ id: 'a', seq: 0, description: 'Says "go"' }),
    ];
    const lines = playsCsv(game, plays).split('\r\n');
    expect(lines[0]).toBe('seq,quarter,clock,offense,down,distance,ballOn,type,yards,description,confidence,status');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('0,1,12:34,"Lions, Varsity",1,10,25,rush,4,"Says ""go""",0.90,accepted');
    expect(lines[2]).toBe('2,1,1:01,"Tigers ""A""",,,,kickoff,60,"Kick, deep",0.50,confirmed');
  });
});

describe('helpers', () => {
  it('formats clock as M:SS and blanks unknown clocks', () => {
    expect(formatClock(null)).toBe('');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
  });

  it('slugifies titles for filenames', () => {
    expect(slugify('Lions vs Tigers!')).toBe('lions-vs-tigers');
    expect(slugify('  ¡Olé!  ')).toBe('ole');
    expect(slugify('!!!')).toBe('game');
  });
});
