import "./sidepanel.css";
import { EditHistory } from "./edit-history.js";
import { parseArticle, resolveLocalImage, MAX_IMAGE_BYTES } from "./article.js";
const $ = (id) => document.getElementById(id);
const extension = !!globalThis.chrome?.runtime?.id;
const storage = extension
  ? chrome.storage.local
  : {
      async get(key) {
        return { [key]: JSON.parse(localStorage.getItem(key) || "null") };
      },
      async set(values) {
        for (const [k, v] of Object.entries(values))
          localStorage.setItem(k, JSON.stringify(v));
      },
    };
let filename = "未命名.md",
  article,
  files = [],
  assets = new Map(),
  drafts = [],
  busy = false,
  timer;
const remoteLoads = new Map();
const remoteAttempts = new Set();
let documentGeneration = 0;
const source = $("markdown");
const editValue = () => ({
  source: source.value,
  title: $("article-title").value,
  start: source.selectionStart,
  end: source.selectionEnd,
});
let history = new EditHistory(editValue());
const message = (text, error = false) => {
  $("status-message").hidden = !text;
  $("status-message").textContent = text;
  $("status-message").classList.toggle("error", error);
};
const snapshot = () => ({
  source: source.value,
  title: $("article-title").value,
  filename,
  updatedAt: Date.now(),
  history: history.serialize(),
});
async function save() {
  try {
    await storage.set({ current: snapshot() });
    $("save-state").textContent = "已自动保存";
  } catch {
    $("save-state").textContent = "保存失败";
  }
}
function tab(name) {
  for (const id of ["writing", "assets", "drafts"]) $(id).hidden = id !== name;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
    b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false");
  });
}
function imageState() {
  $("image-list").replaceChildren();
  for (const img of article?.images || []) {
    const row = document.createElement("div");
    row.className = "image-item";
    const text = document.createElement("p");
    text.textContent = `${assets.has(img.src) || img.src.startsWith("data:") ? "✓" : "○"} ${img.alt || img.src}`;
    row.append(text);
    $("image-list").append(row);
  }
  $("image-summary").textContent =
    `${article?.images.length || 0} 张图片 · ${article?.images.filter((i) => assets.has(i.src) || i.src.startsWith("data:")).length || 0} 张就绪`;
}
function render() {
  try {
    article = parseArticle(source.value, {
      document,
      title: $("article-title").value,
      filename,
    });
    if (!$("article-title").value && source.value.trim())
      $("article-title").value = article.title;
    $("welcome").hidden = !!source.value;
    $("document").hidden = !source.value;
    $("filename").textContent = filename;
    $("stats").textContent =
      `${article.stats.characters} 字符 · ${article.images.length} 图 · ${article.stats.tables} 表格`;
    $("asset-count").textContent = article.images.length;
    const template = document.createElement("template");
    template.innerHTML = article.html;
    template.content.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (assets.has(src)) img.src = assets.get(src);
      else if (/^https?:\/\//i.test(src)) {
        img.referrerPolicy = "no-referrer";
      } else if (!src.startsWith("data:")) {
        const placeholder = document.createElement("p");
        placeholder.className = "image-placeholder";
        placeholder.textContent = `▧ ${img.alt || "图片"} · 请在「图片」中加载`;
        img.replaceWith(placeholder);
      }
    });
    $("preview").replaceChildren(template.content);
    $("checks").hidden = !article.warnings.length;
    $("checks-summary").textContent = `${article.warnings.length} 项格式提示`;
    $("check-list").replaceChildren(
      ...article.warnings.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
    imageState();
    queueMicrotask(() =>
      prepareRemoteImages().catch((e) =>
        message(`图片未全部加载：${e.message}`, true),
      ),
    );
    $("write").disabled = !source.value || busy;
    $("save-draft").disabled = !source.value || busy;
  } catch (error) {
    article = null;
    message(error.message, true);
    $("write").disabled = true;
  }
}
function load(data) {
  clearTimeout(timer);
  documentGeneration++;
  remoteLoads.clear();
  remoteAttempts.clear();
  filename = data.filename || "未命名.md";
  source.value = data.source || "";
  $("article-title").value = data.title || "";
  assets.clear();
  files = [];
  render();
  history = new EditHistory(editValue(), data.history);
  save();
  tab("writing");
}
async function importFile(file) {
  if (!file) return;
  if (!/\.(md|markdown)$/i.test(file.name))
    return message("请选择 .md 或 .markdown 文件", true);
  if (file.size > 2 * 1024 * 1024)
    return message("Markdown 文件不能超过 2 MB", true);
  if (source.value.trim()) await addDraft();
  load({ source: await file.text(), filename: file.name });
  message("已导入，检查预览后即可写入 X");
}
function renderDrafts() {
  $("draft-count").textContent = drafts.length;
  $("draft-list").replaceChildren();
  if (!drafts.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "还没有保存的版本。";
    $("draft-list").append(p);
  }
  for (const draft of drafts) {
    const row = document.createElement("div");
    row.className = "draft-item";
    const open = document.createElement("button");
    open.className = "text-button";
    open.textContent = `${draft.title || draft.filename} · ${new Date(draft.updatedAt).toLocaleString("zh-CN")}`;
    open.onclick = () => load(draft);
    const remove = document.createElement("button");
    remove.className = "draft-delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", "删除草稿");
    remove.onclick = async () => {
      drafts = drafts.filter((d) => d.id !== draft.id);
      await storage.set({ drafts });
      renderDrafts();
    };
    row.append(open, remove);
    $("draft-list").append(row);
  }
}
async function addDraft() {
  drafts = [{ ...snapshot(), id: crypto.randomUUID() }, ...drafts].slice(0, 20);
  await storage.set({ drafts });
  renderDrafts();
}
const readData = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(blob);
  });
