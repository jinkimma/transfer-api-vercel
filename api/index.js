// Vercel Serverless Function - API Gateway for unlimited.surf
// GitHub: jinkimma/transfer-api-vercel

const UNLIMITED_SURF_API_KEY = process.env.UNLIMITED_SURF_API_KEY || 'ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID';
const UPSTREAM_BASE = 'https://unlimited.surf';
const MODEL_MAP = {
  'gateway-gpt-5-5': 'gateway-gpt-5-5',
  'gateway-gpt-5': 'gateway-gpt-5',
  'gateway-gpt-4o': 'gateway-gpt-4o',
  'gateway-gpt-5-mini': 'gateway-gpt-5-mini',
  'gateway-gpt-o3': 'gateway-gpt-o3',
  'gateway-claude-opus-4-7': 'gateway-claude-opus-4-7',
  'gateway-claude-opus-4-8': 'gateway-claude-opus-4-8',
};

// Reverse map for responses
const REVERSE_MODEL_MAP = {};
for (const [key, value] of Object.entries(MODEL_MAP)) {
  REVERSE_MODEL_MAP[value] = key;
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Extract path from request
  let fullPath = '/';

  // Try different ways to get path in various Vercel environments
  if (typeof req.url === 'string') {
    // Node.js runtime: req.url is the path
    fullPath = req.url.split('?')[0];
  }

  // Health check
  if (fullPath === '/health' || fullPath === '/' || fullPath === '/api') {
    return res.status(200).json({ ok: true, platform: 'vercel', v: '3' });
  }

  // Debug endpoint
  if (fullPath === '/debug' || fullPath === '/v1/debug') {
    return res.status(200).json({
      url: req.url,
      fullPath: fullPath,
      method: req.method,
      hasNextUrl: !!req.nextUrl,
      nextUrlPathname: req.nextUrl?.pathname,
      query: req.query,
      allHeaders: Object.fromEntries(
        Object.entries(req.headers || {}).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 100) : v])
      )
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
    const messages = body.messages || [];
    const stream = body.stream !== false;

    // Map model name
    const upstreamModel = MODEL_MAP[model] || model;

    // Convert messages to prompt for upstream
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    // Set headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Call upstream with correct endpoint and format
    const upstreamRes = await fetch(`${UPSTREAM_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: upstreamModel, prompt, stream }),
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: { message: errorText } });
    }

    // Stream the response - convert unlimited.surf format to OpenAI format
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
          // Remove SSE prefix
          let data = line.replace(/^data: /, '');

          try {
            const parsed = JSON.parse(data);

            // Convert to OpenAI chat format
            if (parsed.delta !== undefined) {
              const chunk = {
                id: `chatcmpl_${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: parsed.delta },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }

            if (parsed.finish || parsed.done) {
              const doneChunk = {
                id: `chatcmpl_${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }]
              };
              res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }

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
    const stream = body.stream !== false;

    // Support both OpenAI Responses API format (input) and Chat format (messages)
    let prompt = '';

    if (body.input) {
      // OpenAI Responses API format with "input" field
      if (typeof body.input === 'string') {
        prompt = body.input;
      } else if (Array.isArray(body.input)) {
        // input: [{type: "text", text: "..."}]
        prompt = body.input.map(item => item.text || item.content || '').join('\n');
      } else if (typeof body.input === 'object' && body.input.text) {
        prompt = body.input.text;
      }
    } else if (body.messages) {
      // Legacy chat format with messages array
      prompt = body.messages.map(m => `${m.role}: ${m.content}`).join('\n');
    } else if (body.prompt) {
      // Direct prompt field
      prompt = body.prompt;
    }

    if (!prompt) {
      return res.status(400).json({
        error: {
          message: 'Missing input: provide "input" (string or array), "messages" array, or "prompt"',
          type: 'invalid_request_error'
        }
      });
    }

    const upstreamModel = MODEL_MAP[model] || model;

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

    // Call upstream /api/chat (same as handleChatCompletions)
    const upstreamRes = await fetch(`${UPSTREAM_BASE}/api/chat`, {
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
              } else if (parsed.delta) {
                text = parsed.delta;
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
                    index: outputIndex,
                    type: 'message',
                    id: `msg_${outputIndex}`,
                    role: 'assistant',
                    content: [
                      {
                        type: 'output_text',
                        text: text
                      }
                    ]
                  }
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
        output: [
          {
            index: 0,
            type: 'message',
            id: `msg_0`,
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: ''
              }
            ]
          }
        ],
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
    const messages = body.messages || [];

    const upstreamModel = MODEL_MAP[model] || model;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Convert messages to prompt
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const upstreamRes = await fetch(`${UPSTREAM_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNLIMITED_SURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: upstreamModel, prompt, stream: true }),
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
