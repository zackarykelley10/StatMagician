import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayEvent, Segment, Settings, Team } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import {
  createGame,
  db,
  deleteGame,
  deletePlaysForGame,
  getGame,
  getSegment,
  listGames,
  listPlays,
  loadSettings,
  pruneSegments,
  putPlay,
  putPlays,
  saveSegment,
  saveSettings,
  updateGame,
} from './index';

const home: Team = {
  name: 'Home Hawks',
  abbr: 'HHK',
  jersey: 'white with red numbers',
  roster: [{ number: 12, name: 'Alex' }],
};
const away: Team = {
  name: 'Away Owls',
  abbr: 'AOW',
  roster: [{ number: 47, name: 'Sam', position: 'LB' }],
};

function makePlay(gameId: string, seq: number, id = `${gameId}-p${seq}`): PlayEvent {
  return {
    id,
    gameId,
    seq,
    streamMs: seq * 1000,
    quarter: 1,
    clock: 900,
    offense: 'home',
    down: 1,
    distance: 10,
    ballOn: 25,
    type: 'rush',
    yards: 4,
    rusher: 12,
    tacklers: [47],
    touchdown: false,
    scoringTeam: null,
    safety: false,
    firstDown: false,
    penalties: [],
    description: `Play ${seq}`,
    confidence: 0.9,
    confidenceDetail: { players: 0.9, yards: 0.9, situation: 0.9 },
    evidence: ['scorebug'],
    status: 'accepted',
    flags: [],
    segmentIds: [],
  };
}

function makeSegment(gameId: string, index: number, id = `${gameId}-s${index}`): Segment {
  return {
    id,
    gameId,
    index,
    startMs: index * 30000,
    endMs: (index + 1) * 30000,
    blob: new Blob([`segment-${index}`], { type: 'video/webm' }),
    mimeType: 'video/webm',
  };
}

// The jsdom environment used here does not always expose localStorage; provide an
// in-memory stand-in so the settings tests exercise the real code path.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    vi.stubGlobal('localStorage', memoryStorage());
  }
});

beforeEach(async () => {
  await db.transaction('rw', db.games, db.plays, db.segments, async () => {
    await db.games.clear();
    await db.plays.clear();
    await db.segments.clear();
  });
  localStorage.clear();
});