async function prepareFile(file) {
  if (
    !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
    file.size > MAX_IMAGE_BYTES
  )
    throw new Error("图片仅支持 PNG/JPEG/WebP/GIF，且不能超过 15 MB");
  return readData(file);
}
async function editor() {
  if (!extension) throw new Error("请先在 Chrome 加载 dist 文件夹中的扩展");
  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!active?.url?.startsWith("https://x.com/compose/articles/edit/"))
    throw new Error("请在当前标签页打开 X 文章的空白草稿");
  await chrome.scripting.executeScript({
    target: { tabId: active.id },
    files: ["content.js"],
  });
  const result = await chrome.tabs.sendMessage(active.id, {
    type: "MDX_INSPECT",
  });
  if (!result.ready) throw new Error(result.reason);
  return { id: active.id, ...result };
}
$("demo-banner").hidden = extension;
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$("import").onclick = $("welcome-import").onclick = () =>
  $("file-input").click();
$("file-input").onchange = (e) =>
  importFile(e.target.files[0]).catch((e) => message(e.message, true));
$("sample").onclick = () =>
  load({
    filename: "欢迎使用.md",
    source:
      "# 把写作的时间，还给写作\n\n从 Markdown 到 X 长文，只需要一份文档。\n\n## 专注内容\n\n保留 **重要观点**、*语气*和[参考链接](https://example.com)。\n\n- 导入 Markdown\n- 检查文章预览\n- 写入空白草稿\n\n> 好的工具，让表达更轻松。",
  });
source.oninput = () => {
  render();
  history.record(editValue());
  $("save-state").textContent = "正在保存…";
  clearTimeout(timer);
  timer = setTimeout(save, 400);
};
$("article-title").oninput = source.oninput;
$("welcome").addEventListener("paste", (e) => {
  const text = e.clipboardData.getData("text/plain");
  if (text) {
    e.preventDefault();
    load({ source: text });
  }
});
for (const event of ["dragenter", "dragover"])
  $("drop-zone").addEventListener(event, (e) => {
    e.preventDefault();
    if (!busy) $("drop-overlay").hidden = false;
  });
