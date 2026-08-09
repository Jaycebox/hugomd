# hugomd 架构设计

## 总体思路

```
┌──────────────────────────────────────────────────────────┐
│                    Electron App                          │
│                                                          │
│  ┌────────────────────┐      ┌────────────────────────┐  │
│  │  Main Process      │      │  Renderer Process      │  │
│  │                    │      │                        │  │
│  │  - 窗口管理         │      │  - HTML/CSS/JS UI      │  │
│  │  - Hugo 二进制     │  IPC │  - Monaco Editor       │  │
│  │  - hugo server 进程 │ ←──→ │  - 文件列表/弹窗        │  │
│  │  - 文件 CRUD        │      │  - 预览 iframe          │  │
│  │  - 工作区管理        │      │                        │  │
│  │  - 设置存储         │      │                        │  │
│  └────────────────────┘      └────────────────────────┘  │
│           │                                               │
│           │ spawn                                        │
│           ▼                                               │
│  ┌────────────────────┐                                   │
│  │  hugo server        │ ←── http://127.0.0.1:PORT      │
│  │  (子进程)            │                                   │
│  └────────────────────┘                                   │
│           │                                               │
│           │ 监听文件                                       │
│           ▼                                               │
│  ┌────────────────────┐                                   │
│  │  Hugo 站点目录       │                                   │
│  │  ├ content/posts/   │                                   │
│  │  ├ themes/          │                                   │
│  │  ├ hugo.toml        │                                   │
│  │  └ public/          │                                   │
│  └────────────────────┘                                   │
└──────────────────────────────────────────────────────────┘
```

## 核心流程

### 1. 启动

```
app.whenReady()
  └─ App.init()
       ├─ SettingsStore 加载 settings.json
       ├─ HugoManager.init()   // 拷贝嵌入 hugo 到 userData/bin
       ├─ 注册所有 IPC handler
       ├─ 创建 BrowserWindow
       └─ 构建应用菜单
```

### 2. 新建工作区

```
用户: 标题栏 ＋工作区
  → render: newWorkspace 对话框
  → 选位置 + 填名字 + 选主题
  → IPC: workspace:create({ dir, name, theme })
  → WorkspaceManager.create():
      1. mkdir <dir>
      2. 拷贝 resources/themes/<theme>/*  → <dir>/themes/<theme>
      3. 拷贝 resources/scaffolds/*        → <dir>/
      4. 替换 hugo.toml 中的 ${SITE_NAME}/${THEME}
      5. mkdir <dir>/content/posts
      6. 写一篇 welcome.md
  → IPC: server:start(dir, { draft: true })
  → HugoServer.start():
      1. 解析一个空闲端口
      2. spawn `hugo server -s <dir> --port <P> --watch --noHTTPCache`
      3. 读 stdout 等待 "Web Server is available"
      4. 验证端口可连接
      5. 推 baseURL 事件到 renderer
  → render: 预览 iframe.src = baseURL
```

### 3. 编辑文件

```
用户在 Monaco 输入
  → debounce 600ms 触发 onChange
  → render: 调 IPC files:write()
  → FileService.write(): 写文件到 content/posts/*.md
  → render: 调 HHPreview.scheduleReload()
  → debounce 800ms 重设 iframe.src
  → (hugo server --watch 自身也在重新渲染)
  → 浏览器 iframe 重新加载，看到新内容
```

### 4. 关闭

```
app.before-quit
  → HugoServer.stop()  // SIGTERM / taskkill
  → 释放端口
```

