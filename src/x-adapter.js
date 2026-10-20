const nodes = (doc) => ({
  title: doc.querySelector(
    'textarea[maxlength="100"]:not([aria-hidden="true"])',
  ),
  body: doc.querySelector('[data-testid="composer"][contenteditable="true"]'),
});
export function inspectEditor(document, url) {
  const location = new URL(url);
  const { title, body } = nodes(document);
  const ready =
    location.origin === "https://x.com" &&
    /^\/compose\/articles\/edit\/\d+(\/focus)?\/?$/.test(location.pathname) &&
    !!title &&
    !!body;
  return {
    ready,
    occupied:
      ready &&
      !!(
        title.value.trim() ||
        body.textContent.replace(/[\u200b-\u200d\ufeff]/g, "").trim() ||
        body.querySelector('img,video,[data-block-type="atomic"]')
      ),
    reason: ready ? "" : "请在 X 文章中打开一个空白草稿",
  };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await pause(100);
  }
  throw new Error(
    "X 未确认接收内容。可能已有部分写入，请到 X 检查，勿重复导入。",
  );
}
export async function writeArticle(
  payload,
  {
    document = globalThis.document,
    url = globalThis.location.href,
    onProgress = () => {},
    nativeTable,
  } = {},
) {
  const state = inspectEditor(document, url);
  if (!state.ready) throw new Error(state.reason);
  if (state.occupied) throw new Error("请新建空白草稿，现有内容不会被覆盖");
  if (!payload.title?.trim() || [...payload.title].length > 100)
    throw new Error("请填写不超过 100 字的标题");
  if (
    payload.segments.some(
      (s) =>
        s.type === "image" &&
        !/^data:image\/(png|jpeg|webp|gif);base64,/.test(s.dataURL || ""),
    )
  )
    throw new Error("图片尚未准备好");
  if (payload.segments.some((s) => s.type === "table" || s.type === "code")) {
    if (!nativeTable)
      throw new Error("X 原生 Markdown 桥接不可用，尚未写入草稿");
    await nativeTable({ action: "check" });
  }
  const latest = inspectEditor(document, globalThis.location?.href || url);
  if (
    !latest.ready ||
    latest.occupied ||
    new URL(globalThis.location?.href || url).pathname !== new URL(url).pathname
  )
    throw new Error("草稿已变化，请重新检查空白草稿");
  const { title, body } = nodes(document);
  const win = document.defaultView;
  Object.getOwnPropertyDescriptor(
    win.HTMLTextAreaElement.prototype,
    "value",
  ).set.call(title, payload.title);
  title.dispatchEvent(new win.Event("input", { bubbles: true }));
  title.dispatchEvent(new win.Event("change", { bubbles: true }));
  const imagesTotal = payload.segments.filter((s) => s.type === "image").length;
  let imagesDone = 0;
  for (const [i, segment] of payload.segments.entries()) {
    onProgress({
      done: i,
      total: payload.segments.length,
      imagesDone,
      imagesTotal,
      importingImage: segment.type === "image",
    });
    if (
      !body.isConnected ||
      !inspectEditor(document, globalThis.location?.href || url).ready ||
      new URL(globalThis.location?.href || url).pathname !==
        new URL(url).pathname
    )
      throw new Error("编辑器已切换，请检查已写入的内容");
    if (nativeTable) {
      await nativeTable({ action: "focus" });
      await pause(0);
    }
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    win.getSelection().removeAllRanges();
    win.getSelection().addRange(range);
    if (segment.type === "table" || segment.type === "code") {
      // Append directly to the current DraftJS state. Only an entirely empty
      // editor needs a seed character to obtain DraftJS character metadata.
      let marker;
      if (!body.textContent.trim()) {
        marker = `MDXTABLE_${win.crypto.randomUUID()}`;
        const transfer = new win.DataTransfer();
        transfer.setData("text/html", `<p>${marker}</p>`);
        transfer.setData("text/plain", marker);
        body.dispatchEvent(
          new win.ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
        await until(() => body.textContent.includes(marker));
      }
      const previousMarkdown = (await nativeTable({ action: "read" })).markdown
        .length;
      await nativeTable({
        action: "insert",
        marker,
        markdown: segment.markdown,
      });
      // Wait for the editor's committed state, not just rendered placeholder text.
      let confirmed = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await nativeTable({ action: "read" });
        if (
          current.markdown.length === previousMarkdown + 1 &&
          current.markdown.at(-1) === segment.markdown &&
          (!marker || !current.text.includes(marker))
        ) {
          confirmed = true;
          break;
        }
        await pause(100);
      }
      if (!confirmed)
        throw new Error(
          "X 未确认保存 Markdown 内容块，请检查草稿，勿重复导入。",
        );
      onProgress({
        done: i + 1,
        total: payload.segments.length,
        imagesDone,
        imagesTotal,
        importingImage: false,
      });
      continue;
    }
    const transfer = new win.DataTransfer();
    const previous = body.textContent;
    const media = body.querySelectorAll(
      'img,video,[data-block-type="atomic"]',
    ).length;
    if (segment.type === "html") {
      transfer.setData("text/html", segment.html);
      transfer.setData("text/plain", segment.text);
    } else {
      const [header, encoded] = segment.dataURL.split(",");
      const bytes = Uint8Array.from(win.atob(encoded), (c) => c.charCodeAt(0));
      transfer.items.add(
        new win.File(
          [bytes],
          `article-${i}.${header.includes("jpeg") ? "jpg" : header.match(/image\/(\w+)/)[1]}`,
          { type: header.match(/data:([^;]+)/)[1] },
        ),
      );
    }
    body.dispatchEvent(
      new win.ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    await until(() =>
      segment.type === "html"
        ? body.textContent !== previous &&
          body.textContent
            .replace(/\s/g, "")
            .includes(segment.text.replace(/\s/g, ""))
        : body.querySelectorAll('img,video,[data-block-type="atomic"]').length >
          media,
    );
    if (segment.type === "image") imagesDone++;
    onProgress({
      done: i + 1,
      total: payload.segments.length,
      imagesDone,
      imagesTotal,
      importingImage: false,
    });
  }
  const normalize = (text) => text.replace(/\s/g, "");
  const imported = nativeTable
    ? await nativeTable({ action: "read" })
    : { text: body.textContent };
  const expected = payload.segments
    .filter((s) => s.type === "html")
    .map((s) => s.text)
    .join("");
  if (!normalize(imported.text).includes(normalize(expected)))
    throw new Error(
      "正文完整性校验失败，可能有内容缺失，请检查 X 草稿，勿重复导入。",
    );
  if (nativeTable) {
    const expectedMarkdown = payload.segments
      .filter((s) => s.type === "table" || s.type === "code")
      .map((s) => s.markdown);
    if (JSON.stringify(imported.markdown) !== JSON.stringify(expectedMarkdown))
      throw new Error(
        "表格或代码块完整性校验失败，请检查 X 草稿，勿重复导入。",
      );
  }
  return { success: true };
}
