# MD to X · 长文工作台

在 Chrome 侧边栏导入、编辑和预览 Markdown，一键写入 X Articles 空白草稿。

无需额外账号或后端。文章保存在本机，发布由你在 X 中完成。

## 功能

- **Markdown 编辑与预览**：支持标题、副标题、粗体、斜体、有序/无序列表、引用、链接和图片快捷入口。
- **原生表格和代码块**：保留表格行列、对齐和单元格格式；代码块保留语言、缩进和空行。
- **标题适配**：正文 H2/H3 分别转换为 X 的标题/副标题，更深层级按副标题导入。文章标题优先读取 frontmatter 的 `title`、首个 H1 或文件名，也可手动修改。
- **图片导入**：预览自动加载网络图片，并准备上传；本地图片通过选择文章所在文件夹匹配。写入时显示图片进度。
- **长文校验**：分段写入，结束后检查正文、表格和代码块是否完整；成功后显示彩带效果。
- **本地草稿**：自动保存当前文章，支持保存、打开及删除最多 20 份草稿。存入草稿后清空编辑区。
- **编辑历史**：正文、标题和工具栏操作支持撤销、重做；当前文章及历史重新打开后可恢复。

## 安装

要求 Chrome 116 或更新版本，以及 Node.js 22 或更新版本。

```bash
git clone https://github.com/wangruofeng/md-to-x.git
cd md-to-x
npm ci
npm run build
```

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 开启「开发者模式」，点击「加载已解压的扩展程序」。
3. 选择本项目的 `dist` 文件夹。
4. 点击扩展图标，打开 MD to X 侧边栏。

更新源码后，重新运行 `npm run build`，在扩展管理页面点击重新加载，并刷新 X 页面。

## 使用

1. 导入 `.md` / `.markdown` 文件，或直接粘贴正文。
2. 编辑内容、切换预览，检查文章标题和排版。
3. 有本地图片时，在「图片」中选择文章所在文件夹；网络图片自动准备。
4. 在 X 的「文章」中新建**空白草稿**，保持该标签页为当前页面。
5. 点击「检查连接」，然后「写入 X」。
6. 等待导入结束，到 X 检查正文、图片和保存状态，再手动发布。

X 账号需具备 Articles 创作权限。插件不会点击发布，也不会覆盖已有内容的草稿。

### 快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 撤销 | ⌘ Z | Ctrl Z |
| 重做 | ⌘ Shift Z | Ctrl Shift Z / Ctrl Y |
| 保存当前文章 | ⌘ S | Ctrl S |
| 加粗 | ⌘ B | Ctrl B |
| 斜体 | ⌘ I | Ctrl I |

编辑历史最多保留最近 100 步，长文按约 4 MiB 历史文本预算提前淘汰旧记录；旧版本草稿从更新后开始记录历史。保存快捷键保存当前编辑状态，「存草稿」另存一个草稿版本。

### 支持范围与限制

- Markdown 文档最多 2 MB；PNG、JPEG、WebP、GIF 图片每张最多 15 MB。
- 本地图片按相对路径匹配；同名文件冲突时会报错。图片数据只保留在当前侧栏会话，重新打开后需重新加载本地图片。
- 网络图片需使用直接图片地址；不携带 Cookie，并拒绝下载重定向。防盗链、登录或重定向可能导致加载失败。
- 支持 Markdown 管道表格；HTML 表格请先转换。
- 表格和代码块依赖 X 未公开的 DraftJS 编辑器接口。X 更新后可能需要调整；写入前会检查接口能力。
- **导入失败时可能已有部分内容写入。请先检查 X 草稿，不要在同一草稿重复导入。**
- 编辑器接收图片不等于 X 服务端上传完成，仍需在 X 确认图片与保存状态。

## 权限与隐私

插件没有项目后端，不会将文章发送到项目服务器。草稿和编辑历史保存在 `chrome.storage.local`。

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 显示浏览器原生侧边栏 |
| `storage` | 保存当前文章、草稿和编辑历史 |
| `scripting` | 用户操作后检查、写入 X 编辑器 |
| HTTP / HTTPS 站点权限 | 下载文章引用的网络图片，以及访问 X 编辑器 |

预览会向原图片地址发送请求；下载图片不携带 Cookie。写入 X 后，内容由 X 平台处理。

## 开发与测试

```bash
npm run dev                 # 侧栏界面预览，不连接 X 编辑器
npm run check               # 单元测试及扩展构建
npx playwright install chromium
npm run test:e2e            # 独立浏览器端到端测试
```

已有 Chromium 时，可使用 `CHROMIUM_PATH` 指定其可执行文件。

浏览器测试使用独立临时用户目录，将 X 请求拦截到本地 DraftJS 测试编辑器，不使用个人登录信息。覆盖编辑预览、草稿、撤销与重做持久化、语法快捷入口、非空保护、富文本、表格和代码块顺序，以及附件长文的全文比对、保存与重载。图片测试模拟文件接收，不能替代真实 X 服务端上传验收。

```text
src/                 编辑、解析、历史、X 适配与原生内容块桥接
public/              扩展清单、后台脚本和图标
scripts/             构建和浏览器测试脚本
tests/               单元测试、DraftJS 测试编辑器及回归文档
examples/            示例 Markdown
docs/                设计和实现调研记录
```

## 参考与致谢

交互参考 [XXD xPoster](https://chromewebstore.google.com/detail/xxd-xposter-drop-in-markd/iimkimodgdjnnmdopeolboakhjmhfbbj) 的原生侧栏体验。本项目独立实现，不包含其源码或品牌资产，也不代表与其存在关联。

依赖 [Marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/DOMPurify) 和 [yaml](https://github.com/eemeli/yaml)；开发测试使用 DraftJS、React、Playwright 和 esbuild。依赖各自遵循其许可证。

## 许可证

[MIT](LICENSE) © 2026 Wang Ruofeng
