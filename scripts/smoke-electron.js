'use strict';

// 启动 electron 完整 app，smoke 模式下让渲染层自动调 flowNewWorkspace。
// 捕获所有 stderr，看创建流程每一步是否成功。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hhapp-smoke-userdata');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });

console.log('Spawning electron with HHAPP_SMOKE_RENDERER=1');
const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HHAPP_SMOKE_RENDERER: '1',
    HHAPP_SMOKE: 'create',
    HHAPP_USER_DATA: userData,   // 覆盖 userData，避免污染真实 Roaming\hhapp
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
let stdout = '';
proc.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write('OUT: ' + d); });
proc.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write('ERR: ' + d); });

(async () => {
  await new Promise((r) => setTimeout(r, 16000));
  console.log('\n=== TEST COMPLETE ===');
  console.log('Userdata:', userData);
  if (fs.existsSync(userData)) {
    const ws = path.join(userData, 'workspaces');
    if (fs.existsSync(ws)) {
      console.log('workspaces created:', fs.readdirSync(ws));
    } else {
      console.log('NO workspaces dir created');
    }
  }
  proc.kill();
  process.exit(0);
})();
