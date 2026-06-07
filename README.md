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

## License

MIT
