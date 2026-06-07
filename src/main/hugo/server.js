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
    const args = [
      'server',
      '--port', String(port),
      '--bind', '127.0.0.1',
      '--watch',
      '--noHTTPCache',
      '--disableFastRender',
    ];
    if (options.draft) args.push('--buildDrafts');
    if (options.future) args.push('--buildFuture');

    this._state = 'starting';
    this._emit({ type: 'state', state: this._state });
    this.workspaceDir = workspaceDir;
    this.port = port;
    this.baseURL = `http://127.0.0.1:${port}`;

    const proc = spawn(bin, args, {
      cwd: workspaceDir,
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
      this._state = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'crashed';
      this._emit({ type: 'state', state: this._state, code, signal });
      this.proc = null;
    });

    // 等待端口可连接，最多 20s
    const ok = await this._waitForPort(port, 20000);
    if (!ok) {
      const err = new Error(`hugo server 在 20s 内未在端口 ${port} 上响应`);
      try { await this.stop(); } catch (_) { /* noop */ }
      throw err;
    }
    this._state = 'running';
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
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
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
      return this.start(this.workspaceDir);
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
      const tryConnect = () => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch (_) { /* noop */ }
          resolve(ok);
        };
        socket.setTimeout(500);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
        socket.connect(port, '127.0.0.1');
        setTimeout(() => finish(false), 600);
      };
      tryConnect();
      const interval = setInterval(() => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(false);
        } else {
          tryConnect();
        }
      }, 800);
    });
  }
}

module.exports = HugoServer;
