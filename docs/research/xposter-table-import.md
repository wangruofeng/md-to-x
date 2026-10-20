# xPoster 表格导入实现调研

调研对象：本机 Chrome Profile 1 安装的 XXD xPoster 1.42.79。官网：https://vip.xiaoxiaodong.ai/plugins/xposter 。本次只读检查扩展文件，并在独立 Node VM 中调用构建导入计划的纯函数；没有触碰插件设置、会员验证或 X 草稿。

## 结论

当前默认路径将 Markdown 表格写入 X DraftJS 的 `atomic` 内容块，其 entity 类型为 `MARKDOWN`，数据为 `{ markdown: 原始表格语法 }`，mutability 为 `MUTABLE`。并非表格截图，也不是 HTML `<table>` 粘贴。

## 已核实的调用链

安装目录：`~/Library/Application Support/Google/Chrome/Profile 1/Extensions/iimkimodgdjnnmdopeolboakhjmhfbbj/1.42.79_0/`。

1. `src/shared.js:1394`：`tableToMarkdown` 将表头、对齐和各行恢复为 Markdown。支持左、中、右对齐标记。
2. `src/content.js:2047`：`prepareTables` 直接记录 `{ok:true,native:true}`，不执行图片渲染。
3. `src/content.js:1668`：调用 `buildPastePlan` 时仅传入 coverSource、coverResult，未指定 tableMode=image。
4. `src/shared.js:1564` 附近：为表格生成唯一占位符，并生成 atomic/MARKDOWN 写入操作，保留 fallbackText。
5. `src/main-world.js:140`：从 DOM 的 React Fiber 找到持有 editorState 和 onChange 的 DraftJS 编辑器实例。此逻辑必须运行在页面 MAIN world，而非普通隔离 content script。
6. `src/main-world.js:499`：创建 MARKDOWN entity，将对应占位段落替换成 atomic block。
7. `src/main-world.js:526`：通过 EditorState.push 和编辑器 onChange 应用状态。
8. `src/main-world.js:1949` 附近：批量应用特殊块；失败时把占位符替换回 Markdown 文本。

`src/shared.js:1541` 有显式 tableMode=image 的备选分支，但本版本实际导入调用未启用；不能据此判断默认截图导入。

## 独立执行验证

直接加载已安装 shared.js 到 Node VM，输入两列两行测试表格，buildPastePlan 的结果包含：

```json
{
  "type": "atomic",
  "entityType": "MARKDOWN",
  "data": {"markdown": "| 名称 | 数值 |\n| :--- | ---: |\n| 甲 | 10 |\n| 乙 | 20 |"},
  "mutability": "MUTABLE",
  "table": true
}
```

这验证了导入计划的默认分支。未在本次调研中向真实 X 写入并刷新验收，因此不能将其等同于当前 X 服务端持久化已验证。

## 对 md-to-x 的建议

将表格保留为独立片段，通过自行实现的 MAIN world 桥接写入 MARKDOWN atomic block；保留表头、单元格与列对齐，预览继续显示 HTML 表格。能力检查失败时明确报错或保留原始 Markdown，避免静默拍平。验证应包含真实 X 显示、保存后刷新、再次编辑、正文前后顺序和多表格。

这依赖 X 未公开的编辑器内部结构，需在写入前检查对象能力，并继续保留空白草稿保护。参考机制自行实现，不复制第三方插件受版权保护的代码。
