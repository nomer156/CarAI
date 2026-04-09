import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 11535;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';
const ALLOWED_ORIGINS = (process.env.AI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || '40', 10) || 40;
const requestBuckets = new Map();

function resolveCorsOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return '*';
  if (!ALLOWED_ORIGINS.length) return origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}

function getClientAddress(request) {
  return request.headers['cf-connecting-ip']
    || request.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || request.socket.remoteAddress
    || 'unknown';
}

function isRateLimited(request) {
  const key = getClientAddress(request);
  const now = Date.now();
  const bucket = requestBuckets.get(key);

  if (!bucket || now - bucket.startedAt > RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  requestBuckets.set(key, bucket);
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function sendJson(request, response, statusCode, payload) {
  const corsOrigin = resolveCorsOrigin(request);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

function sanitizeParsedPayload(input) {
  if (!input || typeof input !== 'object') {
    return { note: '', category: 'manual', source: 'manual' };
  }

  return {
    note: typeof input.note === 'string' ? input.note.trim() : '',
    category: typeof input.category === 'string' ? input.category.trim() : 'manual',
    partName: typeof input.partName === 'string' ? input.partName.trim() : undefined,
    rating: input.rating === 'good' || input.rating === 'bad' ? input.rating : undefined,
    cost: Number.isFinite(input.cost) ? Number(input.cost) : undefined,
    nextMileage: Number.isFinite(input.nextMileage) ? Number(input.nextMileage) : undefined,
    source: 'ai',
  };
}

function sanitizeNormalizedCommand(input, fallbackText) {
  const cleanString = (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed === '?' || trimmed === '-' || trimmed.toLowerCase() === 'null') return undefined;
    return trimmed;
  };

  const cleanMaybeQuestionable = (value) => {
    const normalized = cleanString(value);
    if (!normalized) return undefined;
    return normalized.endsWith('?') ? normalized.slice(0, -1).trim() || undefined : normalized;
  };

  const cleanPositiveNumber = (value) => (Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined);

  if (!input || typeof input !== 'object') {
    return {
      intent: 'note_only',
      rawText: fallbackText,
      confidence: 0.2,
      dateMode: 'unknown',
    };
  }

  const fallbackLower = String(fallbackText || '').toLowerCase();
  const intent = ['replace_oil', 'add_part', 'update_mileage', 'note_only'].includes(input.intent) ? input.intent : 'note_only';
  const oilBrand = cleanMaybeQuestionable(input.oilBrand);
  const manufacturer = cleanMaybeQuestionable(input.manufacturer);

  return {
    intent,
    rawText: cleanString(input.rawText) || fallbackText,
    normalizedText: cleanString(input.normalizedText),
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0.4,
    dateMode: ['today', 'yesterday', 'specific', 'unknown'].includes(input.dateMode) ? input.dateMode : 'unknown',
    specificDate: input.dateMode === 'specific' ? cleanString(input.specificDate) : undefined,
    mileageKm: cleanPositiveNumber(input.mileageKm),
    oilViscosity: cleanString(input.oilViscosity)?.toUpperCase(),
    oilBrand: intent === 'replace_oil' && oilBrand && fallbackLower.includes(oilBrand.toLowerCase()) ? oilBrand : undefined,
    partName: intent === 'add_part' ? cleanString(input.partName) : undefined,
    manufacturer: intent === 'add_part' && manufacturer && fallbackLower.includes(manufacturer.toLowerCase()) ? manufacturer : undefined,
    category: cleanString(input.category) || 'manual',
    cost: cleanPositiveNumber(input.cost),
    nextMileage: cleanPositiveNumber(input.nextMileage),
    shouldCreatePart: Boolean(input.shouldCreatePart),
  };
}

async function parseRecordWithOllama(body) {
  const system = [
    'Ты извлекаешь структуру из короткой записи об обслуживании автомобиля.',
    'Верни только JSON без пояснений.',
    'Схема ответа:',
    '{"note":"string","category":"manual","partName":"string?","rating":"good|bad?","cost":number?,"nextMileage":number?}',
    'Не выдумывай данные. Если поля нет, не добавляй его.',
  ].join('\n');

  const user = [
    `Запись: ${body.note ?? ''}`,
    `Пробег: ${body.mileage ?? ''}`,
    `Автомобиль: ${body.carName ?? ''}`,
  ].join('\n');

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Ollama error ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.message?.content;
  const parsed = JSON.parse(content);
  return sanitizeParsedPayload(parsed);
}

async function normalizeCommandWithOllama(body) {
  const system = [
    'Ты нормализуешь команду владельца автомобиля в строгий JSON для мобильного приложения.',
    'Верни только JSON без пояснений.',
    'Разрешенные intent: replace_oil, add_part, update_mileage, note_only.',
    'Разрешенные dateMode: today, yesterday, specific, unknown.',
    'Если пользователь написал "вчера", верни dateMode=yesterday.',
    'Если дата не указана, но действие выглядит как факт обслуживания, чаще используй today.',
    'Если пользователь пишет про масло, intent должен быть replace_oil.',
    'Если пользователь пишет про деталь/колодки/фильтр/свечи, intent должен быть add_part.',
    'Если пользователь только сообщает пробег, intent должен быть update_mileage.',
    'Если команда неясна, intent=note_only.',
    'Не выдумывай OEM, даты, пробег и бренд, если их нет в тексте или контексте.',
    'Схема ответа:',
    '{"intent":"replace_oil|add_part|update_mileage|note_only","rawText":"string","normalizedText":"string?","confidence":0.0,"dateMode":"today|yesterday|specific|unknown","specificDate":"string?","mileageKm":123456,"oilViscosity":"5W-40?","oilBrand":"Shell?","partName":"string?","manufacturer":"string?","category":"manual","cost":5000,"nextMileage":136000,"shouldCreatePart":true}',
  ].join('\n');

  const user = [
    `Текст пользователя: ${body.text ?? ''}`,
    `Текущий пробег: ${body.mileage ?? ''}`,
    `Марка: ${body.brand ?? ''}`,
    `Модель: ${body.model ?? ''}`,
    `Последнее масло: ${body.lastOil ?? ''}`,
    `Рекомендованное масло: ${body.recommendedOil ?? ''}`,
  ].join('\n');

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        temperature: 0.05,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Ollama error ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.message?.content;
  const parsed = JSON.parse(content);
  return sanitizeNormalizedCommand(parsed, body.text ?? '');
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(request, response, 400, { error: 'Missing URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (resolveCorsOrigin(request) === '') {
    sendJson(request, response, 403, { error: 'Origin is not allowed' });
    return;
  }

  if (request.method === 'POST' && isRateLimited(request)) {
    sendJson(request, response, 429, { error: 'Rate limit exceeded' });
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(request, response, 200, {
      ok: true,
      model: MODEL,
      allowedOrigins: ALLOWED_ORIGINS,
      rateLimitPerMinute: RATE_LIMIT_MAX_REQUESTS,
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/parse-record') {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk.toString();
    });

    request.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const parsed = await parseRecordWithOllama(body);
        sendJson(request, response, 200, parsed);
      } catch (error) {
        sendJson(request, response, 500, {
          error: error instanceof Error ? error.message : 'Failed to parse record',
        });
      }
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/normalize-command') {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk.toString();
    });

    request.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const parsed = await normalizeCommandWithOllama(body);
        sendJson(request, response, 200, parsed);
      } catch (error) {
        sendJson(request, response, 500, {
          error: error instanceof Error ? error.message : 'Failed to normalize command',
        });
      }
    });
    return;
  }

  sendJson(request, response, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Local AI server is running at http://${HOST}:${PORT}`);
  console.log(`Using model: ${MODEL}`);
});
