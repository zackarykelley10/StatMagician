import type { AIProvider, Game, PlayEvent, Segment, Settings } from '@/core/types';
import { isCounted } from '@/core/types';
import { currentState, reconcile } from './index';

export interface PipelineStatus {
  queued: number;
  processing: boolean;
  processed: number;
  lastError: string | null;
  warnings: string[];
  /** True once an unrecoverable error (bad key) stopped the pipeline. */
  halted: boolean;
}

export interface PipelineStore {
  listPlays(gameId: string): Promise<PlayEvent[]>;
  putPlays(plays: PlayEvent[]): Promise<unknown>;
  saveSegment(segment: Segment): Promise<unknown>;
  pruneSegments(gameId: string, keepIds: string[]): Promise<unknown>;
}

export interface PipelineOptions {
  game: Game;
  settings: Settings;
  provider: AIProvider;
  store: PipelineStore;
  onPlays: (plays: PlayEvent[]) => void;
  onStatus: (s: PipelineStatus) => void;
}

/** Keep clips for this many of the most recent plays, plus every play awaiting review. */
const KEEP_RECENT_PLAYS = 5;
const RECENT_CONTEXT_PLAYS = 6;

/**
 * Takes clips from the segmenter and, one at a time and in order,
 * sends each to the AI, merges the result into the play list and persists it.
 */
export class Pipeline {
  private queue: Segment[] = [];
  private busy = false;
  private abort = new AbortController();
  private status: PipelineStatus = {
    queued: 0, processing: false, processed: 0, lastError: null, warnings: [], halted: false,
  };

  constructor(private opts: PipelineOptions) {}

  enqueue(segment: Segment): void {
    if (this.status.halted) return;
    this.queue.push(segment);
    this.emit();
    void this.drain();
  }

  /** Stop accepting work and cancel the in-flight request. */
  dispose(): void {
    this.queue = [];
    this.abort.abort();
    this.status.halted = true;
  }

  /** Resolves when the queue is empty (used by tests and by "stop capture"). */
  async idle(): Promise<void> {
    while (this.busy || this.queue.length) await new Promise((r) => setTimeout(r, 25));
  }

  private emit() {
    this.status = { ...this.status, queued: this.queue.length, processing: this.busy };
    this.opts.onStatus(this.status);
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.emit();
    try {
      while (this.queue.length && !this.status.halted) {
        const segment = this.queue.shift()!;
        await this.process(segment);
        this.status.processed++;
        this.emit();
      }
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private async process(segment: Segment): Promise<void> {
    const { game, settings, provider, store } = this.opts;
    try {
      const existing = await store.listPlays(game.id);
      const counted = existing.filter(isCounted);
      const result = await provider.extractPlays(
        segment,
        {
          home: game.home,
          away: game.away,
          state: currentState(existing),
          recentPlays: counted.slice(-RECENT_CONTEXT_PLAYS),
        },
        { apiKey: settings.apiKey, model: settings.model || undefined, signal: this.abort.signal },
      );

      // Re-read: the user may have edited plays while the request was in flight.
      const latest = await store.listPlays(game.id);
      const out = reconcile({
        game, existing: latest, segment, result, threshold: settings.reviewThreshold,
      });

      if (out.added || out.replaced || out.duplicates) {
        await store.saveSegment(segment);
        await store.putPlays(out.plays);
        const live = out.plays.filter(isCounted);
        const keep = new Set<string>();
        for (const p of live.slice(-KEEP_RECENT_PLAYS)) p.segmentIds.forEach((id) => keep.add(id));
        for (const p of live) if (p.status === 'needs_review') p.segmentIds.forEach((id) => keep.add(id));
        await store.pruneSegments(game.id, [...keep]);
        this.opts.onPlays(out.plays);
      }
      this.status.lastError = null;
      this.status.warnings = out.warnings;
    } catch (err) {
      const kind = (err as { kind?: string }).kind;
      if (kind === 'aborted') return;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      if (kind === 'auth') {
        // Nothing will succeed until the key is fixed.
        this.status.halted = true;
        this.queue = [];
      }
    }
  }
}
