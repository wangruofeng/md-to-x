chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.tab ||
    sender.frameId !== 0 ||
    message.type !== "MDX_NATIVE_TABLE"
  )
    return;
  if (!sender.url?.startsWith("https://x.com/compose/articles/edit/")) {
    reply({ error: "当前页面不是 X 长文草稿" });
    return;
  }
  (async () => {
    const target = { tabId: sender.tab.id };
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      files: ["table-main.js"],
    });
    const [result] = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: async (request) => {
        try {
          return await globalThis.__mdxNativeTable(request);
        } catch (error) {
          return { error: error.message };
        }
      },
      args: [message.request],
    });
    return result.result || { error: "未收到 X 表格接口响应" };
  })().then(reply, (error) => reply({ error: error.message }));
  return true;
});
