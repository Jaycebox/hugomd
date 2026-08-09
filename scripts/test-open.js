'use strict';

// 复现"启动后无操作就显示 hugo 出错"。
// 场景：settings.lastWorkspace 指向一个 hugo server 会启动失败的目录
// （例如 hugo.toml 被删、内容损坏，或目录不存在）。
// App 启动 -> tryRestoreLastSession -> openWorkspace -> server.start 失败，
// 观察状态栏最终文本。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');

function run(userData) {
  return new Promise((resolve) => {
    const proc = spawn(electronPath, ['.', '--enable-logging'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        HHAPP_SMOKE_RENDERER: '1',
        HHAPP_SMOKE: 'status-check',
        HHAPP_USER_DATA: userData,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { err += d.toString(); });
    setTimeout(() => {
      proc.kill();
      resolve(err);
    }, 11000);
  });
}

(async () => {
  // 场景 A：lastWorkspace 指向"不存在"的目录 -> openWorkspace 会失败
  {
    const userData = path.join(os.tmpdir(), 'hhapp-status-A');
    if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });
    fs.mkdirSync(userData, { recursive: true });
    const ghost = path.join(userData, 'workspaces', 'ghost'); // 目录不存在
    fs.writeFileSync(path.join(userData, 'settings.json'),
      JSON.stringify({ lastWorkspace: ghost }, null, 2));
    console.log('=== Scenario A: lastWorkspace missing dir ===');
    const err = await run(userData);
    err.split('\n').filter(l => /status-check|server-event/.test(l)).forEach(l => console.log('  ' + l.trim()));
  }

  // 场景 B：lastWorkspace 存在（干净工作区）但内容导致 hugo 构建失败
  {
    const userData = path.join(os.tmpdir(), 'hhapp-status-B');
    if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });
    const broken = path.join(userData, 'workspaces', 'broken');
    fs.mkdirSync(broken, { recursive: true });
    // 干净工作区标识（.hhapp.json）存在，但 posts 里有非法 front matter
    fs.writeFileSync(path.join(broken, '.hhapp.json'), JSON.stringify({ name: 'broken', theme: 'minimal' }, null, 2));
    fs.mkdirSync(path.join(broken, 'posts'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'posts', 'bad.md'),
      '---\nthis is not valid front matter [[[\n---\n\n# Bad');
    fs.writeFileSync(path.join(userData, 'settings.json'),
      JSON.stringify({ lastWorkspace: broken }, null, 2));
    console.log('\n=== Scenario B: broken content (bad front matter) ===');
    const err = await run(userData);
    err.split('\n').filter(l => /status-check|server-event/.test(l)).forEach(l => console.log('  ' + l.trim()));
  }
})();
