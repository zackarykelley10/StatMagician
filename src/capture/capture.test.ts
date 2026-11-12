import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/core/types';
import { Segmenter, hasAudio, pickMimeType, startTabCapture, streamFromVideoElement } from './index';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {
    super();
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  video = new FakeTrack('video');
  audio = new FakeTrack('audio');
  getTracks() {
    return [this.video, this.audio];
  }
  getAudioTracks() {
    return [this.audio];
  }
}

const recorders: FakeRecorder[] = [];

class FakeRecorder extends EventTarget {
  static isTypeSupported = (t: string) => t === 'video/webm';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'video/webm';
  constructor(
    public stream: unknown,
    public options?: unknown,
  ) {
    super();
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const ev = new Event('dataavailable') as Event & { data: Blob };
    ev.data = new Blob(['x'.repeat(100)]);
    this.dispatchEvent(ev);
    this.dispatchEvent(new Event('stop'));
  }
}

let stream: FakeStream;
let segs: Segment[];

function make(extra: Partial<ConstructorParameters<typeof Segmenter>[1]> = {}) {
  return new Segmenter(stream as unknown as MediaStream, {
    gameId: 'g1',
    segmentSec: 30,
    overlapSec: 10,
    onSegment: (s) => segs.push(s),
    ...extra,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  recorders.length = 0;
  stream = new FakeStream();
  segs = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Segmenter', () => {
  it('starts recorders every segment-overlap seconds and ends them after segmentSec', () => {
    const s = make();
    s.start();
    expect(s.running).toBe(true);
    expect(recorders).toHaveLength(1);
    vi.advanceTimersByTime(20_000);
    expect(recorders).toHaveLength(2);
    vi.advanceTimersByTime(20_000);
    expect(recorders).toHaveLength(3);
    vi.advanceTimersByTime(30_000); // t = 70s
    expect(segs.map((x) => [x.startMs, x.endMs])).toEqual([
      [0, 30_000],
      [20_000, 50_000],
      [40_000, 70_000],
    ]);
    s.stop();
  });

  it('assigns indices in start order and fills segment fields', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(70_000);
    expect(segs.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(new Set(segs.map((x) => x.id)).size).toBe(3);
    expect(segs[0].gameId).toBe('g1');
    expect(segs[0].mimeType).toBe('video/webm');
    expect(segs[0].blob.size).toBeGreaterThan(0);
    s.stop();
  });

  it('uses a fresh recorder per segment with default bitrates', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(20_000);
    expect(recorders[0]).not.toBe(recorders[1]);
    expect(recorders[0].options).toMatchObject({
      mimeType: 'video/webm',
      videoBitsPerSecond: 1_000_000,
      audioBitsPerSecond: 64_000,
    });
    s.stop();
  });

  it('stop() flushes partial segments of live recorders', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(25_000); // rec0 at 25s, rec1 at 5s
    s.stop();
    expect(s.running).toBe(false);
    expect(segs.map((x) => [x.index, x.startMs, x.endMs])).toEqual([
      [0, 0, 25_000],
      [1, 20_000, 25_000],
    ]);
    // nothing more after stop
    vi.advanceTimersByTime(120_000);
    expect(segs).toHaveLength(2);
    expect(recorders).toHaveLength(2);
  });

  it('flushes multiple overlapping partials on stop', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(45_000); // rec0 done (30), rec1 at 25s, rec2 at 5s (all valid)
    s.stop();
    const idx = segs.map((x) => x.index).sort();
    expect(idx).toEqual([0, 1, 2]);
    const r1 = segs.find((x) => x.index === 1)!;
    expect([r1.startMs, r1.endMs]).toEqual([20_000, 45_000]);
  });

  it('skips segments shorter than 2 seconds', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(21_500); // rec1 only 1.5s old
    s.stop();
    expect(segs.map((x) => x.index)).toEqual([0]);
  });

  it('skips empty blobs', () => {
    class EmptyRecorder extends FakeRecorder {
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.dispatchEvent(new Event('stop'));
      }
    }
    vi.stubGlobal('MediaRecorder', EmptyRecorder);
    const s = make();
    s.start();
    vi.advanceTimersByTime(35_000);
    s.stop();
    expect(segs).toHaveLength(0);
  });

  it('auto-stops and calls onEnded when the tracks end', () => {
    const onEnded = vi.fn();
    const s = make({ onEnded });
    s.start();
    vi.advanceTimersByTime(10_000);
    stream.video.end();
    expect(s.running).toBe(true); // audio still live
    stream.audio.end();
    expect(s.running).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(segs.map((x) => [x.index, x.endMs])).toEqual([[0, 10_000]]);
    vi.advanceTimersByTime(60_000);
    expect(recorders).toHaveLength(1);
  });

  it('measures time with an injected now()', () => {
    let t = 500;
    const s = make({ now: () => t });
    s.start();
    t += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(segs[0].startMs).toBe(0);
    expect(segs[0].endMs).toBe(30_000);
    s.stop();
  });

  it('rejects invalid overlap', () => {
    expect(() => make({ overlapSec: 30 })).toThrow();
  });
});

describe('helpers', () => {
  it('pickMimeType returns first supported type', () => {
    expect(pickMimeType()).toBe('video/webm');
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    expect(pickMimeType()).toBe('video/webm;codecs=vp9,opus');
  });

  it('hasAudio reflects live audio tracks', () => {
    expect(hasAudio(stream as unknown as MediaStream)).toBe(true);
    stream.audio.end();
    expect(hasAudio(stream as unknown as MediaStream)).toBe(false);
  });

  it('startTabCapture throws clearly when unavailable and passes hints otherwise', async () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    await expect(startTabCapture()).rejects.toThrow(/not available/);
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    await startTabCapture();
    const arg = getDisplayMedia.mock.calls[0][0];
    expect(arg.audio).toBe(true);
    expect(arg.selfBrowserSurface).toBe('exclude');
    expect(arg.preferCurrentTab).toBe(false);
    expect(arg.systemAudio).toBe('include');
    expect(arg.video.height.max).toBe(720);
  });

  it('streamFromVideoElement uses captureStream, then mozCaptureStream', () => {
    const s = {} as MediaStream;
    expect(streamFromVideoElement({ captureStream: () => s } as unknown as HTMLVideoElement)).toBe(s);
    expect(streamFromVideoElement({ mozCaptureStream: () => s } as unknown as HTMLVideoElement)).toBe(s);
    expect(() => streamFromVideoElement({} as HTMLVideoElement)).toThrow();
  });
});
