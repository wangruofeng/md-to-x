// Runs only in the page's MAIN world. No page-message listener is exposed.
globalThis.__mdxNativeTable = function ({ action, marker, markdown }) {
  if (
    location.origin !== "https://x.com" ||
    !/^\/compose\/articles\/edit\/\d+(\/focus)?\/?$/.test(location.pathname)
  )
    throw new Error("当前页面不是 X 长文草稿");
  const element = document.querySelector(
    '[data-testid="composer"][contenteditable="true"]',
  );
  const key =
    element &&
    Object.keys(element).find(
      (k) =>
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$"),
    );
  let fiber = key && element[key],
    editor;
  for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
    if (
      fiber.stateNode?.props?.editorState?.getCurrentContent &&
      typeof fiber.stateNode.props.onChange === "function"
    ) {
      editor = fiber.stateNode;
      break;
    }
  }
  if (!editor)
    throw new Error(
      "X Markdown 内容块接口不可用，请刷新页面；尚未开始写入时可安全重试",
    );
  const state = editor.props.editorState;
  const State = state.constructor;
  const content = state.getCurrentContent();
  if (
    !content.createEntity ||
    !content.getBlockMap ||
    !State.push ||
    !State.forceSelection
  )
    throw new Error("X 编辑器版本不兼容，无法导入Markdown 内容块");
  if (action === "check") return { ready: true };
  if (action === "focus") {
    const last = content.getLastBlock();
    const selection = state.getSelection().merge({
      anchorKey: last.getKey(),
      focusKey: last.getKey(),
      anchorOffset: last.getLength(),
      focusOffset: last.getLength(),
      isBackward: false,
      hasFocus: true,
    });
    editor.props.onChange(State.forceSelection(state, selection));
    return { focused: true };
  }
  if (action === "read") {
    return {
      text: content
        .getBlockMap()
        .valueSeq()
        .filter((b) => b.getType() !== "atomic")
        .map((b) => b.getText())
        .join("\n"),
      markdown: content
        .getBlockMap()
        .valueSeq()
        .filter((b) => b.getType() === "atomic")
        .map((b) => {
          const key = b.getEntityAt(0);
          return key === null
            ? null
            : content.getEntity(key).getData().markdown;
        })
        .filter(Boolean)
        .toArray(),
    };
  }
  if (
    action !== "insert" ||
    (marker !== undefined && !/^MDXTABLE_[a-f\d-]+$/.test(marker)) ||
    typeof markdown !== "string" ||
    markdown.length > 2 * 1024 * 1024
  )
    throw new Error("无效的Markdown 内容块写入请求");
  const blocks = content.getBlockMap();
  const matches = marker && blocks.filter((b) => b.getText().includes(marker));
  const block = marker
    ? matches.size === 1
      ? matches.first()
      : null
    : content.getLastBlock();
  if (!block)
    throw new Error("Markdown 内容块定位失败。可能已有部分写入，请检查 X 草稿");
  const characters = marker
    ? block.getCharacterList()
    : blocks
        .valueSeq()
        .find((b) => b.getCharacterList().size)
        ?.getCharacterList();
  if (!characters?.size) throw new Error("无法取得Markdown 内容块占位块");
  const next = content.createEntity("MARKDOWN", "MUTABLE", { markdown });
  const entity = next.getLastCreatedEntityKey();
  const offset = marker ? block.getText().indexOf(marker) : 0;
  const before = marker ? block.getText().slice(0, offset) : block.getText();
  const after = marker ? block.getText().slice(offset + marker.length) : "";
  const newKey = () => {
    let key;
    do {
      key = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    } while (blocks.has(key));
    return key;
  };
  const atomic = block.merge({
    key: before ? newKey() : block.getKey(),
    type: "atomic",
    text: " ",
    depth: 0,
    characterList: characters
      .slice(offset, offset + 1)
      .map((c) => c.set("entity", entity)),
    data: block.getData().clear(),
  });
  const tail = block.merge({
    key: newKey(),
    type: "unstyled",
    text: after,
    depth: 0,
    characterList: marker
      ? characters.slice(offset + marker.length)
      : characters.slice(0, 0),
    data: block.getData().clear(),
  });
  const replacements = [];
  if (before)
    replacements.push(
      block.merge({
        text: before,
        characterList: marker
          ? characters.slice(0, offset)
          : block.getCharacterList(),
      }),
    );
  replacements.push(atomic, tail);
  const entries = [];
  next.getBlockMap().forEach((item, key) => {
    if (key === block.getKey())
      replacements.forEach((b) => entries.push([b.getKey(), b]));
    else entries.push([key, item]);
  });
  const updated = next.set("blockMap", blocks.constructor(entries));
  // Leave the caret in the trailing empty paragraph, so following prose stays outside the Markdown block.
  const last = updated.getLastBlock();
  const selection = state.getSelection().merge({
    anchorKey: last.getKey(),
    focusKey: last.getKey(),
    anchorOffset: last.getLength(),
    focusOffset: last.getLength(),
    isBackward: false,
    hasFocus: true,
  });
  const result = State.forceSelection(
    State.push(
      state,
      updated.set("selectionAfter", selection),
      "insert-fragment",
    ),
    selection,
  );
  editor.props.onChange(result);
  return { inserted: true, blockKey: atomic.getKey() };
};
