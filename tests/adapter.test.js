import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { inspectEditor, writeArticle } from "../src/x-adapter.js";

const url = "https://x.com/compose/articles/edit/123456";
function page(body = "") {
  return new JSDOM(
    `<textarea maxlength="100" placeholder="添加标题"></textarea><div contenteditable="true" data-testid="composer" role="textbox">${body}</div>`,
    { url },
  ).window.document;
}

test("只识别 X Articles 的专用编辑器，不把普通推文当成长文", () => {
  assert.equal(inspectEditor(page(), url).ready, true);
  assert.equal(
    inspectEditor(page(), "https://x.com/compose/post").ready,
    false,
  );
  assert.equal(
    inspectEditor(page(), "https://fake-x.com/compose/articles/edit/123456")
      .ready,
    false,
  );
});

test("正文、标题、媒体任意一项有内容都视为非空草稿", () => {
  assert.equal(inspectEditor(page("已有正文"), url).occupied, true);
  assert.equal(inspectEditor(page('<img src="x.png">'), url).occupied, true);
  const doc = page();
  doc.querySelector("textarea").value = "已有标题";
  assert.equal(inspectEditor(doc, url).occupied, true);
});

test("拒绝修改非空草稿，并且保留原始标题和正文", async () => {
  const doc = page("重要内容");
  doc.querySelector("textarea").value = "旧标题";
  await assert.rejects(
    writeArticle(
      {
        title: "新标题",
        segments: [{ type: "html", html: "<p>新正文</p>", text: "新正文" }],
      },
      { document: doc, url },
    ),
    /空白草稿/,
  );
  assert.equal(doc.querySelector("textarea").value, "旧标题");
  assert.equal(doc.querySelector("[contenteditable]").textContent, "重要内容");
});

test("导入前阻止超长标题及未准备好的图片", async () => {
  await assert.rejects(
    writeArticle(
      { title: "长".repeat(101), segments: [] },
      { document: page(), url },
    ),
    /100/,
  );
  const doc = page();
  await assert.rejects(
    writeArticle(
      { title: "标题", segments: [{ type: "image", src: "missing.png" }] },
      { document: doc, url },
    ),
    /图片/,
  );
  assert.equal(doc.querySelector("textarea").value, "");
});

test("原生表格接口不可用时，在修改标题和正文之前停止", async () => {
  const doc = page();
  const payload = {
    title: "表格",
    segments: [{ type: "table", markdown: "| 甲 |\n| --- |\n| 乙 |" }],
  };
  await assert.rejects(
    writeArticle(payload, { document: doc, url }),
    /Markdown 桥接/,
  );
  await assert.rejects(
    writeArticle(payload, {
      document: doc,
      url,
      nativeTable: async () => {
        throw new Error("版本不兼容");
      },
    }),
    /版本不兼容/,
  );
  assert.equal(doc.querySelector("textarea").value, "");
  assert.equal(doc.querySelector("[contenteditable]").textContent, "");
});