describe('games', () => {
  it('createGame assigns id and createdAt and persists the game', async () => {
    const before = Date.now();
    const game = await createGame({ title: 'Week 1', home, away });
    expect(game.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(game.title).toBe('Week 1');
    expect(game.createdAt).toBeGreaterThanOrEqual(before);
    expect(game.createdAt).toBeLessThanOrEqual(Date.now());
    expect(game.home).toEqual(home);
    expect(game.away).toEqual(away);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('createGame produces unique ids', async () => {
    const a = await createGame({ title: 'A', home, away });
    const b = await createGame({ title: 'B', home, away });
    expect(a.id).not.toBe(b.id);
  });

  it('getGame returns undefined for an unknown id', async () => {
    expect(await getGame('nope')).toBeUndefined();
  });

  it('listGames returns newest first', async () => {
    const first = await createGame({ title: 'first', home, away });
    await db.games.update(first.id, { createdAt: 1000 });
    const second = await createGame({ title: 'second', home, away });
    await db.games.update(second.id, { createdAt: 2000 });
    const third = await createGame({ title: 'third', home, away });
    await db.games.update(third.id, { createdAt: 1500 });

    const games = await listGames();
    expect(games.map((g) => g.title)).toEqual(['second', 'third', 'first']);
  });

  it('updateGame overwrites the stored game', async () => {
    const game = await createGame({ title: 'Old', home, away });
    await updateGame({ ...game, title: 'New' });
    expect((await getGame(game.id))?.title).toBe('New');
  });

  it('deleteGame removes the game with its plays and segments only', async () => {
    const target = await createGame({ title: 'target', home, away });
    const other = await createGame({ title: 'other', home, away });
    await putPlays([makePlay(target.id, 1), makePlay(target.id, 2)]);
    await putPlay(makePlay(other.id, 1));
    await saveSegment(makeSegment(target.id, 0));
    await saveSegment(makeSegment(other.id, 0));

    await deleteGame(target.id);

    expect(await getGame(target.id)).toBeUndefined();
    expect(await listPlays(target.id)).toEqual([]);
    expect(await db.segments.where('gameId').equals(target.id).count()).toBe(0);
    expect(await getGame(other.id)).toBeDefined();
    expect(await listPlays(other.id)).toHaveLength(1);
    expect(await db.segments.where('gameId').equals(other.id).count()).toBe(1);
  });
});

describe('plays', () => {
  it('putPlay stores a single play', async () => {
    const play = makePlay('g1', 1);
    await putPlay(play);
    expect(await listPlays('g1')).toEqual([play]);
  });

  it('putPlay overwrites an existing play with the same id', async () => {
    await putPlay(makePlay('g1', 1));
    await putPlay({ ...makePlay('g1', 1), yards: 9 });
    const plays = await listPlays('g1');
    expect(plays).toHaveLength(1);
    expect(plays[0].yards).toBe(9);
  });

  it('putPlays stores many plays', async () => {
    await putPlays([makePlay('g1', 1), makePlay('g1', 2), makePlay('g1', 3)]);
    expect(await listPlays('g1')).toHaveLength(3);
  });

  it('listPlays returns only the requested game, sorted by seq ascending', async () => {
    await putPlays([makePlay('g1', 3), makePlay('g1', 1), makePlay('g2', 2), makePlay('g1', 2)]);
    const plays = await listPlays('g1');
    expect(plays.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(plays.every((p) => p.gameId === 'g1')).toBe(true);
  });

  it('listPlays returns an empty array when there are none', async () => {
    expect(await listPlays('missing')).toEqual([]);
  });

  it('deletePlaysForGame removes only that game plays', async () => {
    await putPlays([makePlay('g1', 1), makePlay('g1', 2), makePlay('g2', 1)]);
    await deletePlaysForGame('g1');
    expect(await listPlays('g1')).toEqual([]);
    expect(await listPlays('g2')).toHaveLength(1);
  });
});

describe('segments', () => {
  it('saveSegment and getSegment round-trip the metadata', async () => {
    const seg = makeSegment('g1', 0);
    await saveSegment(seg);
    const loaded = await getSegment(seg.id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(seg.id);
    expect(loaded?.gameId).toBe('g1');
    expect(loaded?.index).toBe(0);
    expect(loaded?.startMs).toBe(seg.startMs);
    expect(loaded?.endMs).toBe(seg.endMs);
    expect(loaded?.mimeType).toBe('video/webm');
  });

  it('getSegment returns undefined for an unknown id', async () => {
    expect(await getSegment('nope')).toBeUndefined();
  });

  it('stored segment keeps a blob slot (content check skipped, see note)', async () => {
    // NOTE: under fake-indexeddb + jsdom, a Blob is not preserved by structured clone:
    // the value read back is a plain object, not a Blob, so blob size/type/text cannot be
    // asserted here. Real browsers store Blobs natively. Only presence is checked.
    const seg = makeSegment('g1', 0);
    await saveSegment(seg);
    const loaded = await getSegment(seg.id);
    expect(loaded?.blob).toBeDefined();
  });

  it('pruneSegments deletes only this game segments not in keepIds', async () => {
    await saveSegment(makeSegment('g1', 0));
    await saveSegment(makeSegment('g1', 1));
    await saveSegment(makeSegment('g1', 2));
    await saveSegment(makeSegment('g2', 0));

    await pruneSegments('g1', ['g1-s1']);

    expect(await getSegment('g1-s0')).toBeUndefined();
    expect(await getSegment('g1-s1')).toBeDefined();
    expect(await getSegment('g1-s2')).toBeUndefined();
    expect(await getSegment('g2-s0')).toBeDefined();
  });

  it('pruneSegments with an empty keep list deletes all of the game segments', async () => {
    await saveSegment(makeSegment('g1', 0));
    await saveSegment(makeSegment('g2', 0));
    await pruneSegments('g1', []);
    expect(await getSegment('g1-s0')).toBeUndefined();
    expect(await getSegment('g2-s0')).toBeDefined();
  });
});

describe('settings', () => {
  const custom: Settings = {
    provider: 'mock',
    apiKey: 'test-key',
    model: 'some-model',
    reviewThreshold: 0.5,
    segmentSec: 60,
    overlapSec: 5,
  };

  it('loadSettings returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings then loadSettings round-trips', () => {
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it('saveSettings writes under the fsm-settings key', () => {
    saveSettings(custom);
    expect(JSON.parse(localStorage.getItem('fsm-settings') ?? 'null')).toEqual(custom);
  });

  it('loadSettings merges partial stored data with defaults', () => {
    localStorage.setItem('fsm-settings', JSON.stringify({ apiKey: 'abc' }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, apiKey: 'abc' });
  });

  it('loadSettings tolerates corrupt JSON', () => {
    localStorage.setItem('fsm-settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('loadSettings tolerates non-object JSON', () => {
    localStorage.setItem('fsm-settings', '"hello"');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('fsm-settings', 'null');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
