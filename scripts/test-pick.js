'use strict';

// 复现"选择自定义路径创建，却进了默认路径"。
// 模拟用户：打开新建工作区对话框 -> 把路径输入框改为自定义路径 -> 点创建。
// 观察工作区实际创建到哪里。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hugomd-pick-test');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

// 模拟用户选择的自定义目录（不在 userData 下）
const customRoot = path.join(os.tmpdir(), 'hugomd-custom-root');
if (fs.existsSync(customRoot)) fs.rmSync(customRoot, { recursive: true, force: true });
fs.mkdirSync(customRoot, { recursive: true });

const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HUGOMD_SMOKE_RENDERER: '1',
    HUGOMD_SMOKE: 'create-pick',
    HUGOMD_USER_DATA: userData,
    HUGOMD_CUSTOM_ROOT: customRoot,
    HUGOMD_MOCK_PICK_DIR: customRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
proc.stdout.on('data', (d) => { process.stdout.write('OUT: ' + d); });
proc.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write('ERR: ' + d); });

(async () => {
  await new Promise((r) => setTimeout(r, 20000));
  console.log('\n=== PICK TEST COMPLETE ===');
  console.log('customRoot:', customRoot);
  console.log('customRoot exists:', fs.existsSync(customRoot));
  console.log('customRoot children:', fs.existsSync(customRoot) ? fs.readdirSync(customRoot) : 'N/A');
  const ws = path.join(userData, 'workspaces');
  console.log('default workspaces dir:', fs.existsSync(ws) ? fs.readdirSync(ws) : 'N/A');
  proc.kill();
  process.exit(0);
})();
