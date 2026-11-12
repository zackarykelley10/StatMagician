import type { Segment } from '@/core/types';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** First MediaRecorder-supported container/codec combination. */
export function pickMimeType(): string {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (MR && typeof MR.isTypeSupported === 'function') {
    for (const t of MIME_CANDIDATES) {
      if (MR.isTypeSupported(t)) return t;
    }
  }
  return 'video/webm';
}

/** Capture a browser tab (video + tab audio if the user ticks "share tab audio"). */
export async function startTabCapture(): Promise<MediaStream> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md || typeof md.getDisplayMedia !== 'function') {
    throw new Error(
      'Screen/tab capture is not available in this browser. Use a desktop Chrome or Edge over HTTPS (or localhost), or load a local video file instead.',
    );
  }
  const constraints = {
    video: { frameRate: { ideal: 15, max: 15 }, height: { max: 720 } },
    audio: true,
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include',
  } as unknown as DisplayMediaStreamOptions;
  return md.getDisplayMedia(constraints);
}

/** True if the stream has at least one live audio track. */
export function hasAudio(stream: MediaStream): boolean {
  return stream.getAudioTracks().some((t) => t.readyState !== 'ended');
}

/** Stream from a playing <video> element (local-file path). */
export function streamFromVideoElement(video: HTMLVideoElement): MediaStream {
  const v = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  if (typeof v.captureStream === 'function') return v.captureStream();
  if (typeof v.mozCaptureStream === 'function') return v.mozCaptureStream();
  throw new Error('This browser cannot capture a video element (captureStream is unsupported).');
}

export interface SegmenterOptions {
  gameId: string;
  segmentSec: number;
  overlapSec: number;
  onSegment: (s: Segment) => void;
  /** Called once when the stream's tracks end and the segmenter auto-stops. */
  onEnded?: () => void;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  now?: () => number;
}

const MIN_SEGMENT_MS = 2000;

interface Live {
  recorder: MediaRecorder;
  index: number;
  startMs: number;
  stopMs: number | null;
  chunks: Blob[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Cuts a stream into overlapping standalone clips. A fresh MediaRecorder is started every
 * (segmentSec - overlapSec) seconds and stopped segmentSec after it started.
 */
export class Segmenter {
  private readonly stream: MediaStream;
  private readonly opts: SegmenterOptions;
  private readonly now: () => number;
  private readonly mimeType: string;
  private live = new Set<Live>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  private nextIndex = 0;
  private _running = false;
  private trackCleanups: Array<() => void> = [];

  constructor(stream: MediaStream, opts: SegmenterOptions) {
    if (!(opts.segmentSec > 0)) throw new Error('segmentSec must be > 0');
    if (opts.overlapSec < 0 || opts.overlapSec >= opts.segmentSec) {
      throw new Error('overlapSec must be >= 0 and less than segmentSec');
    }
    this.stream = stream;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.mimeType = pickMimeType();
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.t0 = this.now();
    this.nextIndex = 0;

    const onTrackEnded = () => {
      const tracks = this.stream.getTracks();
      if (tracks.every((t) => t.readyState === 'ended')) {
        if (!this._running) return;
        this.stop();
        this.opts.onEnded?.();
      }
    };
    for (const track of this.stream.getTracks()) {
      track.addEventListener('ended', onTrackEnded);
      this.trackCleanups.push(() => track.removeEventListener('ended', onTrackEnded));
    }

    this.launch();
    const stepMs = (this.opts.segmentSec - this.opts.overlapSec) * 1000;
    this.interval = setInterval(() => this.launch(), stepMs);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    for (const c of this.trackCleanups) c();
    this.trackCleanups = [];
    for (const l of [...this.live]) this.stopLive(l);
  }

  private launch(): void {
    const startMs = this.now() - this.t0;
    const index = this.nextIndex++;
    const recorderOpts: MediaRecorderOptions = {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond ?? 1_000_000,
      audioBitsPerSecond: this.opts.audioBitsPerSecond ?? 64_000,
    };
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, recorderOpts);
    } catch {
      // Unsupported option combo: retry with defaults.
      recorder = new MediaRecorder(this.stream);
    }
    const l: Live = { recorder, index, startMs, stopMs: null, chunks: [], timer: null };
    this.live.add(l);

    recorder.addEventListener('dataavailable', (e: Event) => {
      const data = (e as BlobEvent).data;
      if (data && data.size > 0) l.chunks.push(data);
    });
    recorder.addEventListener('stop', () => this.finalize(l));

    recorder.start();
    l.timer = setTimeout(() => this.stopLive(l), this.opts.segmentSec * 1000);
  }

  private stopLive(l: Live): void {
    if (l.timer !== null) clearTimeout(l.timer);
    l.timer = null;
    if (l.stopMs === null) l.stopMs = this.now() - this.t0;
    if (l.recorder.state !== 'inactive') {
      try {
        l.recorder.stop();
      } catch {
        this.finalize(l);
      }
    } else {
      this.finalize(l);
    }
  }

  private finalize(l: Live): void {
    if (!this.live.delete(l)) return;
    const endMs = l.stopMs ?? this.now() - this.t0;
    if (endMs - l.startMs < MIN_SEGMENT_MS) return;
    const mimeType = l.recorder.mimeType || this.mimeType;
    const blob = new Blob(l.chunks, { type: mimeType });
    if (blob.size === 0) return;
    this.opts.onSegment({
      id: crypto.randomUUID(),
      gameId: this.opts.gameId,
      index: l.index,
      startMs: l.startMs,
      endMs,
      blob,
      mimeType,
    });
  }
}
