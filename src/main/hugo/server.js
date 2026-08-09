'use strict';

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const readline = require('readline');

/**
 * hugo server 生命周期管理。
 *
 * 设计要点：
 * - 启动 `hugo server --watch --port <随机>` 在 hugo 站点根目录
 * - 持续读取 stdout/stderr，过滤出 "Web Server is available" 之后才视为启动成功
 * - 提供 stop() 优雅关闭（SIGTERM / Windows 下 taskkill）
 */
class HugoServer {
  constructor({ hugo }) {
    this.hugo = hugo;
    this.proc = null;
    this.workspaceDir = null;
    this.port = null;
    this.baseURL = null;
    this._stdoutBuf = '';
    this._stderrBuf = '';
    this._state = 'idle';
    this._listeners = new Set();
    this._restartTimer = null;
    this._stopRequested = false;
    this._crashCount = 0;
    this._autoRestart = true;
  }

  isRunning() {
    return this._state === 'running';
  }

  state() {
    return this._state;
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this._listeners) {
      try { fn(event); } catch (e) { /* noop */ }
    }
  }

  async start(workspaceDir, options = {}) {
    if (this.proc) {
      await this.stop();
    }
    const port = options.port || (await this._freePort());
    const bin = await this.hugo.resolve();
    // 站点模板目录：提供则用 -s <template> -c <workspace>（工作区只含 markdown）
    // 不提供则工作区本身就是完整站点（旧模式，兼容）
    const siteDir = options.siteTemplateDir || workspaceDir;
    const contentDir = options.siteTemplateDir ? workspaceDir : null;
    const args = [
      'server',
      '--port', String(port),
      '--bind', '127.0.0.1',
      '--watch',
      '--noHTTPCache',
      '--disableFastRender',
    ];
    if (contentDir) args.push('-c', contentDir);
    if (options.draft) args.push('--buildDrafts');
    if (options.future) args.push('--buildFuture');

    this._state = 'starting';
    this._emit({ type: 'state', state: this._state });
    this.workspaceDir = workspaceDir;
    this.siteTemplateDir = siteDir;
    this.port = port;
    this.baseURL = `http://127.0.0.1:${port}`;
    this._stopRequested = false;
    // 手动 start（或首次启动）时重置崩溃计数；内部自动重启时不重置
    if (!options._internalRestart) this._crashCount = 0;

    const proc = spawn(bin, args, {
      cwd: siteDir,
      env: { ...process.env, HUGO_ENV: options.env || 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;

    const out = readline.createInterface({ input: proc.stdout });
    const err = readline.createInterface({ input: proc.stderr });
    out.on('line', (line) => this._handleLine('stdout', line));
    err.on('line', (line) => this._handleLine('stderr', line));

    proc.on('error', (e) => {
      this._state = 'error';
      this._emit({ type: 'state', state: this._state, error: String(e) });
    });
    proc.on('exit', (code, signal) => {
      // 主动 stop() 被杀不算崩溃；只有进程自己意外退出才标记 crashed
      const intentional = this._stopRequested;
      this._stopRequested = false;
      this.proc = null;
      if (intentional || code === 0 || signal === 'SIGTERM') {
        this._state = 'stopped';
        this._emit({ type: 'state', state: this._state, code, signal });
        return;
      }
      // 意外崩溃：自动重启（带退避，最多重试 2 次）
      this._state = 'crashed';
      this._emit({ type: 'state', state: this._state, code, signal });
      if (this._autoRestart && this._crashCount < 2 && this.workspaceDir) {
        this._crashCount++;
        const delay = 800 * this._crashCount;
        process.stderr.write(`[hugomd] hugo crashed (code=${code}), retry ${this._crashCount}/2 in ${delay}ms\n`);
        this._restartTimer = setTimeout(() => {
          this.start(this.workspaceDir, { draft: true, siteTemplateDir: this.siteTemplateDir, _internalRestart: true }).catch((e) => {
            process.stderr.write(`[hugomd] hugo auto-restart failed: ${e.message}\n`);
          });
        }, delay);
      }
    });

    // 等待端口可连接，最多 20s
    const ok = await this._waitForPort(port, 20000);
    if (!ok) {
      const err = new Error(`hugo server 在 20s 内未在端口 ${port} 上响应`);
      try { await this.stop(); } catch (_) { /* noop */ }
      throw err;
    }
    this._state = 'running';
    this._crashCount = 0;
    this._emit({ type: 'state', state: this._state, baseURL: this.baseURL, port: this.port });
    return { baseURL: this.baseURL, port: this.port };
  }

  _handleLine(stream, line) {
    this._emit({ type: 'log', stream, line });
    if (stream === 'stderr' && /error/i.test(line)) {
      this._emit({ type: 'error-log', line });
    }
  }

  async stop() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    this._stopRequested = true;
    if (process.platform === 'win32') {
      try {
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
          killer.on('exit', () => resolve());
          killer.on('error', () => resolve());
        });
      } catch (_) { /* noop */ }
    } else {
      try { proc.kill('SIGTERM'); } catch (_) { /* noop */ }
    }
    // 兜底：最多等 3s
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async restart(workspaceDir) {
    if (workspaceDir) this.workspaceDir = workspaceDir;
    if (this.workspaceDir) {
      return this.start(this.workspaceDir, { siteTemplateDir: this.siteTemplateDir });
    }
    throw new Error('no workspace to restart');
  }

  _freePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }

  _waitForPort(port, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      let interval = null;

      const finish = (ok, reason) => {
        if (resolved) return;
        resolved = true;
        if (interval) clearInterval(interval);
        if (!ok) {
          process.stderr.write(`[hugomd] hugo wait-for-port ${port} failed: ${reason}\n`);
        }
        resolve(ok);
      };

      const tryConnect = () => {
        if (resolved) return;
        if (Date.now() - start > timeoutMs) {
          finish(false, 'timeout');
          return;
        }
        const socket = new net.Socket();
        let settled = false;
        const onResult = (ok, reason) => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch (_) { /* noop */ }
          if (ok) finish(true);
          // 失败时让下一次 interval tick 继续重试
        };
        socket.setTimeout(500);
        socket.once('connect', () => onResult(true));
        socket.once('error', (err) => onResult(false, err.code || err.message));
        socket.once('timeout', () => onResult(false, 'socket-timeout'));
        socket.connect(port, '127.0.0.1');
      };

      tryConnect();
      interval = setInterval(tryConnect, 500);
    });
  }
}

module.exports = HugoServer;