$("drop-zone").addEventListener("dragleave", (e) => {
  if (!$("drop-zone").contains(e.relatedTarget))
    $("drop-overlay").hidden = true;
});
$("drop-zone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("drop-overlay").hidden = true;
  if (!busy)
    importFile(e.dataTransfer.files[0]).catch((e) => message(e.message, true));
});
function view(preview) {
  $("preview").hidden = !preview;
  $("source-container").hidden = preview;
  $("source-view").classList.toggle("selected", !preview);
  $("preview-view").classList.toggle("selected", preview);
  $("source-view").setAttribute("aria-pressed", String(!preview));
  $("preview-view").setAttribute("aria-pressed", String(preview));
}
$("source-view").onclick = () => view(false);
$("preview-view").onclick = () => view(true);
function format(kind) {
  if (busy) return;
  view(false);
  const [before, after] = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    heading: ["\n## ", "\n"],
    subheading: ["\n### ", "\n"],
    quote: ["\n> ", "\n"],
    list: ["\n- ", "\n"],
    "ordered-list": ["\n", "\n"],
    link: ["[", "](https://example.com)"],
    image: ["![", "](imgs/image.png)"],
    code: ["\n```\n", "\n```\n"],
  }[kind];
  const start = source.selectionStart,
    end = source.selectionEnd;
  const selected = source.value.slice(start, end) || "内容";
  const content =
    kind === "ordered-list"
      ? selected
          .split("\n")
          .map((line, i) => `${i + 1}. ${line}`)
          .join("\n")
      : selected;
  source.setRangeText(before + content + after, start, end, "select");
  source.focus();
  source.oninput();
}
document
  .querySelectorAll("[data-format]")
  .forEach((b) => (b.onclick = () => format(b.dataset.format)));
source.onkeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && ["b", "i"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    format(e.key.toLowerCase() === "b" ? "bold" : "italic");
  }
};
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.isComposing) return;
  const key = e.key.toLowerCase();
  if (key === "s") {
    e.preventDefault();
    clearTimeout(timer);
    save();
    return;
  }
  if (
    busy ||
    (![source, $("article-title")].includes(e.target) &&
      !(e.target === document.body && !$("writing").hidden))
  )
    return;
  if (key !== "z" && !(key === "y" && e.ctrlKey)) return;
  e.preventDefault();
  const value = history.move(e.shiftKey || key === "y" ? 1 : -1);
  if (!value) return;
  source.value = value.source;
  $("article-title").value = value.title;
  render();
  source.setSelectionRange(value.start ?? 0, value.end ?? 0);
  clearTimeout(timer);
  save();
});
$("save-draft").onclick = () =>
  addDraft().then(
    () => {
      clearTimeout(timer);
      load({});
      message("已存入草稿，编辑区已清空");
    },
    (e) => message(e.message, true),
  );
