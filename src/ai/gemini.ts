import type { AIProvider, ExtractionContext, ExtractionResult, ProviderOptions, Segment } from '@/core/types';
import { EXTRACTION_SCHEMA, parseExtractionResult } from '@/core/schema';
import { buildPrompt } from './prompt';
import { ProviderError } from './errors';

/**
 * Per Google's docs (video understanding): inline video is for requests under ~20 MB total.
 * generateContent REST: contents[].parts[].inlineData {mimeType, data}; structured output via
 * generationConfig.responseFormat.text {mimeType: 'APPLICATION_JSON', schema}, where nullable
 * fields are expressed as a type array including "null".
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_INLINE_LIMIT_BYTES = 20 * 1024 * 1024;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 3;

type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

let sleepImpl: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('aborted', 'Aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ProviderError('aborted', 'Aborted'));
      },
      { once: true },
    );
  });

/** Test hook: replace the backoff sleep. */
export function setSleep(fn: SleepFn): void {
  sleepImpl = fn;
}

/** Convert OpenAPI-style `nullable: true` into JSON-schema type arrays. */
export function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (typeof node !== 'object' || node === null) return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'nullable') continue;
    if (k === 'properties' && typeof v === 'object' && v) {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(pv)]));
    } else {
      out[k] = toJsonSchema(v);
    }
  }
  if (o.nullable === true && typeof o.type === 'string') out.type = [o.type, 'null'];
  if (o.nullable === true && Array.isArray(o.enum)) out.enum = [...o.enum, null];
  return out;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf: ArrayBuffer =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as ArrayBuffer);
          fr.onerror = () => reject(fr.error);
          fr.readAsArrayBuffer(blob);
        });
  const bytes = new Uint8Array(buf);
  const CHUNK = 30000; // multiple of 3 so chunk base64 concatenates cleanly
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK))));
  }
  return parts.join('');
}

const cleanMime = (m: string) => m.split(';')[0].trim() || 'video/webm';

async function errorBody(res: Response): Promise<{ message: string; status: string }> {
  try {
    const j = await res.json();
    return { message: String(j?.error?.message ?? ''), status: String(j?.error?.status ?? '') };
  } catch {
    return { message: '', status: '' };
  }
}

async function callOnce(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === 'AbortError') throw new ProviderError('aborted', 'Aborted');
    throw new ProviderError('network', `Network error: ${(e as Error)?.message ?? e}`);
  }
}

const tooLarge = () => new ProviderError('too_large', 'Clip is too large to send inline (20 MB request limit).');

async function extractPlays(
  segment: Segment,
  ctx: ExtractionContext,
  opts: ProviderOptions,
): Promise<ExtractionResult> {
  const { signal } = opts;
  if (signal?.aborted) throw new ProviderError('aborted', 'Aborted');
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const prompt = buildPrompt(ctx);

  if (Math.ceil(segment.blob.size / 3) * 4 + prompt.length > GEMINI_INLINE_LIMIT_BYTES) throw tooLarge();
  const data = await blobToBase64(segment.blob);

  const body = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ inlineData: { mimeType: cleanMime(segment.mimeType), data } }, { text: prompt }] },
    ],
    generationConfig: {
      temperature: 0.1,
      responseFormat: {
        text: { mimeType: 'APPLICATION_JSON', schema: toJsonSchema(EXTRACTION_SCHEMA) },
      },
    },
  });
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body,
    signal,
  };

  let res!: Response;
  for (let attempt = 0; ; attempt++) {
    res = await callOnce(url, init, signal);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) break;
    await sleepImpl(1000 * 2 ** attempt, signal);
  }

  if (!res.ok) {
    const { message, status } = await errorBody(res);
    const m = `Gemini ${res.status}: ${message || status || res.statusText}`;
    if (res.status === 401 || res.status === 403) throw new ProviderError('auth', m, res.status);
    if (res.status === 400 && /api key|API_KEY/i.test(`${message} ${status}`)) {
      throw new ProviderError('auth', m, res.status);
    }
    if (res.status === 429) throw new ProviderError('rate_limit', m, res.status);
    if (res.status === 413) throw new ProviderError('too_large', m, res.status);
    if (res.status >= 500) throw new ProviderError('network', m, res.status);
    throw new ProviderError('bad_response', m, res.status);
  }

  let json: { promptFeedback?: { blockReason?: string }; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown }> } }> } | null;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError('bad_response', 'Response was not valid JSON', res.status);
  }
  if (json?.promptFeedback?.blockReason) {
    throw new ProviderError('bad_response', `Blocked: ${json.promptFeedback.blockReason}`, res.status);
  }
  const cand = json?.candidates?.[0];
  const text: string = (cand?.content?.parts ?? [])
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  if (!text) {
    throw new ProviderError(
      'bad_response',
      `Empty response${cand?.finishReason ? ` (${cand.finishReason})` : ''}`,
      res.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError('bad_response', 'Model did not return valid JSON', res.status);
  }
  return parseExtractionResult(parsed);
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: GEMINI_DEFAULT_MODEL,
  extractPlays,
};
