import React from "react";
import { createRoot } from "react-dom/client";
import draft from "draft-js";
const { Editor, EditorState, convertToRaw, convertFromRaw } = draft;
import { marked } from "marked";
function TableBlock({ block, contentState }) {
  const data = contentState.getEntity(block.getEntityAt(0)).getData();
  return React.createElement("div", {
    "data-native-table": true,
    contentEditable: false,
    dangerouslySetInnerHTML: { __html: marked.parse(data.markdown) },
  });
}
function Fixture() {
  const [state, setState] = React.useState(() => {
    const raw = localStorage.getItem(location.pathname);
    return raw
      ? EditorState.createWithContent(convertFromRaw(JSON.parse(raw)))
      : EditorState.createEmpty();
  });
  return React.createElement(
    "main",
    null,
    React.createElement("textarea", {
      maxLength: 100,
      placeholder: "添加标题",
    }),
    React.createElement(
      "div",
      { "data-testid": "composer-shell" },
      React.createElement(Editor, {
        editorState: state,
        onChange: (next) => {
          setState(next);
          localStorage.setItem(
            location.pathname,
            JSON.stringify(convertToRaw(next.getCurrentContent())),
          );
        },
        blockRendererFn: (block) =>
          block.getType() === "atomic"
            ? { component: TableBlock, editable: false }
            : null,
        handlePastedFiles: (files) => {
          const img = document.createElement("img");
          img.src = URL.createObjectURL(files[0]);
          document.querySelector("[contenteditable]").append(img);
          return "handled";
        },
      }),
    ),
  );
}
createRoot(document.getElementById("root")).render(
  React.createElement(Fixture),
);
new MutationObserver(() => {
  const editor = document.querySelector("[contenteditable]");
  if (editor) editor.dataset.testid = "composer";
}).observe(document.body, { childList: true, subtree: true });
