'use strict';

/**
 * hhAPP 测试套件入口。
 * 用 Node 原生 runner 逐个跑所有测试，汇总结果。
 *
 * 用法:
 *   node scripts/run-tests.js            # 跑全部
 *   node scripts/run-tests.js e2e       # 只跑 e2e
 *   node scripts/run-tests.js smoke     # 只跑 electron 渲染层 smoke
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const TESTS = {
  syntax: {
    desc: '全部 JS 语法检查',
    run() {
      const files = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.name === 'node_modules' || e.name === 'vendor') continue;
          if (e.isDirectory()) walk(full);
          else if (e.name.endsWith('.js')) files.push(full);
        }
      };
      walk(path.join(ROOT, 'src'));
      walk(path.join(ROOT, 'scripts'));
      let failed = 0;
      for (const f of files) {
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        if (r.status !== 0) {
          failed++;
          console.error('  [FAIL] ' + f);
          console.error((r.stderr || '').split('\n').slice(0, 3).join('\n'));
        }
      }
      return { pass: failed === 0, detail: `${files.length} files checked, ${failed} failed` };
    },
  },
  themes: {
    desc: '3 个内置主题 hugo build 可渲染',
    run() {
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hhapp-test-themes-'));
      fs.mkdirSync(path.join(tmp, 'themes'), { recursive: true });
      for (const t of ['minimal', 'terminal', 'paper']) {
        fs.cpSync(path.join(ROOT, 'src', 'resources', 'themes', t), path.join(tmp, 'themes', t), { recursive: true });
      }
      fs.writeFileSync(path.join(tmp, 'hugo.toml'),
        fs.readFileSync(path.join(ROOT, 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
          .replace('${SITE_NAME}', 'test').replace('${THEME}', 'minimal'));
      fs.mkdirSync(path.join(tmp, 'content', 'posts'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'content', 'posts', 'a.md'), '---\ntitle: A\ndate: 2026-01-01\n---\n\n# Hi');
      const hugo = process.env.HUGO_BIN || 'hugo';
      let allOk = true;
      for (const t of ['minimal', 'terminal', 'paper']) {
        fs.writeFileSync(path.join(tmp, 'hugo.toml'),
          fs.readFileSync(path.join(ROOT, 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
            .replace('${SITE_NAME}', 'test').replace('${THEME}', t));
        const out = path.join(tmp, 'public-' + t);
        const r = spawnSync(hugo, ['-s', tmp, '-d', out], { encoding: 'utf8' });
        const ok = r.status === 0 && fs.existsSync(path.join(out, 'index.html'));
        if (!ok) { allOk = false; console.error(`  [FAIL] theme ${t}: ${(r.stderr||'').split('\n')[0]}`); }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      return { pass: allOk, detail: 'minimal/terminal/paper' };
    },
  },
  e2e: {
    desc: 'hugo server --watch 实时重建',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-e2e.js')], { encoding: 'utf8' });
      const pass = /Initial: 200/.test(r.stdout) && /hasUpdated: true/.test(r.stdout);
      return { pass, detail: r.stdout.split('\n').slice(0, 3).join(' ') };
    },
  },
  createUnit: {
    desc: 'workspace.create 单元测试（含错误分支）',
    async run() {
      const os = require('os');
      const WorkspaceManager = require(path.join(ROOT, 'src', 'main', 'workspace', 'manager'));
      const fakeHugo = { embeddedDir: path.join(ROOT, 'src', 'resources', 'bin') };
      const fakeSettings = {
        filePath: path.join(os.tmpdir(), 'hhapp-unit-settings.json'),
        data: {},
        get(k, d) { return k in this.data ? this.data[k] : d; },
        set(k, v) { this.data[k] = v; },
        all() { return { ...this.data }; },
      };
      const wm = new WorkspaceManager({ hugo: fakeHugo, settings: fakeSettings });

      const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hhapp-create-unit-'));

      const checks = [];
      const check = (name, pass, extra) => {
        checks.push({ name, pass, extra });
        if (!pass) console.error(`  [FAIL] ${name}${extra ? ': ' + extra : ''}`);
      };

      // 1. 缺 dir / 缺 name
      try { await wm.create({}); check('缺 dir 应抛错', false, '未抛错'); }
      catch (e) { check('缺 dir 应抛错', e.message.includes('工作区目录'), e.message); }
      try { await wm.create({ dir: mkTmp() }); check('缺 name 应抛错', false, '未抛错'); }
      catch (e) { check('缺 name 应抛错', e.message.includes('工作区名称'), e.message); }

      // 2. 非法主题
      try { await wm.create({ dir: mkTmp(), name: 'x', theme: 'nope' }); check('非法主题应抛错', false, '未抛错'); }
      catch (e) { check('非法主题应抛错', e.message.includes('未知主题'), e.message); }

      // 3. 目录非空应抛错
      const nonEmpty = mkTmp();
      fs.writeFileSync(path.join(nonEmpty, 'foo.txt'), 'x');
      try { await wm.create({ dir: nonEmpty, name: 'x', theme: 'minimal' }); check('非空目录应抛错', false, '未抛错'); }
      catch (e) { check('非空目录应抛错', e.message.includes('不为空'), e.message); }

      // 4. 正常创建：工作区只含 markdown + 元数据；主题/配置在站点模板
      const ok = mkTmp();
      const target = path.join(ok, 'myblog');
      const created = await wm.create({ dir: target, name: 'myblog', theme: 'terminal' });
      check('正常创建返回 path/name/theme', created.path === target && created.name === 'myblog' && created.theme === 'terminal');
      check('工作区无 hugo.toml（纯 markdown）', !fs.existsSync(path.join(target, 'hugo.toml')));
      check('工作区无 themes', !fs.existsSync(path.join(target, 'themes')));
      check('.hhapp.json 元数据存在', fs.existsSync(path.join(target, '.hhapp.json')));
      check('posts 已创建（content 根）', fs.existsSync(path.join(target, 'posts')));
      check('welcome.md 已写', fs.existsSync(path.join(target, 'posts', 'welcome.md')));

      // 站点模板独立于工作区，含主题与配置
      const template = await wm.ensureSiteTemplate('terminal');
      check('站点模板含 hugo.toml', fs.existsSync(path.join(template, 'hugo.toml')));
      check('站点模板含主题 layouts', fs.existsSync(path.join(template, 'themes', 'terminal', 'layouts', '_default', 'single.html')));
      check('站点模板不含工作区内容', !fs.existsSync(path.join(template, 'posts', 'welcome.md')));

      fs.rmSync(ok, { recursive: true, force: true });

      const failed = checks.filter(c => !c.pass);
      return { pass: failed.length === 0, detail: `${checks.length} checks, ${failed.length} failed` };
    },
  },
  serverUnit: {
    desc: 'hugo server 生命周期：启动→停止不误报 crashed',
    async run() {
      const os = require('os');
      const HugoServer = require(path.join(ROOT, 'src', 'main', 'hugo', 'server'));
      const hugoBin = process.env.HUGO_BIN || 'hugo';
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hhapp-server-unit-'));
      fs.mkdirSync(path.join(tmp, 'themes', 'minimal'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'src', 'resources', 'themes', 'minimal'),
        path.join(tmp, 'themes', 'minimal'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'hugo.toml'),
        fs.readFileSync(path.join(ROOT, 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
          .replace('${SITE_NAME}', 'test').replace('${THEME}', 'minimal'));
      fs.mkdirSync(path.join(tmp, 'content', 'posts'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'content', 'posts', 'a.md'), '---\ntitle: A\ndate: 2026-01-01\n---\n\n# Hi');

      const events = [];
      const server = new HugoServer({ hugo: { resolve: async () => hugoBin } });
      server.on((ev) => { if (ev.type === 'state') events.push(ev.state); });

      const checks = [];
      const check = (name, pass, extra) => {
        checks.push({ name, pass, extra });
        if (!pass) console.error(`  [FAIL] ${name}${extra ? ': ' + extra : ''}`);
      };

      // 1. 正常启动
      await server.start(tmp, { draft: true });
      check('启动后状态为 running', server.state() === 'running', server.state());
      check('事件序列含 starting->running', events.includes('starting') && events.includes('running'), events.join(','));
      check('baseURL 已设置', !!server.baseURL, server.baseURL);

      // 2. 主动 stop 不应标记 crashed
      events.length = 0;
      await server.stop();
      await new Promise((r) => setTimeout(r, 500));
      check('stop 后状态为 stopped', server.state() === 'stopped', server.state());
      check('stop 事件为 stopped 而非 crashed', events.length === 0 || events[events.length - 1] === 'stopped', events.join(','));

      // 3. 重启应能再次 running
      await server.start(tmp, { draft: true });
      check('重启后再次 running', server.state() === 'running', server.state());
      await server.stop();
      await new Promise((r) => setTimeout(r, 300));

      fs.rmSync(tmp, { recursive: true, force: true });
      const failed = checks.filter(c => !c.pass);
      return { pass: failed.length === 0, detail: `${checks.length} checks, ${failed.length} failed` };
    },
  },
  fileService: {
    desc: 'FileService：page bundle 与图片资源管理',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-files.js')], { encoding: 'utf8' });
      const pass = /ALL PASS/.test(r.stdout) && !/FAIL/.test(r.stdout);
      return { pass, detail: r.stdout.split('\n').filter(l => /✗|ALL PASS/.test(l)).slice(-2).join(' ') };
    },
  },
  rename: {
    desc: '真实 Electron：重命名帖子不报 "object could not be cloned"',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-rename.js')], {
        encoding: 'utf8',
        timeout: 30000,
      });
      const combined = r.stdout + r.stderr;
      const pass = /rename OK/.test(combined) && !/could not be cloned|FAILED/.test(combined);
      return { pass, detail: 'rename via IPC OK' };
    },
  },
  deleteCancel: {
    desc: '真实 UI：删除确认点"取消"不删除',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-delete.js')], {
        encoding: 'utf8',
        timeout: 30000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /welcome still there: true/.test(combined) &&
        /on disk: true/.test(combined) &&
        /"ok": true/.test(combined);
      return { pass, detail: 'cancel keeps file' };
    },
  },
  uiFlow: {
    desc: '真实 UI：点加号新建文章 + 点铅笔重命名',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-ui-flow.js')], {
        encoding: 'utf8',
        timeout: 45000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /sidebar items after create: 2/.test(combined) &&
        /new-article/.test(combined) &&
        /sidebar items after rename: 2/.test(combined) &&
        /renamed-article/.test(combined) &&
        /"ok": true/.test(combined);
      return { pass, detail: 'create -> sidebar shows new, rename -> shows renamed' };
    },
  },
  cleanWs: {
    desc: '干净工作区：只含 markdown，主题/配置在站点模板',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-clean-ws.js')], {
        encoding: 'utf8',
        timeout: 30000,
      });
      const pass = /ALL PASS/.test(r.stdout) && !/FAIL/.test(r.stdout);
      return { pass, detail: 'workspace clean + template separate + renders' };
    },
  },
  imageFlow: {
    desc: '真实 Electron：创建 bundle 帖子 + 上传/读取/引用图片',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-image-flow.js')], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /"ok": true/.test(combined) &&
        /"isBundle":true/.test(combined) &&
        /read image mime: image\/png/.test(combined) &&
        /post content contains img ref: true/.test(combined);
      return { pass, detail: 'bundle created, image saved/read/inserted' };
    },
  },
  pasteImage: {
    desc: '真实 Electron：Ctrl+V 粘贴截图自动保存并插入引用',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-paste.js')], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /"ok": true/.test(combined) &&
        /defaultPrevented: true/.test(combined) &&
        /"images": 1/.test(combined) &&
        /contentHasRef: true/.test(combined);
      return { pass, detail: 'paste -> saved to post dir + ![](ref) inserted' };
    },
  },
  bundleE2E: {
    desc: 'Bundle 帖子 + 图片在 hugo server 完整渲染',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-bundle-e2e.js')], {
        encoding: 'utf8',
        timeout: 30000,
      });
      const pass = /"listOk":true,"postOk":true,"imgOk":true/.test(r.stdout);
      return { pass, detail: r.stdout.split('\n').filter(l => l.startsWith('Home:')).join(' | ') };
    },
  },
  pickCustom: {
    desc: '新建工作区：选择自定义路径后创建到该路径（非默认）',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-pick.js')], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /dir input value after pick: C:/.test(combined) &&
        /workspaceDir": "C:/.test(combined) &&
        /customRoot children: \[ 'pick-/.test(combined) &&
        /default workspaces dir: N\/A/.test(combined);
      return { pass, detail: 'picked path used, default untouched' };
    },
  },
  serverStatus: {
    desc: '启动恢复：hugo 崩溃自动重试 + 状态栏不误报',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'test-open.js')], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /Scenario A[\s\S]*status-after-idle => className=server-status\|text=hugo 未运行\|serverState=idle/.test(combined) &&
        /Scenario B[\s\S]*text=hugo 已停止/.test(combined) &&
        !/TypeError|ReferenceError/.test(combined);
      return { pass, detail: 'missing-dir=idle, broken-config=stopped' };
    },
  },
  smoke: {
    desc: 'Electron 真实 UI 点击创建工作区（modal→表单→创建→server running）',
    run() {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'smoke-electron.js')], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const combined = r.stdout + r.stderr;
      const pass =
        /uiDone":\s*true/.test(combined) &&
        /"state":\s*"running"/.test(combined) &&
        !/workspace create FAILED|CREATE FAILED|TypeError|ReferenceError/.test(combined);
      return { pass, detail: 'ui clicked + server running' };
    },
  },
};

const only = process.argv[2];

(async () => {
  let allPass = true;
  for (const [name, t] of Object.entries(TESTS)) {
    if (only && name !== only) continue;
    process.stdout.write(`\n▶ ${t.desc}\n`);
    const start = Date.now();
    let result;
    try {
      result = await t.run();
    } catch (e) {
      result = { pass: false, detail: e.message };
    }
    const ms = Date.now() - start;
    console.log(`  ${result.pass ? '✓ PASS' : '✗ FAIL'} (${ms}ms) ${result.detail || ''}`);
    if (!result.pass) allPass = false;
  }
  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(allPass ? 0 : 1);
})();
