import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { parseArticle, resolveLocalImage } from "../src/article.js";

const { document } = new JSDOM("").window;
const parse = (source, options = {}) =>
  parseArticle(source, { document, ...options });

test("从 frontmatter 识别标题并去掉重复的一级标题", () => {
  const article = parse(
    '---\ntitle: "我的文章"\ntags: [AI]\n---\n# 我的文章\n\n正文 **重点**。',
  );
  assert.equal(article.title, "我的文章");
  assert.doesNotMatch(article.html, /<h1/);
  assert.match(article.html, /<strong>重点<\/strong>/);
});

test("没有 frontmatter 时使用首个 H1，文件名作为后备", () => {
  assert.equal(parse("# 标题\n\n内容").title, "标题");
  assert.equal(
    parse("只有正文", { filename: "测试文章.md" }).title,
    "测试文章",
  );
  assert.equal(parse("# 原标题", { title: "手动标题" }).title, "手动标题");
});

test("保留列表、引用和链接，过滤脚本和危险地址", () => {
  const a = parse(
    '## 小节\n\n- 列表\n\n> 引用\n\n[链接](https://example.com)\n\n<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">危险</a>',
  );
  assert.match(a.html, /<h2>小节/);
  assert.match(a.html, /<ul>/);
  assert.match(a.html, /<blockquote>/);
  assert.match(a.html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(a.html, /<script|onerror|javascript:/);
});

test("图片按原文顺序拆成独立导入片段，不丢失图片前后文字", () => {
  const a = parse(
    "# 标题\n\n之前 ![甲](imgs/a.png) 之间 ![乙](https://example.com/b.png) 之后",
  );
  assert.deepEqual(
    a.segments.map((s) => s.type),
    ["html", "image", "html", "image", "html"],
  );
  assert.equal(a.images[0].src, "imgs/a.png");
  assert.match(a.segments[0].text, /之前/);
  assert.match(a.segments[4].text, /之后/);
  assert.equal(a.stats.images, 2);
});

test("表格和代码正常导入，深层标题保留兼容提示", () => {
  const a = parse(
    "#### 深层标题\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n\n```js\nconst x = 1;\n```",
  );
  assert.equal(a.stats.tables, 1);
  assert.equal(a.stats.codeBlocks, 1);
  assert.ok(!a.warnings.some((w) => w.includes("表格")));
  assert.ok(!a.warnings.some((w) => w.includes("代码")));
  assert.ok(a.warnings.some((w) => w.includes("四级")));
  assert.doesNotMatch(a.segments.map((s) => s.html).join(""), /<table/);
  assert.match(
    a.segments.find((s) => s.type === "table").markdown,
    /名称.*值/s,
  );
});

test("不合法 frontmatter 和非图片 data URL 不会静默通过", () => {
  assert.throws(() => parse("---\ntitle: [bad\n---\n正文"), /frontmatter/i);
  assert.equal(
    parse('<img src="data:text/html;base64,PHNjcmlwdD4=">').images.length,
    0,
  );
});

test("本地图片按完整相对路径匹配，同名冲突不会错配", () => {
  const a = { name: "a.png", webkitRelativePath: "文章/imgs/a.png" };
  const b = { name: "a.png", webkitRelativePath: "文章/other/a.png" };
  assert.equal(resolveLocalImage("./imgs/a.png", [a, b]), a);
  assert.equal(resolveLocalImage("a.png", [a, b]), null);
  assert.equal(
    resolveLocalImage("imgs/%E5%9B%BE.png", [
      { name: "图.png", webkitRelativePath: "文章/imgs/图.png" },
    ]).name,
    "图.png",
  );
});

test("表格保留 Markdown 对齐及正文前后顺序，不拍平成文本", () => {
  const a = parse(
    "前文\n\n| 名称 | 数值 |\n| :--- | ---: |\n| **甲** | 10 |\n\n后文",
  );
  assert.deepEqual(
    a.segments.map((s) => s.type),
    ["html", "table", "html"],
  );
  assert.match(a.segments[1].markdown, /\| :--- \| ---: \|/);
  assert.match(a.segments[1].markdown, /\*\*甲\*\*/);
  assert.match(a.segments[0].text, /前文/);
  assert.match(a.segments[2].text, /后文/);
});

test("纯表格、相邻表格和图片都保持各自的导入片段", () => {
  const a = parse(
    "| 甲 |\n| --- |\n| 乙 |\n\n![图](a.png)\n\n| 丙 |\n| --- |\n| 丁 |",
  );
  assert.deepEqual(
    a.segments.map((s) => s.type),
    ["table", "image", "table"],
  );
  assert.equal(a.images.length, 1);
  assert.match(a.segments[2].markdown, /丁/);
});

test("HTML 表格不会被误认为已支持的 Markdown 表格", () => {
  assert.throws(
    () => parse("<table><tr><td>HTML 内容</td></tr></table>"),
    /仅支持 Markdown 表格/,
  );
});

test("代码块保留语言、缩进、空行与前后顺序", () => {
  const markdown =
    "```javascript\nfunction hello() {\n  const x = 1;\n\n  return x;\n}\n```";
  const a = parse(
    `前文\n\n${markdown}\n\n| A |\n| --- |\n| B |\n\n~~~python\nprint(1)\n~~~\n\n后文`,
  );
  assert.deepEqual(
    a.segments.map((s) => s.type),
    ["html", "code", "table", "code", "html"],
  );
  assert.equal(a.segments[1].markdown, markdown);
  assert.equal(a.segments[3].markdown, "```python\nprint(1)\n```");
  assert.equal(a.stats.codeBlocks, 2);
  assert.deepEqual(a.warnings, []);
});

test("缩进代码及含反引号代码可安全还原", () => {
  assert.equal(
    parse("    const x = 1;\n").segments[0].markdown,
    "```\nconst x = 1;\n```",
  );
  const a = parse("````md\n```js\nhello\n```\n````");
  assert.equal(a.segments[0].markdown, "````md\n```js\nhello\n```\n````");
});

test("附件长文所有正文、标题与结尾完整保留", () => {
  const source = readFileSync(
    new URL("./fixtures/long-article.md", import.meta.url),
    "utf8",
  );
  const a = parse(source, { filename: "技术选型.md" });
  const output = new JSDOM(
    a.segments
      .filter((s) => s.type === "html")
      .map((s) => s.html)
      .join(""),
  ).window.document;
  assert.equal(
    output.querySelectorAll("h1").length,
    (source.match(/^## /gm) || []).length,
  );
  assert.equal(
    output.querySelectorAll("h2").length,
    (source.match(/^### /gm) || []).length,
  );
  assert.match(a.segments.at(-1).text, /能够支撑选型的证据/);
  assert.ok(
    a.segments
      .filter((s) => s.type === "html")
      .every((s) => s.text.length <= 1800),
  );
  const preview = new JSDOM(a.html).window.document;
  for (const el of preview.querySelectorAll("img,table,pre")) el.remove();
  const norm = (text) => text.replace(/\s/g, "");
  assert.equal(norm(output.body.textContent), norm(preview.body.textContent));
});
