'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const https = require('https');
const { URL } = require('url');

const BINARY_NAME = process.platform === 'win32' ? 'hugo.exe' : 'hugo';

/**
 * Hugo 二进制来源优先级：
 *   1. 用户在设置里手动指定的路径（settings.hugoPath）
 *   2. 嵌入的二进制（userData/bin/hugo[.exe]），缺失则自动从 GitHub 下载
 *   3. PATH 中的 hugo
 *
 * 该模块不负责 server 启动，只负责"找出 hugo 可执行文件在哪、跑一下能不能跑"。
 */
class HugoManager {
  constructor({ userDataDir, resourcesDir, settings }) {
    this.userDataDir = userDataDir;
    this.binDir = path.join(userDataDir, 'bin');
    this.embeddedDir = path.join(resourcesDir, 'bin');
    this.settings = settings;
    this.version = require('../../../package.json').hugoVersion || '0.152.2';
    this._resolving = null;
  }

  async init() {
    await fs.promises.mkdir(this.binDir, { recursive: true });
    const local = path.join(this.binDir, BINARY_NAME);
    if (await this._isExecutable(local)) {
      return;
    }
    if (await this._isExecutable(path.join(this.embeddedDir, BINARY_NAME))) {
      await fs.promises.copyFile(
        path.join(this.embeddedDir, BINARY_NAME),
        local,
      );
      if (process.platform !== 'win32') {
        await fs.promises.chmod(local, 0o755);
      }
    }
  }

  status() {
    return {
      embeddedExists: fs.existsSync(path.join(this.embeddedDir, BINARY_NAME)),
      userBinExists: fs.existsSync(path.join(this.binDir, BINARY_NAME)),
      manualPath: this.settings.get('hugoPath', null) || null,
      source: this._pickSourceSync(),
    };
  }

  _pickSourceSync() {
    const manual = this.settings.get('hugoPath', null);
    if (manual && fs.existsSync(manual)) return 'manual';
    if (fs.existsSync(path.join(this.binDir, BINARY_NAME))) return 'embedded';
    return 'path';
  }

  /**
   * 解析出当前应使用的 hugo 可执行文件绝对路径。
   * 不会自动下载；如需下载请显式调用 ensureBinary()。
   */
  async resolve() {
    if (this._resolving) return this._resolving;
    this._resolving = this._doResolve();
    try {
      return await this._resolving;
    } finally {
      this._resolving = null;
    }
  }

  async _doResolve() {
    const manual = this.settings.get('hugoPath', null);
    if (manual) {
      if (await this._isExecutable(manual)) return manual;
      throw new Error(`设置中指定的 hugo 路径无效：${manual}`);
    }
    const local = path.join(this.binDir, BINARY_NAME);
    if (await this._isExecutable(local)) return local;
    const fromPath = await this._which('hugo');
    if (fromPath) return fromPath;
    throw new Error(
      '未找到可用的 hugo 二进制。请在设置中手动指定 hugo 路径，或调用 ensureBinary() 自动下载。',
    );
  }

  /**
   * 确保有可用的 hugo：先检查本地/嵌入，再检查 PATH，都不行就下载。
   * 返回最终使用的可执行文件绝对路径。
   */
  async ensureBinary({ onProgress } = {}) {
    try {
      return await this.resolve();
    } catch (_) {
      /* 需要下载 */
    }
    await this.download({ onProgress });
    return this.resolve();
  }

  /**
   * 从 GitHub release 下载 hugo extended 到 userData/bin。
   */
  async download({ onProgress } = {}) {
    const target = path.join(this.binDir, BINARY_NAME);
    const url = this._releaseUrl();
    onProgress && onProgress({ stage: 'start', url });
    await this._downloadFile(url, target, onProgress);
    if (process.platform !== 'win32') {
      await fs.promises.chmod(target, 0o755);
    }
    onProgress && onProgress({ stage: 'done', path: target });
  }

  _releaseUrl() {
    const v = this.version;
    if (process.platform === 'win32') {
      return `https://github.com/gohugoio/hugo/releases/download/v${v}/hugo_extended_${v}_windows-amd64.zip`;
    }
    if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      return `https://github.com/gohugoio/hugo/releases/download/v${v}/hugo_extended_${v}_macOS-${arch}.tar.gz`;
    }
    return `https://github.com/gohugoio/hugo/releases/download/v${v}/hugo_extended_${v}_linux-amd64.tar.gz`;
  }

  _downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.get(parsed, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败：HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const tmpZip = dest + '.download';
        const out = fs.createWriteStream(tmpZip);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) {
            onProgress({ stage: 'progress', received, total });
          }
        });
        res.pipe(out);
        out.on('finish', async () => {
          out.close();
          try {
            await this._extractArchive(tmpZip, dest);
            await fs.promises.unlink(tmpZip);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        out.on('error', reject);
      });
      req.on('error', reject);
    });
  }

  async _extractArchive(archivePath, target) {
    const dir = path.dirname(target);
    if (archivePath.endsWith('.zip')) {
      const { spawn } = require('child_process');
      if (process.platform === 'win32') {
        await this._run('powershell', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${dir}" -Force`,
        ]);
        // zip 里有 hugo_extended_xxx/ 目录
        const extracted = await this._findHugoBinaryInDir(dir);
        if (extracted && extracted !== target) {
          await fs.promises.rename(extracted, target);
        }
      } else {
        await this._run('unzip', ['-o', archivePath, '-d', dir]);
        const extracted = await this._findHugoBinaryInDir(dir);
        if (extracted && extracted !== target) {
          await fs.promises.rename(extracted, target);
        }
      }
    } else {
      await this._run('tar', ['-xzf', archivePath, '-C', dir]);
      const extracted = await this._findHugoBinaryInDir(dir);
      if (extracted && extracted !== target) {
        await fs.promises.rename(extracted, target);
      }
    }
  }

  async _findHugoBinaryInDir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name === 'hugo' || entry.name === 'hugo.exe')) {
        return path.join(dir, entry.name);
      }
    }
    return null;
  }

  _run(cmd, args) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      p.on('error', reject);
      p.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
  }

  /**
   * 跑一次 `hugo version`，确认二进制能正常用。
   */
  async checkVersion(binPath) {
    return new Promise((resolve, reject) => {
      execFile(binPath, ['version'], { timeout: 10000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      });
    });
  }

  async _isExecutable(p) {
    try {
      const st = await fs.promises.stat(p);
      if (!st.isFile()) return false;
      if (process.platform === 'win32') return true;
      // 检查 owner 是否可执行位
      await fs.promises.access(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  _which(name) {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFile(cmd, [name], (err, stdout) => {
        if (err) return resolve(null);
        const first = stdout.split(/\r?\n/).filter(Boolean)[0];
        resolve(first || null);
      });
    });
  }
}

module.exports = HugoManager;
