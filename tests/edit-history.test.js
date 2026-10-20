import test from "node:test";
import assert from "node:assert/strict";
import { EditHistory } from "../src/edit-history.js";
const value = (source) => ({
  source,
  title: "标题",
  start: source.length,
  end: source.length,
});
test("撤销、重做与重新打开后保留历史位置", () => {
  const history = new EditHistory(value(""));
  history.record(value("第一版"));
  history.record(value("第二版"));
  assert.equal(history.move(-1).source, "第一版");
  const restored = new EditHistory(
    value("第一版"),
    JSON.parse(JSON.stringify(history.serialize())),
  );
  assert.equal(restored.move(1).source, "第二版");
  assert.equal(restored.move(-1).source, "第一版");
  restored.record(value("新分支"));
  assert.equal(restored.move(1), null);
  assert.equal(restored.move(-1).source, "第一版");
});
test("重复内容不新增历史，历史数量有上限", () => {
  const history = new EditHistory(value(""));
  history.record(value(""));
  assert.equal(history.entries.length, 1);
  for (let i = 0; i < 120; i++) history.record(value(String(i)));
  assert.equal(history.entries.length, 100);
  assert.equal(history.move(-1).source, "118");
});
