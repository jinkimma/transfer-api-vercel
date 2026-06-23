// Minimal Vercel Serverless Function - API Gateway
const UPSTREAM_BASE = 'https://unlimited.surf';
const UNLIMITED_SURF_API_KEY = process.env.UNLIMITED_SURF_API_KEY || 'ua_c1tpKRkd4A-fB-f0Dr-lj8Wa-arSKQID';

// Simple model mapping
const MODEL_MAP = {
  'gateway-gpt-5-5': 'gateway-gpt-5-5',
  'gateway-gpt-5': 'gateway-gpt-5',
  'gateway-gpt-4o': 'gateway-gpt-4o',
  'gateway-gpt-5-mini': 'gateway-gpt-5-mini',
  'gateway-gpt-o3': 'gateway-gpt-o3',
  'gateway-claude-opus-4-7': 'gateway-claude-opus-4-7',
  'gateway-claude-opus-4-8': 'gateway-claude-opus-4-8',
};

// Reverse map
const REVERSE_MODEL_MAP = {};
Object.keys(MODEL_MAP).forEach(function(key) {
  REVERSE_MODEL_MAP[MODEL_MAP[key]] = key;
});

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Get path simply
  var path = '/';
  if (req.url) {
    path = req.url.split('?')[0];
  }

  // Health check - minimal
  if (path === '/health' || path === '/' || path === '/api') {
    res.status(200).json({ ok: true, platform: 'vercel', v: '4' });
    return;
  }

  // Debug endpoint
  if (path === '/debug' || path === '/v1/debug') {
    res.status(200).json({
      url: req.url,
      path: path,
      method: req.method,
      env: {
        hasApiKey: !!process.env.UNLIMITED_SURF_API_KEY
      }
    });
    return;
  }

  // Chat completions proxy
  if (path.startsWith('/v1/chat/completions')) {
    return handleChat(req, res);
  }

  // Responses proxy
  if (path.startsWith('/v1/responses')) {
    return handleResponses(req, res);
  }

  // Messages proxy
  if (path.startsWith('/v1/messages')) {
    return handleMessages(req, res);
  }

  // Merge endpoint
  if (path === '/api/merge') {
    return handleMerge(req, res);
  }

  res.status(404).json({ error: 'Not found' });
}

