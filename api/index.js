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

  // Parse path from URL - extract pathname
  // Vercel serverless: Vercel rewrites pass original path via headers
  let fullPath = '/';

  // Method 1: Check x-vercel-forwarded-url header (original URL before rewrite)
  const forwardedUrl = req.headers?.['x-vercel-forwarded-url'];
  if (forwardedUrl) {
    try {
      const parsed = new URL(forwardedUrl);
      fullPath = parsed.pathname;
    } catch {
      fullPath = forwardedUrl.split('?')[0] || '/';
    }
  }

  // Method 2: Check referer header (often contains original URL)
  const referer = req.headers?.referer;
  if (referer && fullPath === '/') {
    try {
      const parsed = new URL(referer);
      fullPath = parsed.pathname;
    } catch {
      // ignore
    }
  }

  // Method 3: req.nextUrl (Next.js style)
  if (req.nextUrl && req.nextUrl.pathname && req.nextUrl.pathname !== '/api/index.js') {
    fullPath = req.nextUrl.pathname;
  }

  // Method 4: req.url (but skip if it's the rewrite artifact)
  if (req.url && req.url !== '/api/index.js' && fullPath === '/') {
    const urlStr = req.url;
    if (urlStr.startsWith('http')) {
      try {
        const parsed = new URL(urlStr);
        fullPath = parsed.pathname;
      } catch {
        fullPath = urlStr.split('?')[0] || '/';
      }
    } else {
      fullPath = urlStr.split('?')[0] || '/';
    }
  }

  // Method 5: Vercel route params header (for dynamic routes)
  const vercelRouteParams = req.headers?.['x-now-route-params'];
  if (vercelRouteParams && fullPath === '/') {
    try {
      const params = JSON.parse(vercelRouteParams);
      if (params.path1) {
        fullPath = '/' + params.path1;
      }
    } catch {
      // ignore parse errors
    }
  }

  // Health check
  if (fullPath === '/health' || fullPath === '/') {
    return res.status(200).json({ ok: true, platform: 'vercel' });
  }

  // Debug endpoint
  if (fullPath === '/debug') {
    return res.status(200).json({
      url: req.url,
      fullPath: fullPath,
      method: req.method,
      hasNextUrl: !!req.nextUrl,
      nextUrlPathname: req.nextUrl?.pathname,
      query: req.query,
      allHeaders: req.headers,
      vercelForwardedUrl: req.headers?.['x-vercel-forwarded-url'],
      referer: req.headers?.referer,
      vercelRouteParams: req.headers?.['x-now-route-params']
    });
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

// Standard OpenAI Responses API format
function createResponseObject(model, content, id = null) {
  const responseId = id || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id: responseId,
    model: model,
    created: Math.floor(Date.now() / 1000),
    object: 'response',
    status: 'completed',
    output: [
      {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content
          }
        ]
      }
    ]
  };
}

function createStreamChunk(model, delta, index = 0) {
  return {
    id: `resp_${Date.now()}`,
    model: model,
    created: Math.floor(Date.now() / 1000),
    object: 'response.created',
    output: [
      {
        id: `msg_${index}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'input_token',
            text: delta
          }
        ]
      }
    ]
  };
}

async function handleResponses(req, res) {
  try {
    const body = req.body || {};
    let model = body.model || 'gateway-gpt-5-5';
    const messages = body.messages || [];
    const stream = body.stream !== false;

    const upstreamModel = MODEL_MAP[model] || model;

    // Extract prompt from messages for upstream
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    // Set headers
    res.setHeader('Content-Type', stream ? 'text/event-stream' : 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const requestBody = {
      model: upstreamModel,
      prompt: prompt,
      stream: stream
    };

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
      return res.status(upstreamRes.status).json({
        error: {
          message: errorText,
          type: 'upstream_error'
        }
      });
    }

    if (stream) {
      // Stream mode: convert SSE to OpenAI Responses streaming format
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outputIndex = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            // Remove SSE prefix
            let data = line.replace(/^data: /, '');

            if (data === '[DONE]') {
              res.write('event: done\ndata: [DONE]\n\n');
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              // Extract text from upstream response and format for OpenAI
              let text = '';
              if (parsed.choices && parsed.choices[0]?.message?.content) {
                text = parsed.choices[0].message.content;
              } else if (parsed.text) {
                text = parsed.text;
              } else if (typeof parsed === 'string') {
                text = parsed;
              }

              if (text) {
                const chunk = {
                  id: `resp_${Date.now()}`,
                  model: model,
                  created: Math.floor(Date.now() / 1000),
                  object: 'response.output_text.delta',
                  output_index: outputIndex,
                  output: {
                    id: `msg_${outputIndex}`,
                    type: 'message',
                    role: 'assistant',
                    content: [
                      {
                        type: 'output_text',
                        text: text,
                        annotations: []
                      }
                    ]
                  }
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                outputIndex++;
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }

      // Send completion event
      const completion = {
        id: `resp_${Date.now()}`,
        model: model,
        created: Math.floor(Date.now() / 1000),
        object: 'response.completed',
        output: [],
        status: 'completed'
      };
      res.write(`data: ${JSON.stringify(completion)}\n\n`);
      res.end();
    } else {
      // Non-stream mode
      const data = await upstreamRes.json();

      // Extract content from upstream format
      let content = '';
      if (data.choices && data.choices[0]?.message?.content) {
        content = data.choices[0].message.content;
      } else if (data.text) {
        content = data.text;
      } else if (data.output?.text) {
        content = data.output.text;
      }

      const response = createResponseObject(model, content, data.id);
      res.json(response);
    }
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
