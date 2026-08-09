const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'hugomd-e2e');
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'content', 'posts'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'themes', 'minimal'), { recursive: true });
fs.cpSync(path.join(__dirname, '..', 'src', 'resources', 'themes', 'minimal'), path.join(tmp, 'themes', 'minimal'), { recursive: true });
const toml = fs.readFileSync(path.join(__dirname, '..', 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
  .replace('${SITE_NAME}', 'e2e')
  .replace('${THEME}', 'minimal');
fs.writeFileSync(path.join(tmp, 'hugo.toml'), toml);
fs.writeFileSync(path.join(tmp, 'content', 'posts', 'a.md'), '---\ntitle: A\n---\n\n# First post');

const proc = spawn('hugo', [
  'server', '-s', tmp, '--port', '14534', '--bind', '127.0.0.1',
  '--watch', '--noHTTPCache', '--disableFastRender',
], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stdout.on('data', (d) => { /* ignore */ });
proc.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(6000);
  const r1 = await fetch('http://127.0.0.1:14534/');
  console.log('Initial:', r1.status);
  fs.writeFileSync(path.join(tmp, 'content', 'posts', 'a.md'), '---\ntitle: A2\n---\n\n# Updated content\n\n**bold** here');
  await sleep(2000);
  const r2 = await fetch('http://127.0.0.1:14534/posts/a/');
  const t = await r2.text();
  console.log('Updated:', r2.status, 'len:', t.length, 'hasUpdated:', t.includes('Updated content'));
  proc.kill();
  process.exit(0);
})();
