import { marked } from "marked";
import createDOMPurify from "dompurify";
import { parseDocument } from "yaml";

const allowedTags = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
  "pre",
  "code",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
];
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function isRemoteImage(src) {
  return /^https?:\/\//i.test(src);
}

function safeImage(src) {
  return (
    (!!src && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) ||
    /^https?:\/\//i.test(src) ||
    /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(src)
  );
}

export function parseArticle(
  source,
  { document = globalThis.document, title = "", filename = "" } = {},
) {
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES)
    throw new Error("Markdown 超过 2 MB，请拆分后导入。");
  let body = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  let metaTitle = "";
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (frontmatter) {
    const meta = parseDocument(frontmatter[1]);
    if (meta.errors.length)
      throw new Error(
        `frontmatter 格式有误：${meta.errors[0].message.split("\n")[0]}`,
      );
    const data = meta.toJS({ maxAliasCount: 20 });
    if (typeof data?.title === "string") metaTitle = data.title.trim();
    body = body.slice(frontmatter[0].length);
  }
  const purifier = createDOMPurify(document.defaultView);
  document = document.implementation.createHTMLDocument();
  const plain = (html) => {
    const el = document.createElement("div");
    el.innerHTML = purifier.sanitize(html);
    return el.textContent.trim();
  };
  const tokens = marked.lexer(body, { gfm: true });
  const first = tokens.find((t) => t.type !== "space");
  const heading =
    first?.type === "heading" && first.depth === 1
      ? plain(marked.parseInline(first.text))
      : "";
  if (heading && (!metaTitle || heading === metaTitle))
    tokens.splice(tokens.indexOf(first), 1);
  const articleTitle =
    title.trim() ||
    metaTitle ||
    heading ||
    filename.replace(/\.(?:md|markdown)$/i, "") ||
    "";
  const tableMarkdown = [];
  const codeMarkdown = [];
  const renderer = new marked.Renderer();
  const renderTable = renderer.table;
  renderer.table = function (token) {
    const id = tableMarkdown.push(token.raw.trim()) - 1;
    return renderTable
      .call(this, token)
      .replace("<table>", `<table data-mdx-table="${id}">`);
  };
  const renderCode = renderer.code;
  renderer.code = function (token) {
    let fenceLength = 3;
    for (const match of token.text.matchAll(/`+/g))
      fenceLength = Math.max(fenceLength, match[0].length + 1);
    const fence = "`".repeat(fenceLength);
    const markdown = `${fence}${token.lang || ""}\n${token.text}${token.text.endsWith("\n") ? "" : "\n"}${fence}`;
    const id = codeMarkdown.push(markdown) - 1;
    return renderCode
      .call(this, token)
      .replace("<pre>", `<pre data-mdx-code="${id}">`);
  };
  const html = purifier.sanitize(
    marked.parser(tokens, { gfm: true, renderer }),
    {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "start",
        "align",
        "data-mdx-table",
        "data-mdx-code",
      ],
      ALLOW_DATA_ATTR: false,
    },
  );
  const preview = document.createElement("div");
  preview.innerHTML = html;
  for (const img of preview.querySelectorAll("img")) {
    if (!safeImage(img.getAttribute("src"))) img.remove();
  }
  for (const a of preview.querySelectorAll("a")) {
    const href = a.getAttribute("href") || "";
    if (!/^(?:https?:\/\/|mailto:|#)/i.test(href)) a.removeAttribute("href");
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  const images = [...preview.querySelectorAll("img")]
    .filter((img) => !img.closest("table"))
    .map((img, i) => ({
      id: i,
      src: img.getAttribute("src"),
      alt: img.getAttribute("alt") || `图片 ${i + 1}`,
    }));
  const stats = {
    characters: [...preview.textContent.trim()].length,
    images: images.length,
    tables: preview.querySelectorAll("table").length,
    codeBlocks: preview.querySelectorAll("pre").length,
  };
  const warnings = [];
  if (preview.querySelector("h4,h5,h6"))
    warnings.push("四级及以下标题按三级标题导入。");
  if (images.length > 25)
    warnings.push("图片超过 25 张，可能触及 X 的容量限制，建议拆分文章。");
  if ([...articleTitle].length > 100)
    warnings.push("标题超过 100 字符，请缩短后写入 X。");

  const output = preview.cloneNode(true);
  for (const heading of output.querySelectorAll("h4,h5,h6")) {
    const h3 = document.createElement("h3");
    h3.innerHTML = heading.innerHTML;
    heading.replaceWith(h3);
  }
  for (const heading of [...output.querySelectorAll("h2,h3")]) {
    const mapped = document.createElement(
      heading.tagName === "H2" ? "h1" : "h2",
    );
    mapped.innerHTML = heading.innerHTML;
    heading.replaceWith(mapped);
  }
  const segments = [];
  const range = document.createRange();
  let previous = null;
  function addFragment(end) {
    if (previous) range.setStartAfter(previous);
    else range.setStart(output, 0);
    if (end) range.setEndBefore(end);
    else range.setEnd(output, output.childNodes.length);
    const container = document.createElement("div");
    container.append(range.cloneContents());
    if (container.textContent.trim() || container.querySelector("hr")) {
      // Keep paste operations bounded at complete block boundaries.
      let chunk = document.createElement("div");
      const flush = () => {
        if (!chunk.childNodes.length) return;
        segments.push({
          type: "html",
          html: chunk.innerHTML,
          text: chunk.textContent.trim(),
        });
        chunk = document.createElement("div");
      };
      for (const node of [...container.childNodes]) {
        if (chunk.textContent.length + node.textContent.length > 1800) flush();
        chunk.append(node);
      }
      flush();
    }
  }
  let imageIndex = 0;
  for (const node of output.querySelectorAll("img,table,pre")) {
    if (node.parentElement?.closest("table,pre")) continue;
    addFragment(node);
    if (node.tagName === "TABLE") {
      const tableId = node.getAttribute("data-mdx-table");
      const markdown = tableId === null ? null : tableMarkdown[Number(tableId)];
      if (!markdown)
        throw new Error(
          "仅支持 Markdown 表格，请将 HTML 表格改为 Markdown 语法",
        );
      segments.push({ type: "table", markdown });
    } else if (node.tagName === "PRE") {
      const codeId = node.getAttribute("data-mdx-code");
      const markdown =
        codeId === null
          ? `\`\`\`\n${node.textContent}\n\`\`\``
          : codeMarkdown[Number(codeId)];
      segments.push({ type: "code", markdown });
    } else segments.push({ type: "image", ...images[imageIndex++] });
    previous = node;
  }
  addFragment(null);
  return {
    title: articleTitle,
    html: preview.innerHTML,
    text: preview.textContent.trim(),
    images,
    stats,
    warnings,
    segments,
  };
}

export function resolveLocalImage(src, files) {
  let path;
  try {
    path = decodeURIComponent(src.split(/[?#]/)[0]);
  } catch {
    path = src;
  }
  path = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
  const exact = files.filter((file) => {
    const relative = file.webkitRelativePath || file.name;
    return relative === path || relative.split("/").slice(1).join("/") === path;
  });
  if (exact.length === 1) return exact[0];
  // A basename fallback is safe only when there is exactly one candidate.
  const name = path.split("/").pop();
  const candidates = files.filter((file) => file.name === name);
  return candidates.length === 1 ? candidates[0] : null;
}
