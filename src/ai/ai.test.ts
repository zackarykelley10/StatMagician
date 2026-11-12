import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionContext, Segment } from '@/core/types';
import { geminiProvider, setSleep, blobToBase64 } from './gemini';
import { mockProvider } from './mock';
import { getProvider, PROVIDERS, ProviderError } from './index';

const ctx: ExtractionContext = {
  home: { name: 'Home', abbr: 'HOM', roster: [{ number: 7, name: 'QB' }, { number: 22, name: 'RB' }, { number: 81, name: 'WR' }] },
  away: { name: 'Away', abbr: 'AWY', roster: [{ number: 12, name: 'QB' }, { number: 55, name: 'LB' }] },
  state: { quarter: 1, clock: 600, possession: 'home', down: 1, distance: 10, ballOn: 25, score: { home: 0, away: 0 } },
  recentPlays: [],
};

const seg = (size = 100, index = 0, mimeType = 'video/webm;codecs=vp9,opus'): Segment => ({
  id: 's', gameId: 'g', index, startMs: 0, endMs: 30000, blob: new Blob([new Uint8Array(size).fill(65)]), mimeType,
});

const okBody = (obj: unknown) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
});
const resp = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const play = {
  startSec: 3, endSec: 9, complete: true, quarter: 1, offense: 'home', type: 'rush', yards: 5,
  tacklers: [55], touchdown: false, safety: false, firstDown: false, penalties: [], description: 'x',
  confidence: { players: 0.9, yards: 0.9, situation: 0.9 }, evidence: ['visual'],
};

const opts = { apiKey: 'KEY123' };
let fetchMock: ReturnType<typeof vi.fn>;
let sleeps: number[];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  sleeps = [];
  setSleep(async (ms) => {
    sleeps.push(ms);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('gemini provider', () => {
  it('sends the expected request', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, okBody({ plays: [] })));
    await geminiProvider.extractPlays(seg(), ctx, opts);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/models/${geminiProvider.defaultModel}:generateContent`);
    expect(url).not.toContain('KEY123');
    expect(init.headers['x-goog-api-key']).toBe('KEY123');
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('video/webm');
    expect(parts[0].inlineData.data).toBe(btoa('A'.repeat(100)));
    expect(parts[1].text).toContain('TEAMS');
    expect(body.generationConfig.temperature).toBeLessThanOrEqual(0.3);
    const fmt = body.generationConfig.responseFormat.text;
    expect(fmt.mimeType).toBe('APPLICATION_JSON');
    expect(fmt.schema.properties.plays.type).toBe('array');
    expect(fmt.schema.properties.plays.items.properties.clock.type).toEqual(['integer', 'null']);
    expect(JSON.stringify(fmt.schema)).not.toContain('"nullable"');
  });

  it('honours a custom model', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, okBody({ plays: [] })));
    await geminiProvider.extractPlays(seg(), ctx, { ...opts, model: 'gemini-x' });
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-x:generateContent');
  });

  it('parses a successful response', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, okBody({ plays: [play] })));
    const r = await geminiProvider.extractPlays(seg(), ctx, opts);
    expect(r.plays).toHaveLength(1);
    expect(r.plays[0].type).toBe('rush');
    expect(r.plays[0].yards).toBe(5);
  });

  it('base64 encodes large blobs without overflowing the stack', async () => {
    const size = 3_000_000;
    const out = await blobToBase64(new Blob([new Uint8Array(size).fill(1)]));
    expect(out.length).toBe(Math.ceil(size / 3) * 4);
    expect(atob(out.slice(0, 8))).toBe('\u0001\u0001\u0001\u0001\u0001\u0001');
  });

  it.each([
    [401, {}, 'auth'],
    [403, {}, 'auth'],
    [400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 'auth'],
    [400, { error: { message: 'bad field', status: 'INVALID_ARGUMENT' } }, 'bad_response'],
  ])('maps status %i to %s', async (status, body, kind) => {
    fetchMock.mockResolvedValueOnce(resp(status, body));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind, status });
  });

  it('maps 429 to rate_limit after retries', async () => {
    fetchMock.mockImplementation(async () => resp(429, {}));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('retries 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(503, {}))
      .mockResolvedValueOnce(resp(429, {}))
      .mockResolvedValueOnce(resp(200, okBody({ plays: [play] })));
    const r = await geminiProvider.extractPlays(seg(), ctx, opts);
    expect(r.plays).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry 401', async () => {
    fetchMock.mockResolvedValueOnce(resp(401, {}));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps fetch failures to network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps malformed / empty / blocked responses to bad_response', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind: 'bad_response' });
    fetchMock.mockResolvedValueOnce(resp(200, { candidates: [] }));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind: 'bad_response' });
    fetchMock.mockResolvedValueOnce(resp(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(geminiProvider.extractPlays(seg(), ctx, opts)).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('throws too_large without calling fetch', async () => {
    const big = seg(1);
    Object.defineProperty(big.blob, 'size', { value: 16 * 1024 * 1024 });
    await expect(geminiProvider.extractPlays(big, ctx, opts)).rejects.toMatchObject({ kind: 'too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts before the request', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(geminiProvider.extractPlays(seg(), ctx, { ...opts, signal: ac.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an AbortError from fetch to aborted', async () => {
    const ac = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      ac.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(geminiProvider.extractPlays(seg(), ctx, { ...opts, signal: ac.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});

describe('mock provider and registry', () => {
  it('is deterministic and valid for every segment index', async () => {
    for (let i = 0; i < 8; i++) {
      const s = seg(1, i);
      const a = await mockProvider.extractPlays(s, ctx, { apiKey: '' });
      const b = await mockProvider.extractPlays(s, ctx, { apiKey: '' });
      expect(a).toEqual(b);
      expect(a.plays.length).toBeLessThanOrEqual(2);
      for (const p of a.plays) {
        expect(p.startSec).toBeGreaterThanOrEqual(0);
        expect(p.endSec).toBeGreaterThan(p.startSec);
        expect(p.endSec).toBeLessThanOrEqual(30);
      }
    }
  }, 30000);

  it('includes low-confidence plays and an off-roster jersey across the script', async () => {
    const all = [];
    for (let i = 0; i < 8; i++) all.push(...(await mockProvider.extractPlays(seg(1, i), ctx, { apiKey: '' })).plays);
    expect(all.some((p) => Math.min(p.confidence.players, p.confidence.yards, p.confidence.situation) < 0.6)).toBe(true);
    const nums = new Set([...ctx.home.roster, ...ctx.away.roster].map((p) => p.number));
    expect(all.some((p) => p.target != null && !nums.has(p.target))).toBe(true);
    expect(all.some((p) => p.rusher === 81)).toBe(true); // roster-derived jersey numbers
  });

  it('registry exposes both providers', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['gemini', 'mock']);
    expect(getProvider('mock')).toBe(mockProvider);
    expect(getProvider('gemini')).toBe(geminiProvider);
  });
});
