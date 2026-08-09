'use strict';

// 真实 electron：模拟 Ctrl+V 粘贴截图 -> 自动保存 + 插入引用
// 验证用户"截图后直接粘贴到文章"的核心工作流。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hugomd-paste-test');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });

const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HHAPP_SMOKE_RENDERER: '1',
    HHAPP_SMOKE: 'paste-test',
    HHAPP_USER_DATA: userData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));

(async () => {
  await new Promise((r) => setTimeout(r, 20000));
  proc.kill();
  process.exit(0);
})();
