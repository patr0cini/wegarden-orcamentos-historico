const http    = require('http');
const https   = require('https');

const PORT        = process.env.PORT || 3000;
const GH_TOKEN    = process.env.GH_TOKEN;
const GH_OWNER    = 'patr0cini';
const GH_REPO     = 'wegarden-orcamentos-historico';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'User-Agent':    'wegarden-server',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readData(file) {
  const r = await ghRequest('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${file}`);
  if (r.status !== 200) throw new Error('GitHub read failed: ' + r.status);
  const content = Buffer.from(r.body.content, 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: r.body.sha };
}

async function writeData(file, data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
  const r = await ghRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${file}`, {
    message: `update: ${file} ` + new Date().toISOString(),
    content,
    sha,
  });
  if (r.status !== 200 && r.status !== 201) throw new Error('GitHub write failed: ' + r.status);
  return r.body;
}

// Routes: /data, /2024/data, /2025/data
function getFileName(url) {
  if (url === '/data') return 'data.json';
  const m = url.match(/^\/(20\d\d)\/data$/);
  if (m) return `data${m[1]}.json`;
  return null;
}

http.createServer(async (req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', gh_token: !!GH_TOKEN }));
    return;
  }

  const file = getFileName(req.url);

  if (file && req.method === 'GET') {
    try {
      const { data } = await readData(file);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (e) {
      console.error('GET error:', e.message);
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (file && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const incoming = JSON.parse(body);
        // Accept both {data: [...]} and plain [...]
        const arr = Array.isArray(incoming) ? incoming : (incoming.data || incoming);
        const { sha } = await readData(file);
        await writeData(file, arr, sha);
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error('PUT error:', e.message);
        res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, () => {
  console.log('We Garden API on port ' + PORT);
  console.log('GitHub token: ' + (GH_TOKEN ? 'configured' : 'MISSING'));
});
