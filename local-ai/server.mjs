import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 11535;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
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
  if (!input || typeof input !== 'object') {
    return {
      intent: 'note_only',
      rawText: fallbackText,
      confidence: 0.2,
      dateMode: 'unknown',
    };
  }

  return {
    intent: ['replace_oil', 'add_part', 'update_mileage', 'note_only'].includes(input.intent) ? input.intent : 'note_only',
    rawText: typeof input.rawText === 'string' && input.rawText.trim() ? input.rawText.trim() : fallbackText,
    normalizedText: typeof input.normalizedText === 'string' ? input.normalizedText.trim() : undefined,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0.4,
    dateMode: ['today', 'yesterday', 'specific', 'unknown'].includes(input.dateMode) ? input.dateMode : 'unknown',
    specificDate: typeof input.specificDate === 'string' ? input.specificDate.trim() : undefined,
    mileageKm: Number.isFinite(input.mileageKm) ? Number(input.mileageKm) : undefined,
    oilViscosity: typeof input.oilViscosity === 'string' ? input.oilViscosity.trim().toUpperCase() : undefined,
    oilBrand: typeof input.oilBrand === 'string' ? input.oilBrand.trim() : undefined,
    partName: typeof input.partName === 'string' ? input.partName.trim() : undefined,
    manufacturer: typeof input.manufacturer === 'string' ? input.manufacturer.trim() : undefined,
    category: typeof input.category === 'string' ? input.category.trim() : 'manual',
    cost: Number.isFinite(input.cost) ? Number(input.cost) : undefined,
    nextMileage: Number.isFinite(input.nextMileage) ? Number(input.nextMileage) : undefined,
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
    sendJson(response, 400, { error: 'Missing URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, model: MODEL });
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
        sendJson(response, 200, parsed);
      } catch (error) {
        sendJson(response, 500, {
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
        sendJson(response, 200, parsed);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Failed to normalize command',
        });
      }
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Local AI server is running at http://${HOST}:${PORT}`);
  console.log(`Using model: ${MODEL}`);
});
