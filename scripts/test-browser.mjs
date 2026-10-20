import { JSDOM } from "jsdom";
import { parseArticle } from "../src/article.js";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const fixture = await build({
  entryPoints: ["tests/fixture.js"],
  bundle: true,
  write: false,
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
});
const profile = await mkdtemp(join(tmpdir(), "md-to-x-test-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await context.route("https://x.com/**", (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith("fixture.js")
        ? "text/javascript"
        : "text/html",
      body: route.request().url().endsWith("fixture.js")
        ? fixture.outputFiles[0].text
        : '<div id="root"></div><script src="/fixture.js"></script>',
    }),
  );
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByText("先试一篇示例").click();
  const initialSource = await panel.locator("#markdown").inputValue();
  await panel.locator("#markdown").fill(initialSource + "\n历史版本一");
  await panel.locator("#markdown").fill(initialSource + "\n历史版本二");
  await panel.locator("#markdown").press("Meta+z");
  assert.equal(
    await panel.locator("#markdown").inputValue(),
    initialSource + "\n历史版本一",
  );
  await panel.locator("#markdown").press("Meta+s");
  await panel.waitForFunction(
    () => document.querySelector("#save-state").textContent === "已自动保存",
  );
  await panel.reload();
  await panel.locator("#markdown").waitFor();
  assert.equal(
    await panel.locator("#markdown").inputValue(),
    initialSource + "\n历史版本一",
  );
  await panel.locator("#markdown").press("Meta+Shift+z");
  assert.equal(
    await panel.locator("#markdown").inputValue(),
    initialSource + "\n历史版本二",
  );
  await panel.locator("#markdown").press("Meta+z");
  await panel.locator("#markdown").press("Meta+z");
  assert.equal(await panel.locator("#markdown").inputValue(), initialSource);
  await panel.getByRole("button", { name: "插入副标题", exact: true }).click();
  await panel.locator("#markdown").press("Meta+z");
  assert.equal(await panel.locator("#markdown").inputValue(), initialSource);

  await panel.locator("#preview-view").click();
  await panel.locator("#preview strong").waitFor();
  let remoteRequests = 0;
  await context.route("https://images.example.com/**", (route) => {
    remoteRequests++;
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  const original = await panel.locator("#markdown").inputValue();
  await panel.locator("#file-input").setInputFiles({
    name: "导入测试.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 文件导入\n\n正文\n\n![图片](https://images.example.com/a.png)",
    ),
  });
  await panel.getByPlaceholder("文章标题").waitFor();
  await panel.waitForFunction(
    () => document.querySelector("#article-title").value === "文件导入",
  );
  await panel.waitForFunction(() => {
    const img = document.querySelector("#preview img");
    return img?.complete && img.naturalWidth > 0;
  });
  assert.ok(remoteRequests > 0, "预览应自动加载远程图片");
  await panel.waitForFunction(() =>
    document.querySelector("#image-summary").textContent.includes("1 张就绪"),
  );
  assert.equal(
    await panel.locator("#load-remote").count(),
    0,
    "网络图片无需手动加载",
  );
  await panel.locator("#file-input").setInputFiles({
    name: "欢迎使用.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(original),
  });
  await panel.waitForFunction(
    () =>
      document.querySelector("#article-title").value ===
      "把写作的时间，还给写作",
  );
  await panel.locator("#save-draft").click();
  await panel.waitForFunction(
    () => document.querySelector("#markdown").value === "",
  );
  assert.equal(await panel.locator("#article-title").inputValue(), "");
  await panel.waitForFunction(
    async () =>
      (await chrome.storage.local.get("current")).current?.source === "",
  );
  await panel.reload();
  await panel.locator('[data-tab="drafts"]').waitFor();
  assert.equal(await panel.locator("#markdown").inputValue(), "");
  await panel.locator('[data-tab="drafts"]').click();
  const draftCount = await panel.locator(".draft-item").count();
  assert.ok(draftCount > 0);
  await panel.locator(".draft-item").first().locator("button").first().click();
  assert.match(await panel.locator("#markdown").inputValue(), /专注内容/);
  await panel.locator('[data-tab="drafts"]').click();
  assert.equal(
    await panel.locator(".draft-item").count(),
    draftCount,
    "查看草稿不能新增版本",
  );
  await panel
    .getByRole("button", { name: "删除草稿", exact: true })
    .first()
    .click();
  await panel.waitForFunction(
    (count) => document.querySelectorAll(".draft-item").length === count,
    draftCount - 1,
  );
  await panel.reload();
  await panel.locator('[data-tab="drafts"]').click();
  assert.equal(
    await panel.locator(".draft-item").count(),
    draftCount - 1,
    "删除草稿应持久保存",
  );
  await panel.locator('[data-tab="writing"]').click();
  await panel.setViewportSize({ width: 400, height: 850 });
  await panel.locator("#preview-view").click();
  await mkdir("artifacts", { recursive: true });
  await panel.screenshot({ path: "artifacts/sidepanel.png", fullPage: true });
  assert.equal(
    await panel.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "窄侧栏不能横向溢出",
  );
  const x = await context.newPage();
  x.on("pageerror", (e) => console.log("fixture error", e.message));
  await x.goto("https://x.com/compose/articles/edit/123456");
  await x.locator('[data-testid="composer"]').waitFor();
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const target = tabs.find((t) => t.url?.includes("/edit/123456"));
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, target.id);
  const result = await worker.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "MDX_WRITE",
        payload: {
          title: "集成测试",
          segments: [
            {
              type: "html",
              html: "<h2>小标题</h2><p>正文<strong>粗体</strong></p><ul><li>第一项</li></ul>",
              text: "小标题正文粗体第一项",
            },
          ],
        },
      }),
    target.id,
  );
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.match(await x.locator("[contenteditable]").innerText(), /粗体/);
  assert.ok(
    await x
      .getByText("粗体", { exact: true })
      .evaluate((el) => Number(getComputedStyle(el).fontWeight) >= 600),
  );
  const again = await worker.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "MDX_WRITE",
        payload: { title: "覆盖", segments: [] },
      }),
    target.id,
  );
  assert.match(again.error, /空白草稿/);
  assert.equal(await x.locator("textarea").inputValue(), "集成测试");
  await x.evaluate(() => localStorage.removeItem(location.pathname));
  await x.reload();
  await x.locator('[data-testid="composer"]').waitFor();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, target.id);
  const imageResult = await worker.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "MDX_WRITE",
        payload: {
          title: "图片测试",
          segments: [
            {
              type: "image",
              dataURL:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0hcAAAAASUVORK5CYII=",
            },
          ],
        },
      }),
    target.id,
  );
  assert.equal(imageResult.error, undefined, JSON.stringify(imageResult));
  assert.equal(await x.locator("[contenteditable] img").count(), 1);
  await x.goto("https://x.com/compose/articles/edit/789012");
  await x.locator('[data-testid="composer"]').waitFor();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, target.id);
  const tablePayload = {
    title: "表格测试",
    segments: [
      { type: "html", html: "<p>表格前文</p>", text: "表格前文" },
      {
        type: "table",
        markdown: "| 名称 | 数值 |\n| :--- | ---: |\n| **甲** | 10 |",
      },
      { type: "html", html: "<p>两个表之间</p>", text: "两个表之间" },
      {
        type: "table",
        markdown: "| 第二张 | 内容 |\n| --- | --- |\n| 乙 | 测试 |",
      },
      { type: "html", html: "<p>表格后文</p>", text: "表格后文" },
    ],
  };
  const tableResult = await worker.evaluate(
    ({ tabId, payload }) =>
      chrome.tabs.sendMessage(tabId, { type: "MDX_WRITE", payload }),
    { tabId: target.id, payload: tablePayload },
  );
  assert.equal(tableResult.error, undefined, JSON.stringify(tableResult));
  assert.equal(await x.locator("[data-native-table] table").count(), 2);
  assert.equal(
    await x.locator("[data-native-table] th").nth(1).getAttribute("align"),
    "right",
  );
  assert.equal(await x.locator("[data-native-table] strong").innerText(), "甲");
  const raw = await x.evaluate(() =>
    JSON.parse(localStorage.getItem(location.pathname)),
  );
  assert.equal(
    Object.values(raw.entityMap).filter((e) => e.type === "MARKDOWN").length,
    2,
  );
  const blockOrder = raw.blocks
    .map((b) => (b.type === "atomic" ? "表格" : b.text))
    .filter(Boolean);
  assert.deepEqual(blockOrder, [
    "表格前文",
    "表格",
    "两个表之间",
    "表格",
    "表格后文",
  ]);
  await x.reload();
  await x.locator("[data-native-table] table").first().waitFor();
  assert.equal(await x.locator("[data-native-table] table").count(), 2);
  assert.doesNotMatch(
    await x.locator('[contenteditable="true"]').first().innerText(),
    /MDXTABLE_/,
  );
  await x.screenshot({ path: "artifacts/native-tables.png", fullPage: true });
  await x.goto("https://x.com/compose/articles/edit/345678");
  await x.locator('[data-testid="composer"]').waitFor();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, target.id);
  const onlyTable = await worker.evaluate(
    ({ tabId, payload }) =>
      chrome.tabs.sendMessage(tabId, { type: "MDX_WRITE", payload }),
    {
      tabId: target.id,
      payload: {
        title: "仅表格",
        segments: [tablePayload.segments[1], tablePayload.segments[3]],
      },
    },
  );
  assert.equal(onlyTable.error, undefined, JSON.stringify(onlyTable));
  assert.equal(await x.locator("[data-native-table] table").count(), 2);

  await x.goto("https://x.com/compose/articles/edit/987654326");
  await x.locator('[data-testid="composer"]').waitFor();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, target.id);
  const codeMarkdown =
    "```javascript\nfunction hello() {\n  const x = 1;\n\n  return x;\n}\n```";
  const mixedResult = await worker.evaluate(
    ({ tabId, payload }) =>
      chrome.tabs.sendMessage(tabId, { type: "MDX_WRITE", payload }),
    {
      tabId: target.id,
      payload: {
        title: "代码混排",
        segments: [
          { type: "html", html: "<p>代码前文</p>", text: "代码前文" },
          { type: "code", markdown: codeMarkdown },
          tablePayload.segments[1],
          { type: "code", markdown: "```python\nprint(1)\n```" },
          { type: "html", html: "<p>代码后文</p>", text: "代码后文" },
        ],
      },
    },
  );
  assert.equal(mixedResult.error, undefined, JSON.stringify(mixedResult));
  assert.equal(await x.locator("pre code").count(), 2);
  assert.equal(
    await x.locator("pre code").first().textContent(),
    "function hello() {\n  const x = 1;\n\n  return x;\n}\n",
  );
  assert.equal(
    await x.locator("pre code").first().getAttribute("class"),
    "language-javascript",
  );
  const mixedRaw = await x.evaluate(() =>
    JSON.parse(localStorage.getItem(location.pathname)),
  );
  const atomicMarkdown = mixedRaw.blocks
    .filter((b) => b.type === "atomic")
    .map((b) => mixedRaw.entityMap[b.entityRanges[0].key].data.markdown);
  assert.deepEqual(atomicMarkdown, [
    codeMarkdown,
    tablePayload.segments[1].markdown,
    "```python\nprint(1)\n```",
  ]);
  const mixedText = mixedRaw.blocks
    .filter((b) => b.type !== "atomic")
    .map((b) => b.text)
    .filter(Boolean);
  assert.deepEqual(mixedText, ["代码前文", "代码后文"]);
  await x.reload();
  await x.locator("pre code").first().waitFor();
  assert.equal(await x.locator("pre code").count(), 2);
  assert.equal(await x.locator("table").count(), 1);

  await x.goto("https://x.com/compose/articles/edit/987654327");
  await x.locator('[data-testid="composer"]').waitFor();
  await panel.locator("#source-view").click();
  await panel
    .locator("#markdown")
    .fill("# 进度测试\n\n![测试图](https://images.example.com/progress.png)");
  await panel.waitForFunction(() =>
    document.querySelector("#image-summary").textContent.includes("1 张就绪"),
  );
  await x.evaluate(() => {
    window.celebrated = false;
    new MutationObserver(() => {
      if (document.querySelector(".mdx-confetti")) window.celebrated = true;
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await worker.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }),
    target.id,
  );
  await panel.evaluate(() => document.querySelector("#write").click());
  await panel.waitForFunction(() =>
    document
      .querySelector("#status-message")
      .textContent.includes("已写入 X 草稿"),
  );
  assert.equal(
    await panel.locator("#image-progress").textContent(),
    "图片导入完成：1 / 1",
  );

  assert.equal(await x.evaluate(() => window.celebrated), true);
  assert.equal(await panel.locator(".confetti").count(), 0);
  assert.equal(
    await x.evaluate(() => {
      const rect = document
        .querySelector('[data-testid="composer"]')
        .getBoundingClientRect();
      const piece = document.querySelector(".mdx-confetti span");
      return (
        Math.abs(parseFloat(piece.style.left) - (rect.left + rect.width / 2)) <
        1
      );
    }),
    true,
    "彩带从 X 正文顶部中央播放",
  );
  await x.waitForFunction(() => !document.querySelector(".mdx-confetti"));
  await x.evaluate(() => {
    window.celebrated = false;
  });
  await panel.evaluate(() => document.querySelector("#write").click());
  await panel.waitForFunction(() =>
    document.querySelector("#status-message").textContent.includes("空白草稿"),
  );
  assert.equal(await x.evaluate(() => window.celebrated), false);

  await x.goto("https://x.com/compose/articles/edit/987654328");
  await x.locator('[data-testid="composer"]').waitFor();
  await worker.evaluate(
    async (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      }),
    target.id,
  );
  // Reproduce the failure boundary: X accepts ordinary text but a later
  // marker paste cannot be relied on. Native blocks must bypass this path.
  await x.evaluate(() => {
    window.markerPastes = 0;
    document.addEventListener(
      "paste",
      (event) => {
        if (event.clipboardData?.getData("text/plain").includes("MDXTABLE_")) {
          window.markerPastes++;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
  const longSource = await readFile("tests/fixtures/long-article.md", "utf8");
  const longArticle = parseArticle(longSource, {
    document: new JSDOM("").window.document,
    filename: "技术选型.md",
  });
  const imageData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const longResult = await worker.evaluate(
    ({ tabId, payload }) =>
      chrome.tabs.sendMessage(tabId, { type: "MDX_WRITE", payload }),
    {
      tabId: target.id,
      payload: {
        title: longArticle.title,
        segments: longArticle.segments.map((s) =>
          s.type === "image" ? { ...s, dataURL: imageData } : s,
        ),
      },
    },
  );
  assert.equal(longResult.error, undefined, JSON.stringify(longResult));
  assert.equal(await x.evaluate(() => window.markerPastes), 0);
  const longRaw = await x.evaluate(() =>
    JSON.parse(localStorage.getItem(location.pathname)),
  );
  const norm = (text) => text.replace(/\s/g, "");
  assert.equal(
    norm(
      longRaw.blocks
        .filter((b) => b.type !== "atomic")
        .map((b) => b.text)
        .join(""),
    ),
    norm(
      longArticle.segments
        .filter((s) => s.type === "html")
        .map((s) => s.text)
        .join(""),
    ),
  );
  assert.equal(
    longRaw.blocks.filter((b) => b.type === "header-one").length,
    (longSource.match(/^## /gm) || []).length,
  );
  assert.equal(
    longRaw.blocks.filter((b) => b.type === "header-two").length,
    (longSource.match(/^### /gm) || []).length,
  );
  await x.reload();
  await x.getByText(/能够支撑选型的证据/).waitFor();

  assert.deepEqual(errors, []);
  console.log(
    "浏览器检查通过：文件导入、侧栏预览、草稿恢复、400px 布局、网络图片自动加载、真实 DraftJS 富文本和图片传递、多表格顺序/对齐/格式、代码块语言/缩进/空行/混排/保存重载、覆盖保护",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
