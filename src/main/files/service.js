'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.tiff', '.heic', '.heif'];

/**
 * 文件服务：管理工作区内容。
 *
 * 内容模型（符合 Hugo page bundle 约定）：
 *   - 裸帖子：content/posts/foo.md
 *   - page bundle：content/posts/foo/index.md + 同目录图片资源
 *   - 图片资源：位于 bundle 目录内（index.md 同目录或其子目录）
 *
 * 所有路径都相对于工作区根目录返回（前端只用相对路径）。
 */
class FileService {
  postsDir(workspaceDir) {
    // 新结构：工作区根即 content 根，posts 直接在工作区下
    // 兼容旧结构：如果工作区有 content/posts（老版完整站点），用它
    if (fs.existsSync(path.join(workspaceDir, 'content', 'posts'))) {
      return path.join(workspaceDir, 'content', 'posts');
    }
    return path.join(workspaceDir, 'posts');
  }

  async ensurePostsDir(workspaceDir) {
    await fsp.mkdir(this.postsDir(workspaceDir), { recursive: true });
  }

  /**
   * 列出所有帖子。返回结构：
   *   { name, path, isBundle, imageCount, size, mtime }
   *   - 裸帖子: path = content/posts/foo.md, isBundle=false
   *   - bundle: path = content/posts/foo/index.md, isBundle=true
   */
  async list(workspaceDir) {
    const dir = this.postsDir(workspaceDir);
    if (!fs.existsSync(dir)) return [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = await fsp.stat(full);
        items.push({
          name: entry.name,
          path: path.relative(workspaceDir, full).replace(/\\/g, '/'),
          isBundle: false,
          imageCount: 0,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      } else if (entry.isDirectory()) {
        // page bundle：目录内有 index.md
        const indexFile = path.join(full, 'index.md');
        if (!fs.existsSync(indexFile)) continue;
        const stat = await fsp.stat(indexFile);
        const imageCount = await this._countImages(full);
        items.push({
          name: entry.name,
          path: path.relative(workspaceDir, indexFile).replace(/\\/g, '/'),
          isBundle: true,
          imageCount,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  }

  async _countImages(bundleDir) {
    const files = await this._walkFiles(bundleDir);
    return files.filter((f) => this._isImage(f)).length;
  }

  _walkFiles(dir, prefix = '') {
    return new Promise((resolve, reject) => {
      const results = [];
      (async () => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = prefix ? path.join(prefix, entry.name) : entry.name;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const sub = await this._walkFiles(full, rel);
            results.push(...sub);
          } else {
            results.push(rel);
          }
        }
        resolve(results);
      })().catch(reject);
    });
  }

  _isImage(fileName) {
    return IMAGE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
  }

  /**
   * 列出某帖子的图片资源。postPath 是帖子的 md 相对路径。
   * 返回相对 workspace 的图片路径数组（带相对 bundle 的引用路径）。
   */
  async listImages(workspaceDir, postPath) {
    const mdFull = this._safeResolve(workspaceDir, postPath);
    if (!fs.existsSync(mdFull)) throw new Error(`帖子不存在: ${postPath}`);
    const bundleDir = path.dirname(mdFull);
    const files = await this._walkFiles(bundleDir);
    const images = [];
    for (const rel of files) {
      if (!this._isImage(rel)) continue;
      const full = path.join(bundleDir, rel);
      const stat = await fsp.stat(full);
      images.push({
        // 相对 bundle 的引用路径（写进 MD 里用）
        ref: rel.replace(/\\/g, '/'),
        // 相对 workspace 的完整路径
        path: path.relative(workspaceDir, full).replace(/\\/g, '/'),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    images.sort((a, b) => a.ref.localeCompare(b.ref));
    return images;
  }

  /**
   * 读取图片，返回 base64（前端可直接预览）。
   */
  async readImage(workspaceDir, imagePath) {
    const full = this._safeResolve(workspaceDir, imagePath);
    if (!fs.existsSync(full)) throw new Error(`图片不存在: ${imagePath}`);
    const buf = await fsp.readFile(full);
    const ext = path.extname(full).toLowerCase().replace('.', '') || 'png';
    return {
      path: imagePath,
      mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      data: buf.toString('base64'),
      size: buf.length,
    };
  }

  /**
   * 保存图片到帖子 bundle 目录（或裸帖所在目录）。
   * postPath: 帖子的 md 相对路径；fileName: 目标文件名；data: Buffer。
   * 返回 { ref, path }（ref 是写进 MD 的相对引用）。
   */
  async saveImage(workspaceDir, postPath, fileName, data) {
    const mdFull = this._safeResolve(workspaceDir, postPath);
    if (!fs.existsSync(mdFull)) throw new Error(`帖子不存在: ${postPath}`);
    const bundleDir = path.dirname(mdFull);
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
    if (!this._isImage(safeName)) throw new Error(`不支持的图片格式: ${safeName}`);

    const full = path.join(bundleDir, safeName);
    await fsp.writeFile(full, data);
    return {
      ref: safeName,
      path: path.relative(workspaceDir, full).replace(/\\/g, '/'),
    };
  }

  /**
   * 删除帖子 bundle 内的图片。
   */
  async deleteImage(workspaceDir, imagePath) {
    const full = this._safeResolve(workspaceDir, imagePath);
    if (!fs.existsSync(full)) return { ok: true, alreadyGone: true };
    await fsp.unlink(full);
    return { ok: true };
  }

  /**
   * 重命名图片（同时返回新旧 ref，方便前端更新正文引用）。
   */
  async renameImage(workspaceDir, imagePath, newName) {
    const full = this._safeResolve(workspaceDir, imagePath);
    if (!fs.existsSync(full)) throw new Error(`图片不存在: ${imagePath}`);
    const safeName = newName.replace(/[\\/:*?"<>|]/g, '_');
    if (!this._isImage(safeName)) throw new Error(`不支持的图片格式: ${safeName}`);
    const newFull = path.join(path.dirname(full), safeName);
    if (fs.existsSync(newFull) && path.resolve(newFull) !== path.resolve(full)) {
      throw new Error(`已存在同名图片: ${safeName}`);
    }
    await fsp.rename(full, newFull);
    return {
      oldPath: imagePath,
      newPath: path.relative(workspaceDir, newFull).replace(/\\/g, '/'),
    };
  }

  // ---------- 通用文件操作（兼容裸帖 + bundle） ----------

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

  /**
   * 新建帖子，默认创建为 page bundle（content/posts/<name>/index.md）。
   * 返回 { path, name, isBundle }
   */
  async create(workspaceDir, baseName) {
    await this.ensurePostsDir(workspaceDir);
    let name = (baseName || 'untitled').replace(/[\\/:*?"<>|]/g, '_');
    if (name.endsWith('.md')) name = name.replace(/\.md$/, '');

    let bundleDir = path.join(this.postsDir(workspaceDir), name);
    let i = 1;
    while (fs.existsSync(bundleDir)) {
      bundleDir = path.join(this.postsDir(workspaceDir), `${name}-${i}`);
      i++;
    }
    await fsp.mkdir(bundleDir, { recursive: true });

    const date = new Date().toISOString();
    const indexFile = path.join(bundleDir, 'index.md');
    const initial = `---\ntitle: "${name}"\ndate: ${date}\ndraft: true\n---\n\n# ${name}\n\n`;
    await fsp.writeFile(indexFile, initial, 'utf8');

    const rel = path.relative(workspaceDir, indexFile).replace(/\\/g, '/');
    return { path: rel, name, isBundle: true };
  }

  async delete(workspaceDir, relPath) {
    const full = this._safeResolve(workspaceDir, relPath);
    if (!fs.existsSync(full)) return { ok: true, alreadyGone: true };
    // 如果是 bundle 的 index.md，删除整个 bundle 目录
    if (path.basename(full) === 'index.md') {
      const bundleDir = path.dirname(full);
      await fsp.rm(bundleDir, { recursive: true, force: true });
      return { ok: true };
    }
    await fsp.unlink(full);
    return { ok: true };
  }

  /**
   * 重命名帖子（对 bundle 重命名整个目录）。
   * 返回 { oldPath, newPath }。
   */
  async rename(workspaceDir, relPath, newName) {
    const full = this._safeResolve(workspaceDir, relPath);
    if (!fs.existsSync(full)) throw new Error(`文件不存在: ${relPath}`);
    const safeName = newName.replace(/[\\/:*?"<>|]/g, '_').replace(/\.md$/i, '');

    const isBundleIndex = path.basename(full) === 'index.md';
    let newFull;
    if (isBundleIndex) {
      // 重命名整个 bundle 目录
      const oldBundleDir = path.dirname(full);
      newFull = path.join(path.dirname(oldBundleDir), safeName, 'index.md');
      if (fs.existsSync(path.dirname(newFull)) && path.resolve(path.dirname(newFull)) !== path.resolve(oldBundleDir)) {
        throw new Error(`已存在同名帖子: ${safeName}`);
      }
      await fsp.rename(oldBundleDir, path.dirname(newFull));
    } else {
      newFull = path.join(path.dirname(full), safeName + '.md');
      if (fs.existsSync(newFull) && path.resolve(newFull) !== path.resolve(full)) {
        throw new Error(`已存在同名文件: ${safeName}.md`);
      }
      await fsp.rename(full, newFull);
    }
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
