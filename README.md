# 星汇 StarHub

一个轻量的明星动态聚合页：把同一位艺人在**微博**上发布的内容自动抓到一起，按时间倒序排列，点一下直达原帖。

不用手动刷主页、不用手动复制链接——**每 10 分钟自动更新一次，电脑关机也不影响。**

在线地址：<https://lulu1234-netize.github.io/starhub/>

---

## 它能做什么

- **自动采集**：每 10 分钟抓取一次目标账号的微博动态（正文、时间、图片、视频封面），全程无人值守
- **倒序时间线**：最新的永远在最上面，卡片直接显示真实配图
- **一键跳原帖**：每条动态都指向微博原帖地址，不是主页、不是搜索页
- **平台筛选**：全部 / 仅微博 / 仅小红书 / 仅抖音
- **已读清理**：看过的帖子标记已读后可以收起清理，但每个平台最新一条永远保留，不会刷着刷着变空白
- **手机当 App 用**：浏览器打开后"添加到主屏幕"，就是一个独立图标的应用
- **可选微信推送**：配置 Server酱 Key 后，有新动态会推到微信

## 它的原理

```
GitHub Actions（每 10 分钟定时）
        │  用微博登录 Cookie 请求接口
        ▼
  data/posts.json  ──提交回仓库──►  GitHub Pages
        │                                │
        └────────── 网页每 60 秒读取 ─────┘
                        │
                        ▼
                    手机 / 电脑浏览器
```

- 采集脚本：`collector/collect_http.js`（纯 HTTP，不需要浏览器，1 秒跑完）
- 定时任务：`.github/workflows/collect.yml`
- 页面：`index.html`（单文件，无框架、无构建、无依赖）

## 本地运行（不部署也能用）

```bash
node server.js
```

然后打开 <http://localhost:8787>。本地服务同样每 10 分钟自动采集一次，
同一 WiFi 下的手机可以用终端里打印的局域网地址访问。

## 部署到 GitHub（关机也能更新）

1. 新建**公开（Public）**仓库 `starhub`，把本目录推上去
2. 仓库 → 设置（Settings）→ 机密和变量（Secrets and variables）→ 操作（Actions）
   → 新建仓库机密（New repository secret）：
   - `WEIBO_COOKIE`：本机微博登录 Cookie（运行 `云部署工具/2_导出Cookie到剪贴板.bat` 自动复制）
   - `SENDKEY`：（可选）Server酱的推送 Key，不填就不推送
3. 设置（Settings）→ 操作（Actions）→ 常规（General）
   → 工作流权限（Workflow permissions）改为**读取和写入（Read and write）**
4. 设置（Settings）→ 页面（Pages）→ 源（Source）选**从分支部署（Deploy from a branch）**
   → 分支 `main` → 目录 `/ (root)`

详细图文步骤见 `GitHub部署完整操作手册.html`。

## 目录结构

```
starhub/
├── index.html                # 整个应用（单文件）
├── server.js                 # 本地服务：静态托管 + 定时采集
├── README.md
├── .nojekyll
├── .github/workflows/
│   └── collect.yml           # 云端定时任务
├── collector/
│   ├── collect_http.js       # 采集器（纯 HTTP + Cookie）
│   ├── collect.js            # 采集器（浏览器模式，用于刷新登录态）
│   ├── export_cookies.js     # 从本机浏览器导出登录 Cookie
│   └── copy_cookie.js        # 把 Cookie 复制到剪贴板
├── data/
│   ├── posts.json            # 抓到的动态（会被提交，是页面的数据源）
│   └── cookies.json          # 登录 Cookie（仅本机，已 gitignore）
├── img/                      # 头像与配图
└── 云部署工具/                # 三个一键 bat 脚本
```

## 换一个关注对象

编辑 `collector/collect_http.js` 顶部的 `TARGETS`：

```js
{ star: 'hmh', name: '侯明昊', uid: '1831550987', kind: 'own', tag: '本人' }
```

把 `uid` 换成目标微博主页链接里的那串数字即可，可以放多个。

## 维护

- **Cookie 会过期**（一般数周）。表现是内容不再更新、操作（Actions）日志报"非 JSON 响应"。
  重新运行 `云部署工具/2_导出Cookie到剪贴板.bat`，再回 GitHub 覆盖更新 `WEIBO_COOKIE` 即可。
- 想立刻抓一次：仓库 → 操作（Actions）→ 星汇定时采集 → 运行工作流（Run workflow）。

> GitHub 中文界面的翻译并不完整，很多地方仍显示英文。
> 认准括号里的英文单词最保险，或直接用 `GitHub部署完整操作手册.html` 里的直达链接。

## 说明

本项目仅聚合各平台上本来就公开发布的内容，跳转一律回原平台，不存储、不转载原文与图片。
登录 Cookie 只用于访问自己的微博接口，保存在仓库 Secrets 中，不会出现在代码或日志里。
