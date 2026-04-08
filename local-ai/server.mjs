import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 11435;
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

  sendJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Local AI server is running at http://${HOST}:${PORT}`);
  console.log(`Using model: ${MODEL}`);
});
