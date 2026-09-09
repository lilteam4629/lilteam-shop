const { spawn } = require('child_process');
const http = require('http');

const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['src/app.js'], {
  cwd: require('path').join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    MONGODB_URI: '',
    DISCORD_BOT_TOKEN: '',
    LICENSE_GATE: 'off',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(path, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, response => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

async function fetchOk(path, expectedType) {
  const response = await request(path);
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`${path} returned HTTP ${response.statusCode}`);
  const type = response.headers['content-type'] || '';
  if (!type.includes(expectedType)) throw new Error(`${path} returned ${type || 'no content type'}`);
  return response;
}

async function run() {
  try {
    let ready = false;
    let lastError = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await request('/health', 1000);
        if (response.statusCode >= 200 && response.statusCode < 300) { ready = true; break; }
        lastError = new Error(`/health returned HTTP ${response.statusCode}`);
      } catch (error) { lastError = error; }
      await wait(500);
    }
    if (!ready) throw new Error(`server did not become healthy: ${lastError && lastError.message}\n${output}`);
    await fetchOk('/health', 'application/json');
    await fetchOk('/', 'text/html');
    await fetchOk('/products', 'text/html');
    await fetchOk('/css/storefront-mobile-v1.css', 'text/css');
    console.log('Smoke checks passed: health, home, products, static assets');
  } finally {
    child.kill('SIGTERM');
  }
}

run().catch(error => {
  console.error(error.message);
  child.kill('SIGKILL');
  process.exitCode = 1;
});
