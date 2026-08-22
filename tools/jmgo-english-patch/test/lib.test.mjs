import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSignature,
  parseAapt2Resources,
  translatableInventory,
  validateCatalog,
} from "../lib.mjs";

const DUMP = `Binary APK
Package name=com.example id=7f
  type array id=03 entryCount=1
    resource 0x7f030000 array/modes
      () (array) size=3
        ["English", "自动模式", "带"引号"的模式"]
      (en) (array) size=3
        ["English", "Automatic", "Quoted"]
  type string id=11 entryCount=3
    resource 0x7f110000 string/already_english
      () "Settings"
      (zh-rCN) "设置"
    resource 0x7f110001 string/formatted
      () "已连接 %1$s，共 %2$d 个设备"
    resource 0x7f110002 string/multiline
      () "第一行
      第二行"
`;

test("parseAapt2Resources preserves multiline strings, quotes, and arrays", () => {
  const parsed = parseAapt2Resources(DUMP);
  assert.equal(parsed.strings.multiline[""], "第一行\n第二行");
  assert.equal(parsed.strings.formatted[""], "已连接 %1$s，共 %2$d 个设备");
  assert.deepEqual(parsed.arrays.modes[""], ["English", "自动模式", "带\"引号\"的模式"]);
});

test("translatableInventory selects only Chinese defaults", () => {
  const inventory = translatableInventory(parseAapt2Resources(DUMP));
  assert.deepEqual(Object.keys(inventory.strings), ["formatted", "multiline"]);
  assert.deepEqual(Object.keys(inventory.arrays), ["modes"]);
});

test("validateCatalog rejects changed Android placeholders", () => {
  const resources = parseAapt2Resources(DUMP);
  const catalog = {
    strings: { formatted: "Connected to %1$s with %2$d devices", multiline: "First line\nSecond line" },
    arrays: { modes: ["English", "Automatic mode", "Quoted mode"] },
  };
  const target = { id: "fixture", counts: { strings: 2, arrays: 1 } };
  assert.doesNotThrow(() => validateCatalog(resources, catalog, target));
  catalog.strings.formatted = "Connected";
  assert.throws(() => validateCatalog(resources, catalog, target), /changed format placeholders/u);
});

test("catalog validation rejects CJK translations", () => {
  const resources = parseAapt2Resources(DUMP);
  const catalog = {
    strings: { formatted: "仍然包含 %1$s 和 %2$d", multiline: "First line\nSecond line" },
    arrays: { modes: ["English", "Automatic mode", "Quoted mode"] },
  };
  const target = { id: "fixture", counts: { strings: 2, arrays: 1 } };
  assert.throws(() => validateCatalog(resources, catalog, target), /still contains CJK text/u);
});

test("formatSignature preserves indexed and padded Android placeholders", () => {
  assert.deepEqual(formatSignature("100% and %1$s / %02d"), ["%02d", "%1$s"]);
});
