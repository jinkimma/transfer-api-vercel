// Vercel Serverless Function - API Gateway for unlimited.surf
// Adapter layer for Cloudflare Worker → Vercel

const UNLIMITED_SURF_API_KEY = process.env.UNLIMITED_SURF_API_KEY || 'ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID';
const UPSTREAM_BASE = 'https://unlimited.surf';

// Model mapping
const MODEL_MAP = {
  'gateway-gpt-5-5': 'gpt-5-5',
  'gateway-gpt-5': 'gpt-5',
  'gateway-gpt-4o': 'gpt-4o',
  'gateway-gpt-5-mini': 'gpt-5-mini',
  'gateway-gpt-o3': 'gpt-o3',
  'gateway-claude-opus-4-7': 'claude-opus-4-7',
  'gateway-claude-opus-4-8': 'claude-opus-4-8',
};

// Reverse map for responses
const REVERSE_MODEL_MAP = {};
for (const [key, value] of Object.entries(MODEL_MAP)) {
  REVERSE_MODEL_MAP[value] = key;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.query.path || '';
  const fullPath = path ? `/${path}` : '/';

  // Health check
  if (fullPath === '/health' || fullPath === '/') {
    return res.status(200).json({ ok: true, platform: 'vercel' });
  }

  // Chat completions proxy
  if (fullPath.startsWith('/v1/chat/completions')) {
    return handleChatCompletions(req, res);
  }

  // Responses proxy (Anthropic-style)
  if (fullPath.startsWith('/v1/responses')) {
    return handleResponses(req, res);
  }

  // Messages proxy
  if (fullPath.startsWith('/v1/messages')) {
    return handleMessages(req, res);
  }

  // Merge AI proxy
  if (fullPath.startsWith('/api/merge')) {
    return handleMerge(req, res);
  }

  return res.status(404).json({ error: 'Not found' });
}

async function handleChatCompletions(req, res) {
  try {
    const body = req.body || {};
    let model = body.model || 'gateway-gpt-5-5';

    // Map model name
    const upstreamModel = MODEL_MAP[model] || model;
    const requestBody = {
      ...body,
      model: upstreamModel
    };

    // Build SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const upstreamRes = await fetch(`${UPSTREAM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: { message: errorText } });
    }

    // Stream the response
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          // Map model name back in the stream
          let processedLine = line;
          for (const [key, value] of Object.entries(REVERSE_MODEL_MAP)) {
            processedLine = processedLine.replace(new RegExp(`"model":"${value}"`, 'g'), `"model":"${key}"`);
          }
          res.write(`data: ${processedLine}\n\n`);
        }
      }
    }

    if (buffer.trim()) {
      let processedLine = buffer;
      for (const [key, value] of Object.entries(REVERSE_MODEL_MAP)) {
        processedLine = processedLine.replace(new RegExp(`"model":"${value}"`, 'g'), `"model":"${key}"`);
      }
      res.write(`data: ${processedLine}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat completions error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleResponses(req, res) {
  try {
    const body = req.body || {};
    let model = body.model || 'gateway-gpt-5-5';

    const upstreamModel = MODEL_MAP[model] || model;
    const requestBody = {
      ...body,
      model: upstreamModel
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const upstreamRes = await fetch(`${UPSTREAM_BASE}/v1/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: { message: errorText } });
    }

    // Stream response
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          let processedLine = line;
          for (const [key, value] of Object.entries(REVERSE_MODEL_MAP)) {
            processedLine = processedLine.replace(new RegExp(`"model":"${value}"`, 'g'), `"model":"${key}"`);
          }
          res.write(`${processedLine}\n`);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Responses error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleMessages(req, res) {
  try {
    const body = req.body || {};
    let model = body.model || 'gateway-gpt-5-5';

    const upstreamModel = MODEL_MAP[model] || model;
    const requestBody = {
      ...body,
      model: upstreamModel
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const upstreamRes = await fetch(`${UPSTREAM_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: { message: errorText } });
    }

    // Stream response
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      let processedChunk = chunk;
      for (const [key, value] of Object.entries(REVERSE_MODEL_MAP)) {
        processedChunk = processedChunk.replace(new RegExp(`"model":"${value}"`, 'g'), `"model":"${key}"`);
      }
      res.write(processedChunk);
    }

    res.end();
  } catch (error) {
    console.error('Messages error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleMerge(req, res) {
  try {
    const body = req.body || {};
    const models = body.models || ['gateway-gpt-5-5'];

    // Map models
    const mappedModels = models.map(m => MODEL_MAP[m] || m);

    const requestBody = {
      models: mappedModels,
      prompt: body.prompt || '',
      stream: false
    };

    const upstreamRes = await fetch(`${UPSTREAM_BASE}/v1/merge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await upstreamRes.json();

    // Map model names back
    if (data.choices && data.choices[0]?.message?.content) {
      for (const [key, value] of Object.entries(REVERSE_MODEL_MAP)) {
        data.choices[0].message.content = data.choices[0].message.content.replace(
          new RegExp(`"model":"${value}"`, 'g'),
          `"model":"${key}"`
        );
      }
    }

    res.status(upstreamRes.status).json(data);
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}
