# Hugo 内容模型与图片管理（hhAPP 实现）

## Hugo 是怎么组织内容的

Hugo 的帖子有两种存放方式，我们采用官方推荐的 **page bundle**：

```
# 方式 A：裸 Markdown（旧方式，仍兼容）
content/posts/my-post.md

# 方式 B：page bundle（当前默认，图片随帖走）
content/posts/my-post/
├── index.md          # 帖子正文（必须有这个文件）
├── sunset.jpg        # 图片资源，跟帖子绑定
└── sub/
    └── pic.png       # 也可以放在子目录
```

- **leaf bundle** = 一个目录 + `index.md` + 零或多个资源。
- bundle 里的图片是 **page resource**，Hugo 用 `.Resources.GetMatch` 等访问。
- `content/posts/_index.md` 可加 section 级配置（标题、排序等），非必需。

## 图片放哪里、怎么引用

| 资源类型 | 存放位置 | 我们的用法 |
|---|---|---|
| page resource | `posts/xxx/` 目录内（与 `index.md` 同级或子目录） | **图片管理对话框上传的图片** |
| global resource | `assets/images/` | 站点级共享图（暂未用） |
| static | `static/` | 不需要处理的文件 |

### 正文里的图片引用（关键：所见即所得）

在 bundle 中，正文写**标准 Markdown 相对路径**即可，Hugo 自动解析成正确 URL：

```
正文 index.md 内：
![](sunset.jpg)
![](sub/pic.png)

Hugo 渲染后：
<img src="/posts/my-post/sunset.jpg">
<img src="/posts/my-post/sub/pic.png">
```

已用 `hugo server` 实测验证：相对路径、子目录路径都正确解析，预览和最终站点一致。

## hhAPP 的实现

### 目录结构（工作区 = 纯 markdown）

工作区只放 markdown 和图片，前端样式/主题/配置完全隔离：

```
工作区/                          ← 用户只看到这个，全是内容
├── posts/                      ← 帖子（content 根）
│   ├── hello.md                ← 裸帖
│   └── my-post/                ← page bundle
│       ├── index.md
│       └── 图片.jpg
└── .hhapp.json                 ← App 内部元数据（主题、名称，隐藏）

站点模板/                        ← App 内部管理，用户不关心
（userData/site-template/<theme>/）
├── hugo.toml                   ← 站点配置
├── themes/                     ← 内置主题
├── layouts/                    ← 自定义布局
└── archetypes/                 ← 新帖模板
```

Hugo 通过 `hugo server -s <站点模板> -c <工作区>` 把工作区作为内容源挂载，
预览 URL 正确（`/posts/xxx/`），bundle 图片相对路径也正确解析。

### 文件服务（src/main/files/service.js）

- `list()`：同时识别裸帖（`.md`）和 bundle（目录内 `index.md`），返回 `isBundle`、`imageCount`
- `create()`：默认创建 bundle（`posts/name/index.md`）
- `listImages()/readImage()/saveImage()/deleteImage()/renameImage()`：图片资源 CRUD
- `delete()/rename()`：对 bundle 会操作整个目录（删除/重命名整帖）
- 图片格式白名单：png/jpg/jpeg/gif/webp/svg/avif/bmp/tiff/heic/heif
- 路径安全：所有相对路径经 `_safeResolve` 校验，防目录穿越

### 渲染层

- 侧边栏：bundle 帖显示 `📁` 标识和 `🖼 n` 图片数；点 🖼 打开图片管理
- 图片管理对话框：上传（点击/拖拽）、缩略图预览、删除、"插入到正文"（光标处插入 `![](ref)`）
- 插入语法：标准 MD 相对路径，与 Hugo 渲染一致，预览所见即所得

### IPC

```
files:listImages(postPath)          -> 列出帖子图片
files:readImage(imagePath)          -> 读取图片 (base64)
files:saveImage({postPath,fileName,dataBase64}) -> 保存图片到帖子目录
files:deleteImage(imagePath)
files:renameImage(imagePath,newName)
```

## 与 Hugo 原生功能的边界

- **图片处理**（Resize/Fill/Crop/转 webp）：Hugo 构建时能力，hhAPP 目前只是"托管原图 + 直接引用"。需要时可在主题模板里加 `.Resize`。
- **cover 图**：列表页可做成取 bundle 第一张图做封面（模板 `.Resources.ByType "image"` 取第一张），目前未做。
- **shortcode**：`{{< figure ... >}}` 能自动解析 bundle 资源，但语法不直观，默认用标准 MD。

## 测试覆盖

```
npm test
├─ fileService   FileService 15 项断言（bundle 创建/图片 CRUD/裸帖兼容）
├─ imageFlow     真实 Electron：建 bundle + 上传/读取/引用图片
├─ bundleE2E     hugo server 渲染 bundle 帖子及图片（HTTP 200）
└─ ...           其余 8 项回归
```
