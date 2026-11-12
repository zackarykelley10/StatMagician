import { useEffect, useRef, useState } from 'react';
import type { PlayEvent, Segment } from '@/core/types';
import { getSegment } from '@/db';

type Clip =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; url: string; segment: Segment };

/** Plays the stored clip for a play. Mount with key={play.id} so state resets per play. */
export function ClipPlayer({ play }: { play: PlayEvent }) {
  const [clip, setClip] = useState<Clip>({ state: 'loading' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const segmentIds = play.segmentIds.join('|');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      const ids = segmentIds ? segmentIds.split('|') : [];
      for (let i = ids.length - 1; i >= 0; i--) {
        let seg: Segment | undefined;
        try {
          seg = await getSegment(ids[i]);
        } catch {
          seg = undefined;
        }
        if (cancelled) return;
        if (seg && seg.blob instanceof Blob && seg.blob.size > 0) {
          url = URL.createObjectURL(seg.blob);
          setClip({ state: 'ready', url, segment: seg });
          return;
        }
      }
      if (!cancelled) setClip({ state: 'missing' });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [segmentIds]);

  const seekTime = (seg: Segment) => Math.max(0, (play.streamMs - seg.startMs) / 1000 - 2);

  if (clip.state === 'loading') {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-900 text-sm text-slate-400">
        Loading clip...
      </div>
    );
  }
  if (clip.state === 'missing') {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Clip no longer stored
      </div>
    );
  }

  const { url, segment } = clip;
  return (
    <div>
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        className="aspect-video w-full rounded-lg bg-black"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = seekTime(segment);
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.currentTime = seekTime(segment);
            void v.play().catch(() => undefined);
          }}
          className="rounded bg-slate-800 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700"
        >
          Replay play
        </button>
        <span className="text-xs text-slate-500">Starts 2s before the snap.</span>
      </div>
    </div>
  );
}
