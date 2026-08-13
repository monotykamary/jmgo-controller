import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccessibilityCatalog,
  formatSignature,
  normalizeAccessibilityText,
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
  const target = {
    id: "fixture",
    counts: { strings: 2, arrays: 1 },
  };
  assert.doesNotThrow(() => validateCatalog(resources, catalog, target));
  catalog.strings.formatted = "Connected";
  assert.throws(() => validateCatalog(resources, catalog, target), /changed format placeholders/u);
});

test("accessibility catalog normalizes text and retains templates", () => {
  const resources = parseAapt2Resources(DUMP);
  const catalog = {
    accessibility: { "硬编码标签": "Runtime-only label" },
    strings: { formatted: "Connected to %1$s; %2$d devices", multiline: "First line Second line" },
    arrays: { modes: ["English", "Automatic mode", "Quoted mode"] },
  };
  const result = buildAccessibilityCatalog(
    [{ id: "fixture", packageName: "com.example" }],
    { fixture: resources },
    { fixture: catalog },
  );
  assert.equal(result.packages["com.example"].exact["第一行 第二行"], "First line Second line");
  assert.equal(result.packages["com.example"].exact["硬编码标签"], "Runtime-only label");
  assert.equal(result.packages["com.example"].templates.length, 1);
  assert.equal(normalizeAccessibilityText(" one\u00a0 two\nthree "), "one two three");
  assert.deepEqual(formatSignature("100% and %1$s / %02d"), ["%02d", "%1$s"]);
});

test("catalog validation rejects invalid runtime-only translations", () => {
  const resources = parseAapt2Resources(DUMP);
  const catalog = {
    accessibility: { "动态标签": "仍是中文" },
    strings: { formatted: "Connected to %1$s with %2$d devices", multiline: "First line\nSecond line" },
    arrays: { modes: ["English", "Automatic mode", "Quoted mode"] },
  };
  const target = { id: "fixture", counts: { strings: 2, arrays: 1 } };
  assert.throws(() => validateCatalog(resources, catalog, target), /still contains CJK text/u);
});

test("accessibility catalog accepts duplicate sources with identical translations", () => {
  const resources = {
    strings: { first: { "": "按" }, second: { "": "按\u00a0" } },
    arrays: {},
  };
  const catalog = { strings: { first: "Press", second: "Press" }, arrays: {} };
  const result = buildAccessibilityCatalog(
    [{ id: "fixture", packageName: "com.example" }],
    { fixture: resources },
    { fixture: catalog },
  );
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.packages["com.example"].exact["按"], "Press");
});
