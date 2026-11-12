import type { AIProvider, ProviderId } from '@/core/types';
import { geminiProvider } from './gemini';
import { mockProvider } from './mock';

export const PROVIDERS: AIProvider[] = [geminiProvider, mockProvider];

export function getProvider(id: ProviderId): AIProvider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export * from './errors';