async function handleChat(req, res) {
  try {
    var body = req.body || {};
    var model = body.model || 'gateway-gpt-5-5';
    var messages = body.messages || [];
    var stream = body.stream !== false;

    var upstreamModel = MODEL_MAP[model] || model;
    var prompt = messages.map(function(m) { return m.role + ': ' + m.content; }).join('\n');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    var upstreamRes = await fetch(UPSTREAM_BASE + '/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UNLIMITED_SURF_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: upstreamModel, prompt: prompt, stream: stream })
    });

    if (!upstreamRes.ok) {
      var errorText = await upstreamRes.text();
      res.status(upstreamRes.status).json({ error: { message: errorText } });
      return;
    }

    // Stream response
    var reader = upstreamRes.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.trim()) {
          var data = line.replace(/^data: /, '');
          try {
            var parsed = JSON.parse(data);
            if (parsed.delta !== undefined) {
              var chunk = {
                id: 'chatcmpl_' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{ index: 0, delta: { content: parsed.delta }, finish_reason: null }]
              };
              res.write('data: ' + JSON.stringify(chunk) + '\n\n');
            }
            if (parsed.finish || parsed.done) {
              var doneChunk = {
                id: 'chatcmpl_' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
              };
              res.write('data: ' + JSON.stringify(doneChunk) + '\n\n');
              res.write('data: [DONE]\n\n');
            }
          } catch (e) {}
        }
      }
    }
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleResponses(req, res) {
  try {
    var body = req.body || {};
    var model = body.model || 'gateway-gpt-5-5';
    var stream = body.stream !== false;

    var prompt = '';
    if (body.input) {
      if (typeof body.input === 'string') prompt = body.input;
      else if (Array.isArray(body.input)) prompt = body.input.map(function(item) { return item.text || item.content || ''; }).join('\n');
      else if (body.input.text) prompt = body.input.text;
    } else if (body.messages) {
      prompt = body.messages.map(function(m) { return m.role + ': ' + m.content; }).join('\n');
    } else if (body.prompt) {
      prompt = body.prompt;
    }

    if (!prompt) {
      res.status(400).json({ error: { message: 'Missing input', type: 'invalid_request_error' } });
      return;
    }

    var upstreamModel = MODEL_MAP[model] || model;

    res.setHeader('Content-Type', stream ? 'text/event-stream' : 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    var upstreamRes = await fetch(UPSTREAM_BASE + '/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UNLIMITED_SURF_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: upstreamModel, prompt: prompt, stream: stream })
    });

    if (!upstreamRes.ok) {
      var errorText = await upstreamRes.text();
      res.status(upstreamRes.status).json({ error: { message: errorText } });
      return;
    }

    if (stream) {
      var reader = upstreamRes.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.trim()) {
            var data = line.replace(/^data: /, '');
            if (data === '[DONE]') {
              res.write('event: done\ndata: [DONE]\n\n');
              continue;
            }
            try {
              var parsed = JSON.parse(data);
              var text = parsed.delta || (parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || parsed.text || '';
              if (text) {
                var chunk = {
                  id: 'resp_' + Date.now(),
                  model: model,
                  created: Math.floor(Date.now() / 1000),
                  object: 'response.output_text.delta',
                  output: { index: 0, type: 'message', id: 'msg_0', role: 'assistant', content: [{ type: 'output_text', text: text }] }
                };
                res.write('data: ' + JSON.stringify(chunk) + '\n\n');
              }
            } catch (e) {}
          }
        }
      }
      var completion = {
        id: 'resp_' + Date.now(),
        model: model,
        created: Math.floor(Date.now() / 1000),
        object: 'response.completed',
        output: [{ index: 0, type: 'message', id: 'msg_0', role: 'assistant', content: [{ type: 'output_text', text: '' }] }],
        status: 'completed'
      };
      res.write('data: ' + JSON.stringify(completion) + '\n\n');
      res.end();
    } else {
      var data = await upstreamRes.json();
      var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.text || '';
      res.json({
        id: 'resp_' + Date.now(),
        model: model,
        created: Math.floor(Date.now() / 1000),
        object: 'response',
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] }]
      });
    }
  } catch (error) {
    console.error('Responses error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleMessages(req, res) {
  try {
    var body = req.body || {};
    var model = body.model || 'gateway-gpt-5-5';
    var messages = body.messages || [];
    var upstreamModel = MODEL_MAP[model] || model;
    var prompt = messages.map(function(m) { return m.role + ': ' + m.content; }).join('\n');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    var upstreamRes = await fetch(UPSTREAM_BASE + '/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UNLIMITED_SURF_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: upstreamModel, prompt: prompt, stream: true })
    });

    if (!upstreamRes.ok) {
      var errorText = await upstreamRes.text();
      res.status(upstreamRes.status).json({ error: { message: errorText } });
      return;
    }

    var reader = upstreamRes.body.getReader();
    var decoder = new TextDecoder();

    while (true) {
      var result = await reader.read();
      if (result.done) break;
      res.write(decoder.decode(result.value, { stream: true }));
    }
    res.end();
  } catch (error) {
    console.error('Messages error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

async function handleMerge(req, res) {
  try {
    var body = req.body || {};
    var models = body.models || ['gateway-gpt-5-5'];
    var mappedModels = models.map(function(m) { return MODEL_MAP[m] || m; });

    var upstreamRes = await fetch(UPSTREAM_BASE + '/v1/merge', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UNLIMITED_SURF_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ models: mappedModels, prompt: body.prompt || '', stream: false })
    });

    var data = await upstreamRes.json();
    res.status(upstreamRes.status).json(data);
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}
