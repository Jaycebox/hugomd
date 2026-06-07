'use strict';

/**
 * 把 monaco-editor 的预构建 AMD 版本从 node_modules 拷贝到渲染层 vendor 目录。
 * 这样渲染层可以通过 <script src> 直接加载，无需任何打包步骤。
 *
 * 之所以用 AMD 版本：
 *   1. 它是 monaco 官方分发形式，自带 loader，开箱即用
 *   2. ESM 版本需要 bundler，不符合"渲染层纯 HTML/JS"的目标
 *   3. 拷贝后大小约 30MB（含所有语言），但只复制到本地不联网
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = path.join(root, 'src', 'renderer', 'vendor', 'monaco', 'vs');

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) rimraf(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(p);
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error('[copy-monaco] 找不到 monaco-editor/min/vs，请先运行 npm install');
  process.exit(1);
}

console.log('[copy-monaco] 复制 monaco 到 vendor 目录...');
rimraf(path.join(root, 'src', 'renderer', 'vendor', 'monaco'));
copyDir(src, dest);
console.log('[copy-monaco] 完成 ->', dest);