## 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| `App` | `src/main/index.js` | 整体生命周期，菜单，IPC 注册顺序 |
| `WindowManager` | `src/main/window.js` | BrowserWindow 创建、IPC 发送 |
| `SettingsStore` | `src/main/settings.js` | JSON 设置持久化 |
| `HugoManager` | `src/main/hugo/manager.js` | 解析 hugo 二进制、下载、回退 |
| `HugoServer` | `src/main/hugo/server.js` | hugo server 子进程生命周期 |
| `WorkspaceManager` | `src/main/workspace/manager.js` | 工作区创建/列表 |
| `FileService` | `src/main/files/service.js` | content/posts/*.md CRUD |
| `registerIpc` | `src/main/ipc.js` | 所有 ipcMain.handle 集中点 |
| `preload` | `src/preload/index.js` | 暴露 `window.hugomd.*` 安全 API |

## 渲染层

```
index.html
├ styles/{main, sidebar, editor, preview, dialogs}.css
└ scripts/
   ├ editor.js   → window.HHEditor   Monaco 封装
   ├ sidebar.js  → window.HHSidebar  文件列表
   ├ preview.js  → window.HHPreview  iframe 调度
   ├ dialogs.js  → window.HHDialogs  弹窗/Toast
   └ main.js     → 入口，编排所有模块
```

渲染层是纯 HTML/CSS/JS，没用任何框架。模块通过 `window.HH*` 命名空间互通。

### Monaco 集成

为避免引入打包工具，渲染层用 monaco 官方 AMD loader：

1. `npm install` 后 `postinstall` 触发 `scripts/copy-monaco.js`
2. 把 `node_modules/monaco-editor/min/vs/*` 整个复制到 `src/renderer/vendor/monaco/vs/`
3. 渲染层 `<script src="vendor/monaco/vs/loader.js">` 后 `require.config({ paths: { vs: 'vendor/monaco/vs' } })`
4. `MonacoEnvironment.getWorkerUrl` 返回 `vs/base/worker/workerMain.js`，由 monaco 自己 `new Worker(url)` 跑

**代价**：monaco vendor 目录约 ~30 MB，已加入 .gitignore。每次 `npm install` 都会重新生成。

## Hugo 二进制来源优先级

```
1. settings.hugoPath   (用户在设置里手动指定)
   ↓ 不存在或未设置
2. <userData>/bin/hugo(.exe)   (嵌入或已下载的副本)
   ↓ 不存在
3. PATH 中的 hugo       (where hugo / which hugo)
   ↓ 都没有
4. throw → 用户在设置里点"下载 Hugo" → 从 GitHub release 拉到 userData/bin
```

下载 URL 模板（在 `HugoManager._releaseUrl()`）：

- Windows: `hugo_extended_<v>_windows-amd64.zip`
- macOS:   `hugo_extended_<v>_macOS-{arm64|amd64}.tar.gz`
- Linux:   `hugo_extended_<v>_linux-amd64.tar.gz`

下载后用系统 `unzip` / `tar` 解压到 userData/bin，再 chmod +x（Unix）。

## IPC 协议

所有 channel 集中定义在 `src/main/ipc.js` 和 `src/preload/index.js`。

```
app:info
settings:getAll / set / setMany

hugo:status / resolve / ensure / setPath / clearPath / pickPath
hugo:download-progress  (event)

workspace:list / exists / defaultRoot / create / pickDir / pickExisting / reveal

server:start / stop / status / restart
server:event  (event: state, log, error-log)

files:list / read / write / create / delete / rename

menu:new-workspace / open-workspace / new-post / toggle-preview / open-settings / reveal-workspace
```

## 主题

`src/resources/themes/` 下内置 3 个 Hugo 主题，每个都是一个完整 Hugo 主题目录：

- `minimal/` - 极简白底
- `terminal/` - 暗色终端风（mac 风格窗框）
- `paper/` - 米白纸质风（衬线字体）

每个主题都包含 `theme.toml` + `layouts/` + `static/css/style.css`。

新建工作区时通过 `_copyDir()` 把整个主题目录拷到 `<workspace>/themes/<name>`，再设置 `hugo.toml` 里的 `theme = "<name>"`。

## 已知限制 / TODO

- [ ] Monaco worker 在 file:// 协议下行为依赖 Electron 版本，需要在真实 Windows / macOS / Linux 打包后回归测试
- [ ] 预览 iframe 与 hugo server 的 Live Reload 协议不互通（sandbox 限制），目前用"保存后定时 reload iframe"兜底。生产环境可考虑 hugo 自带的 Live Reload JS 注入
- [ ] Hugo 下载走 GitHub，国内网络可能慢。可以扩展成支持多 mirror
- [ ] 没有图标资源 (`build/icon.ico`)，打包前需补
- [ ] 没有自动更新机制
- [ ] 没有 i18n，UI 文案都是中文
