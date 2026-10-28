# dsh-reveal-in-folder（中文说明）

[English](README.md)

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 插件：在**本轮会话生成的每个文件**后面加一个文件夹图标，
点击就在系统文件管理器里打开该文件所在文件夹（Windows / macOS 会选中该文件，Linux / WSL 打开所在目录）。

每一轮回复的结尾会多出一行：

```
本轮生成的文件   report.md [📁]   model.py [📁]   chart.png [📁]
```

文件名本身可点击，用 Harness 右侧面板打开（走宿主自带的 `openFile`）；后面的文件夹图标负责在系统文件管理器里定位。

当前版本：[v0.1.1](https://github.com/danchaw/dsh-reveal-in-folder/releases/tag/v0.1.1)
· 变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 为什么要做这个插件

Harness 本身已经会 reveal 文件：官方「交付物」卡片上有 open / reveal 按钮，**但只在模型调用 `present`
展示过的文件**（以及 Changes 审阅页）上出现。仅仅用 `write` / `edit` 写出来的文件在那一行里只是普通改动文件，
没有跳转到文件夹的入口。

这个插件补的正是这个缺口：把本轮**产出**的文件列出来，每个都配上 reveal 按钮。

## 实现方式

- **纯 Client bundle**：host 半 (`lib/index.js`) 故意是一个空的 `apply()`，理由见下面「安全说明」。
- **文件列表的来源**：在 `ctx.uiConversation.events` 上注册一个 Conversation `Definition`
  （kind `reveal-in-folder-files`），把 `turn/start` / `tool/call` / `tool/result` 折叠成按轮次归档的文件清单——
  用的是官方交付物卡片同一套框架通道，轮次归属由引擎决定，插件不去抓别的插件的 DOM。
- **什么算「产出」**：成功执行的 `write`、`edit`、带写入语义的 `str_replace_editor`、`apply_patch`，
  而且**调用参数里必须写了文件路径**；此时优先采用 Host 记在工具结果 metadata 里的绝对路径
  （相对路径按会话工作区解析）。只读（`read` / `grep`）、shell 命令、失败的调用一律不计入——
  单凭结果 metadata 里的路径不算产出（0.1.1 修掉的就是这一点）。
- **渲染位置**：slot `conversation.chat.turnTail`，条目 id `dsh-reveal-in-folder.turn-tail`，
  `order: 5`（紧跟官方交付物卡片之后）。
- **点击做什么**：`ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })`，
  也就是官方 UI 一直在用的那**一个** Host 入口。Host 会分发到 Explorer `/select`、macOS `open -R`、
  `xdg-open` 或 WSL 桥接，并且自带「路径必须属于已验证桌面工作区」的校验。
- **没有桌面可打开时**：只有 `ctx.remote.session.canOpenWorkspacePath()` 返回 `true` 才渲染这一行，
  所以远程无头 Host（或没有 `DISPLAY` 的 Linux）不会出现点不动的图标。
- Host 校验不过的路径会返回错误，按钮就地变红提示失败，不会静默。
- **零依赖**：不自带 React（`require('react')` 用的就是浏览器里那一份），无构建步骤，不发网络请求。

## 安装

前提：DSH 桌面应用或 Web UI（在 `0.2.1-rc.3` 上开发并验证），且 Harness Host 与浏览器在同一台桌面机器上——
毕竟要打开的是本机的文件管理器。

请装到**你的 Harness 真正启动的那个 profile** 里，这一步最容易出错：

| 你用的启动方式 | 应该装进哪个 profile |
| --- | --- |
| **桌面应用**（`DeepSeek Harness.exe`） | `--profile desktop` |
| **Web 启动器**（`dsh --profile web`，浏览器里打开） | `--profile web` |

```powershell
# 桌面应用
dsh plugin --profile desktop add "github:danchaw/dsh-reveal-in-folder"

# Web UI
dsh plugin --profile web add "github:danchaw/dsh-reveal-in-folder"
```

想固定版本而不是跟着 `main` 走，就在后面加 `#v0.1.1`。

也可以在 UI 的「插件」页面里从 Git 安装。**全新安装**会被即时接上——渲染进程按新的模块 revision 取包，不用重启；
但**替换已经加载过的版本**需要重启应用（或刷新页面）才会切到新的 module generation。

开发时想直接装本地目录：

```powershell
dsh plugin --profile desktop add "C:\Users\you\Documents\DSH\dsh-reveal-in-folder"
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-reveal-in-folder
```

## 配置

没有。插件不新增 tool、不改 system prompt、不加设置项、不监听任何网络端口。

## 常见问题

- **装成功了但一个图标都看不到。** 基本是 profile 装错了——插件装进了当前应用不会启动的那个 profile。
  用 `dsh plugin --profile desktop why dsh-reveal-in-folder` 核对；记住桌面应用**不读** `--profile web`。
- **这一轮没有图标。** 属于预期：只有本轮真的写/改过文件才会出现这一行。纯读取的轮次没有，
  命令行创建的文件只会出现在官方交付物卡片上（那里本来就有 reveal 按钮）。
- **有图标但点了没反应 / 变红。** Host 拒了这个路径——它只允许 reveal「能解析回本机已验证工作区」的路径，
  远程或容器里的工作区按设计会被拒绝。
- **无头 Host 上什么都没有。** 属于预期：没有可用文件管理器时整行都不渲染。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `lib/index.js` | host 半 —— 故意留空，reveal 操作留在 Host 里。 |
| `lib/client.js` | 浏览器模块：事件 `Definition`、turnTail 条目、文件夹按钮。 |
| `cordis.patch.yml` | 安装时 Plugin Manager 往组合树里插入的那一行。 |
| `locale/en.json`、`locale/zh.json` | 插件页面里展示的标题与描述。 |
| `icon.svg` | 插件图标（原创，MIT）。 |
| `CHANGELOG.md` | 版本变更记录。 |
| `test/` | `node --test`：manifest 自洽检查 + 无头运行时冒烟测试（自带 hook 渲染器，跑通事件折叠、能力探测与一次真实点击）。 |

## 安全说明

插件**不带任何 HTTP 路由，也不 spawn 进程**。打开文件夹这件事是 Host 已有且已有守卫的能力
（它会验证路径确实落在被确认过的桌面工作区内）。如果在插件里再写一套 shell 打开逻辑，等于为了同一个结果
多开一个攻击面，所以这个 bundle 只做 UI，点击直接调用官方入口。

## 开发

```sh
npm test
```

零依赖、零构建步骤——`lib/client.js` 就是 DSH 直接加载的浏览器模块（`window.__ModuleLoader__`）。
测试用一个 stub `ctx` 加自带 hook 的极简渲染器驱动这个模块，所以不用开浏览器也能覆盖事件折叠和点击链路。

## 已知边界

- 只显示 `write` / `edit` / `str_replace_editor` / `apply_patch` 产出的文件；用命令行生成的文件需要模型
  `present` 之后才会出现在交付物卡片上（那里已经有官方 reveal 按钮）。
- 每轮最多 24 个芯片，多出来的收进「还有 N 个文件」。
- 芯片是**按轮次**的：更早轮次的文件不会在这一轮重复列出，需要回到那一轮，或者用交付物卡片。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
