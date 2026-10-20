# Markdown 表格原生导入

用户已确认采用调研中发现的 MARKDOWN 内容块方案。

- 解析阶段保留表格原始 Markdown；预览显示 HTML 表格，导入分段保留表格与正文、图片的顺序。
- 隔离 content script 通过扩展 service worker，在当前 X 文章的 MAIN world 执行自有表格适配器。只接受本扩展顶层 content script 的消息，不开放页面 postMessage 接口。
- 写入前检查 React/DraftJS 能力和空白状态。表格占位符写入后，基于现有编辑器状态创建 MARKDOWN entity 和 atomic block；若粘贴将占位符并入前文，拆分时保留原文和字符样式。表格后保留独立文本段落。
- 不支持时在写入前停止；写入过程中失败明确提醒检查部分写入结果，不静默拍平表格。
- 验证包括解析、不可用保护、真实 DraftJS 模型、MAIN world 消息链路、前后文、多表格、列对齐、粗体、无占位符残留和本地序列化后刷新。真实 X 服务端持久化仍待安装后验收。
