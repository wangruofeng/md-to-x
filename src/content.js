import { inspectEditor, writeArticle } from "./x-adapter.js";
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const body = document.querySelector(
    '[data-testid="composer"][contenteditable="true"]',
  );
  if (!body) return;
  const rect = body.getBoundingClientRect();
  const x = Math.max(16, Math.min(innerWidth - 16, rect.left + rect.width / 2));
  const y = Math.max(40, Math.min(innerHeight - 40, rect.top));
  const layer = document.createElement("div");
  layer.className = "mdx-confetti";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
    overflow: "hidden",
  });
  const colors = ["#ff6464", "#f4c542", "#45ba9a", "#5997ed", "#b779db"];
  for (let i = 0; i < 48; i++) {
    const piece = document.createElement("span");
    Object.assign(piece.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: "7px",
      height: "13px",
      background: colors[i % colors.length],
      opacity: "0",
    });
    layer.append(piece);
    const drift = (Math.random() - 0.5) * Math.min(rect.width, 600);
    piece.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${drift * 0.55}px, -70px) rotate(200deg)`,
          opacity: 1,
          offset: 0.3,
        },
        {
          transform: `translate(${drift}px, 240px) rotate(620deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 2000,
        delay: Math.random() * 250,
        easing: "ease-out",
        fill: "forwards",
      },
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
}
if (!globalThis.__mdToX) {
  globalThis.__mdToX = true;
  let busy = false;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "MDX_INSPECT") {
      reply(inspectEditor(document, location.href));
      return;
    }
    if (message.type !== "MDX_WRITE") return;
    if (busy) {
      reply({ error: "正在写入，请稍候" });
      return;
    }
    busy = true;
    writeArticle(message.payload, {
      nativeTable: async (request) => {
        const result = await chrome.runtime.sendMessage({
          type: "MDX_NATIVE_TABLE",
          request,
        });
        if (result?.error) throw new Error(result.error);
        if (!result) throw new Error("X 表格桥接未响应");
        return result;
      },
      onProgress: (progress) =>
        chrome.runtime
          .sendMessage({ type: "MDX_PROGRESS", ...progress })
          .catch(() => {}),
    })
      .then(
        (result) => {
          try {
            celebrate();
          } catch {
            /* Decoration must not turn a successful import into a failure. */
          }
          reply(result);
        },
        (error) => reply({ error: error.message }),
      )
      .finally(() => {
        busy = false;
      });
    return true;
  });
}
