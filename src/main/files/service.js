'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * 文件服务：管理一个工作区内的 content/posts/*.md 笔记。
 * 所有路径都相对于工作区根目录返回（前端只需要关心相对路径）。
 */
class FileService {
  postsDir(workspaceDir) {
    return path.join(workspaceDir, 'content', 'posts');
  }

  async ensurePostsDir(workspaceDir) {
    await fsp.mkdir(this.postsDir(workspaceDir), { recursive: true });
  }

  async list(workspaceDir) {
    const dir = this.postsDir(workspaceDir);
    if (!fs.existsSync(dir)) return [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      const full = path.join(dir, entry.name);
      const stat = await fsp.stat(full);
      items.push({
        name: entry.name,
        path: path.relative(workspaceDir, full).replace(/\\/g, '/'),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  }

  async read(workspaceDir, relPath) {
    const full = this._safeResolve(workspaceDir, relPath);
    if (!fs.existsSync(full)) throw new Error(`文件不存在: ${relPath}`);
    const content = await fsp.readFile(full, 'utf8');
    const stat = await fsp.stat(full);
    return { path: relPath, content, mtime: stat.mtimeMs };
  }

  async write(workspaceDir, relPath, content) {
    const full = this._safeResolve(workspaceDir, relPath);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = full + '.tmp';
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, full);
    const stat = await fsp.stat(full);
    return { path: relPath, mtime: stat.mtimeMs };
  }

  async create(workspaceDir, baseName) {
    await this.ensurePostsDir(workspaceDir);
    let name = (baseName || 'untitled').replace(/[\\/:*?"<>|]/g, '_');
    if (!name.endsWith('.md')) name += '.md';
    let full = path.join(this.postsDir(workspaceDir), name);
    let i = 1;
    while (fs.existsSync(full)) {
      const stem = name.replace(/\.md$/, '');
      full = path.join(this.postsDir(workspaceDir), `${stem}-${i}.md`);
      i++;
    }
    const date = new Date().toISOString();
    const initial = `---\ntitle: "${path.basename(full, '.md')}"\ndate: ${date}\ndraft: true\n---\n\n# ${path.basename(full, '.md')}\n\n`;
    await fsp.writeFile(full, initial, 'utf8');
    const rel = path.relative(workspaceDir, full).replace(/\\/g, '/');
    return { path: rel, name: path.basename(full) };
  }

  async delete(workspaceDir, relPath) {
    const full = this._safeResolve(workspaceDir, relPath);
    if (!fs.existsSync(full)) return { ok: true, alreadyGone: true };
    await fsp.unlink(full);
    return { ok: true };
  }

  async rename(workspaceDir, relPath, newName) {
    const full = this._safeResolve(workspaceDir, relPath);
    if (!fs.existsSync(full)) throw new Error(`文件不存在: ${relPath}`);
    const safeName = newName.replace(/[\\/:*?"<>|]/g, '_');
    const finalName = safeName.endsWith('.md') ? safeName : safeName + '.md';
    const newFull = path.join(path.dirname(full), finalName);
    if (fs.existsSync(newFull) && path.resolve(newFull) !== path.resolve(full)) {
      throw new Error(`已存在同名文件: ${finalName}`);
    }
    await fsp.rename(full, newFull);
    return {
      oldPath: relPath,
      newPath: path.relative(workspaceDir, newFull).replace(/\\/g, '/'),
    };
  }

  _safeResolve(workspaceDir, relPath) {
    const resolved = path.resolve(workspaceDir, relPath);
    const wsResolved = path.resolve(workspaceDir);
    if (!resolved.startsWith(wsResolved)) {
      throw new Error(`非法的文件路径: ${relPath}`);
    }
    return resolved;
  }
}

module.exports = FileService;
