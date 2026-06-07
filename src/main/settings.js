'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 极简的 JSON 设置存储。
 * 写入采用"写临时文件再 rename"的原子方式，避免半写状态。
 */
class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = raw.trim() ? JSON.parse(raw) : {};
      } else {
        this.data = {};
      }
    } catch (err) {
      console.error('[settings] load failed, fallback to defaults:', err);
      this.data = {};
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[settings] persist failed:', err);
    }
  }

  get(key, fallback = undefined) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this._persist();
  }

  setMany(obj) {
    Object.assign(this.data, obj);
    this._persist();
  }

  all() {
    return { ...this.data };
  }
}

module.exports = SettingsStore;