$("choose-folder").onclick = () => $("folder-input").click();
$("folder-input").onchange = async (e) => {
  files = [...e.target.files];
  try {
    for (const image of article?.images || []) {
      if (/^(https?:|data:)/.test(image.src)) continue;
      const file = resolveLocalImage(image.src, files);
      if (file) assets.set(image.src, await prepareFile(file));
    }
    $("folder-state").textContent =
      `已选择 ${files.length} 个文件；仅载入文章引用的图片`;
    render();
  } catch (e) {
    message(e.message, true);
  }
};
async function prepareRemoteImages(retry = false) {
  const generation = documentGeneration;
  const images =
    article?.images.filter(
      (i) => /^https?:/i.test(i.src) && !assets.has(i.src),
    ) || [];
  const results = await Promise.allSettled(
    images.map((img) => {
      if (remoteLoads.has(img.src)) return remoteLoads.get(img.src);
      if (!retry && remoteAttempts.has(img.src)) return;
      remoteAttempts.add(img.src);
      const pending = (async () => {
        const response = await fetch(img.src, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`图片加载失败：${response.status}`);
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_IMAGE_BYTES) throw new Error("网络图片超过 15 MB");
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error("网络图片超过 15 MB");
          }
          chunks.push(value);
        }
        const dataURL = await prepareFile(
          new Blob(chunks, {
            type: response.headers.get("content-type")?.split(";")[0] || "",
          }),
        );
        if (generation === documentGeneration) assets.set(img.src, dataURL);
      })();
      remoteLoads.set(img.src, pending);
      pending
        .finally(() => {
          if (remoteLoads.get(img.src) === pending) remoteLoads.delete(img.src);
        })
        .catch(() => {});
      return pending;
    }),
  );
  if (generation !== documentGeneration) return;
  if (images.some((i) => assets.has(i.src))) imageState();
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
}
$("check-editor").onclick = async () => {
  try {
    const result = await editor();
    $("connection-text").textContent = result.occupied
      ? "已连接 · 请新建空白草稿"
      : "已连接 · 空白草稿就绪";
    $("connection-dot").classList.add("connected");
    message("");
  } catch (e) {
    message(e.message, true);
    $("connection-text").textContent = "尚未连接 X 编辑器";
  }
};
$("write").onclick = async () => {
  if (busy || !article) return;
  try {
    await prepareRemoteImages(true);
    const payload = {
      title: $("article-title").value,
      segments: article.segments.map((s) =>
        s.type === "image"
          ? {
              ...s,
              dataURL:
                assets.get(s.src) || (s.src.startsWith("data:") ? s.src : ""),
            }
          : s,
      ),
    };
    if (payload.segments.some((s) => s.type === "image" && !s.dataURL)) {
      tab("assets");
      throw new Error("请先准备全部图片，再写入 X");
    }
    const target = await editor();
    if (target.occupied) throw new Error("请新建空白草稿，现有内容不会被覆盖");
    busy = true;
    document.querySelectorAll("button,input,textarea").forEach((el) => {
      el.disabled = true;
    });
    source.disabled = true;
    $("article-title").disabled = true;
    $("import").disabled = true;
    $("progress").hidden = false;
    $("progress").value = 0;
    const imageTotal = payload.segments.filter(
      (s) => s.type === "image",
    ).length;
    $("image-progress").hidden = imageTotal === 0;
    $("image-progress").textContent = `图片导入：0 / ${imageTotal}`;
    render();
    message("正在写入，请保持当前 X 编辑器打开…");
    const result = await chrome.tabs.sendMessage(target.id, {
      type: "MDX_WRITE",
      payload,
    });
    if (result.error) throw new Error(result.error);
    if (imageTotal)
      $("image-progress").textContent =
        `图片导入完成：${imageTotal} / ${imageTotal}`;
    message("已写入 X 草稿，请在 X 检查格式和图片后发布");
  } catch (e) {
    message(e.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button,input,textarea").forEach((el) => {
      el.disabled = false;
    });
    source.disabled = false;
    $("article-title").disabled = false;
    $("import").disabled = false;
    $("progress").hidden = true;
    render();
  }
};
if (extension)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "MDX_PROGRESS" && busy) {
      $("progress").value = (msg.done / msg.total) * 100;
      if (msg.imagesTotal) {
        $("image-progress").hidden = false;
        $("image-progress").textContent = msg.importingImage
          ? `正在导入第 ${msg.imagesDone + 1} / ${msg.imagesTotal} 张图片…`
          : `图片导入：${msg.imagesDone} / ${msg.imagesTotal}`;
      }
    }
  });
$("help").onclick = () => $("help-dialog").showModal();
document.querySelectorAll("[data-icon]").forEach((el) => {
  el.textContent =
    {
      upload: "↥",
      help: "?",
      file: "▤",
      quote: "❞",
      list: "☷",
      code: "‹›",
      eye: "◉",
      lock: "◇",
      folder: "▱",
      send: "↗",
    }[el.dataset.icon] || "";
  if (el.dataset.icon === "ordered-list")
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h11M10 12h11M10 18h11M3 3h1v5M3 8h3M3 12c0-2 3-2 3 0 0 1-3 3-3 4h3M3 19h2a1 1 0 0 1 0 2H3"/></svg>';
  if (el.dataset.icon === "link")
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  if (el.dataset.icon === "image")
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  el.setAttribute("aria-hidden", "true");
});
try {
  const result = await storage.get("current");
  const saved = await storage.get("drafts");
  drafts = saved.drafts || [];
  if (result.current) load(result.current);
  else render();
  renderDrafts();
} catch (e) {
  render();
  message(`无法恢复本地草稿：${e.message}`, true);
}
