'use strict';

// 复现：hugo server 正常启动后 stop()，渲染层收到的 state 序列。
// 验证 stop 是否误报 crashed。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hugomd-stop-test');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const wsDir = path.join(userData, 'workspaces', 'myblog');
fs.mkdirSync(path.join(wsDir, 'content', 'posts'), { recursive: true });
fs.mkdirSync(path.join(wsDir, 'themes', 'minimal'), { recursive: true });
fs.cpSync(path.join(__dirname, '..', 'src', 'resources', 'themes', 'minimal'),
          path.join(wsDir, 'themes', 'minimal'), { recursive: true });
const toml = fs.readFileSync(path.join(__dirname, '..', 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
  .replace('${SITE_NAME}', 'myblog').replace('${THEME}', 'minimal');
fs.writeFileSync(path.join(wsDir, 'hugo.toml'), toml);
fs.writeFileSync(path.join(wsDir, 'content', 'posts', 'welcome.md'),
  '---\ntitle: hello\ndate: 2026-01-01\n---\n\n# Hello');

const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HHAPP_SMOKE_RENDERER: '1',
    HHAPP_USER_DATA: userData,
    HHAPP_SMOKE: 'stop-test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
proc.stdout.on('data', (d) => { process.stdout.write(d); });
proc.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write('ERR: ' + d); });

(async () => {
  await new Promise((r) => setTimeout(r, 12000));
  console.log('\n=== STOP TEST COMPLETE ===');
  proc.kill();
  process.exit(0);
})();
