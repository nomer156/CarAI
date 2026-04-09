export type ParsedMaintenanceNote = {
  note: string;
  category?: string;
  partName?: string;
  rating?: 'good' | 'bad';
  cost?: number;
  nextMileage?: number;
  source?: 'manual' | 'ai';
};

export type NormalizedOwnerCommand = {
  intent: 'replace_oil' | 'add_part' | 'service_event' | 'update_mileage' | 'ask_ai' | 'note_only';
  rawText: string;
  normalizedText?: string;
  answerText?: string;
  confidence: number;
  dateMode: 'today' | 'yesterday' | 'specific' | 'unknown';
  specificDate?: string;
  mileageKm?: number;
  oilViscosity?: string;
  oilBrand?: string;
  partName?: string;
  manufacturer?: string;
  category?: string;
  cost?: number;
  nextMileage?: number;
  shouldCreatePart?: boolean;
};

const DEFAULT_LOCAL_AI_URL = 'http://127.0.0.1:11535';
const DEFAULT_PUBLIC_AI_URL = 'https://vpn-little-hosts-deal.trycloudflare.com';
const LEGACY_PUBLIC_AI_URLS = [
  'https://collaborative-pmid-cargo-llp.trycloudflare.com',
  'https://those-omaha-commitment-opinions.trycloudflare.com',
];

function sanitizeUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export function getConfiguredAiBackendUrl() {
  const runtimeOverride = sanitizeUrl(window.localStorage.getItem('codexcar-ai-backend-url'));
  const envUrl = sanitizeUrl(import.meta.env.VITE_AI_BACKEND_URL);
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  return runtimeOverride ?? envUrl ?? (isLocalHost ? DEFAULT_LOCAL_AI_URL : DEFAULT_PUBLIC_AI_URL);
}

function getAiBackendCandidates() {
  const runtimeOverride = sanitizeUrl(window.localStorage.getItem('codexcar-ai-backend-url'));
  const envUrl = sanitizeUrl(import.meta.env.VITE_AI_BACKEND_URL);
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const candidates = isLocalHost
    ? [runtimeOverride, envUrl, DEFAULT_LOCAL_AI_URL]
    : [runtimeOverride, envUrl, DEFAULT_PUBLIC_AI_URL, ...LEGACY_PUBLIC_AI_URLS];

  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

export function setConfiguredAiBackendUrl(url: string) {
  const normalized = sanitizeUrl(url);
  if (!normalized) {
    window.localStorage.removeItem('codexcar-ai-backend-url');
    return;
  }
  window.localStorage.setItem('codexcar-ai-backend-url', normalized);
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<{ data: T; url: string }> {
  const candidates = getAiBackendCandidates();
  let lastError: Error | null = null;

  for (const aiBaseUrl of candidates) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${aiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Local AI error: ${response.status}`);
      }

      const data = await response.json() as T;
      if (aiBaseUrl !== getConfiguredAiBackendUrl()) {
        setConfiguredAiBackendUrl(aiBaseUrl);
      }
      return { data, url: aiBaseUrl };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Local AI request failed');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Local AI request failed');
}

export async function checkLocalAiHealth() {
  const result = await request<{ ok: boolean; model: string }>('/health', undefined, 3000);
  return { ...result.data, url: result.url };
}

export async function parseMaintenanceNote(input: {
  note: string;
  mileage?: number;
  carName?: string;
}) {
  const result = await request<ParsedMaintenanceNote>('/parse-record', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function normalizeOwnerCommand(input: {
  text: string;
  mileage?: number;
  brand?: string;
  model?: string;
  lastOil?: string;
  recommendedOil?: string;
}) {
  const result = await request<NormalizedOwnerCommand>('/normalize-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return result.data;
}
