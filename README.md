# hhAPP

一个基于 **Electron** + **Hugo** 的桌面端笔记/博客写作工具。
所有笔记都以 Hugo 博客文章（`content/posts/*.md`）的形式存在，
底层用本地 Hugo 实时渲染预览，所见即所得。

## 特性

- 📝 Monaco 编辑器，写 Markdown 像写代码
- 👀 内置 `hugo server`，实时预览 + Live Reload
- 📦 自带 Hugo 二进制，开箱即用；同时支持 PATH 中的 hugo 和手动指定
- 🎨 内置多套主题（minimal / terminal / paper），开箱即写
- 🗂️ 多工作区管理，每个工作区就是一个独立的 Hugo 站点
- 🖼️ **图片管理**：帖子默认用 page bundle（`content/posts/xxx/index.md`），粘贴/拖入的图片保存在帖子目录，正文用标准 MD 相对路径 `![](pic.png)` 引用，所见即所得。**支持截图直贴**：Win+Shift+S 截图后直接在编辑器 Ctrl+V，自动保存到当前帖子目录并插入引用；工具栏"图片"按钮可管理（上传/删除/插入）
- 💾 纯本地文件存储，无云依赖

## 快速开始

```bash
# 安装依赖
npm install

# 启动 App
npm start

# 打包发布（Windows）
npm run build:win
```

> 首次启动时如果没检测到 `hugo` 二进制，App 会自动从 GitHub 下载到用户数据目录。

## 测试

```bash
npm test            # 跑全部测试（语法 / 主题渲染 / hugo watch / 创建单元 / UI 全链路）
npm run test:smoke  # 只跑 Electron 真实 UI 点击创建工作区（最慢，约 16s）
npm run test:e2e    # 只跑 hugo server --watch 实时重建
```

测试覆盖：
- **syntax**：`src/` 与 `scripts/` 全部 JS 语法检查
- **themes**：3 个内置主题能 `hugo build`
- **e2e**：`hugo server --watch` 修改文件后自动重渲染
- **createUnit**：`workspace.create` 11 项断言（含缺参数 / 非法主题 / 非空目录等错误分支）
- **smoke**：启动真实 Electron，模拟用户点击"＋工作区"→ 填表单 → 点"创建" → 校验 hugo server 运行

smoke 测试通过 `HHAPP_USER_DATA` 环境变量使用隔离的临时 userData，不会污染真实数据。


## 目录结构

```
hhAPP/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.js          # 入口
│   │   ├── window.js         # 窗口管理
│   │   ├── ipc.js            # IPC 处理器
│   │   ├── menu.js           # 应用菜单
│   │   ├── hugo/             # Hugo 二进制 + server 管理
│   │   ├── workspace/        # 工作区管理
│   │   └── files/            # 文件 CRUD
│   ├── preload/              # 预加载脚本（暴露安全 API）
│   ├── renderer/             # 渲染层（纯 HTML/CSS/JS）
│   │   ├── index.html
│   │   ├── styles/
│   │   ├── scripts/
│   │   └── assets/
│   └── resources/
│       ├── themes/           # 内置 Hugo 主题
│       └── scaffolds/        # hugo.toml 等站点脚手架
├── build/                    # 打包图标等
└── docs/                     # 项目文档
```

## 文档

- [架构设计](docs/architecture.md)
- [Hugo 内容模型与图片管理](docs/content-model.md)

## License

MIT
