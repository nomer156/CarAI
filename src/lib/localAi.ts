export type ParsedMaintenanceNote = {
  note: string;
  category?: string;
  partName?: string;
  rating?: 'good' | 'bad';
  cost?: number;
  nextMileage?: number;
  source?: 'manual' | 'ai';
};

const LOCAL_AI_URL = 'http://127.0.0.1:11435';

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${LOCAL_AI_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Local AI error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkLocalAiHealth() {
  return request<{ ok: boolean; model: string }>('/health', undefined, 3000);
}

export async function parseMaintenanceNote(input: {
  note: string;
  mileage?: number;
  carName?: string;
}) {
  return request<ParsedMaintenanceNote>('/parse-record', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}
