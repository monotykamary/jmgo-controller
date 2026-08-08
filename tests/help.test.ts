import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHelp, suggest } from "../src/help.js";
import { keyCodes } from "../src/remote.js";

test("root help lists every command with usage", () => {
  const text = renderHelp();
  assert.match(text, /^jmgo — /u);
  assert.match(text, /Usage:\n {2}jmgo <command>/u);
  for (const command of ["discover", "host", "remote", "adb", "artemis", "play", "doctor", "completions"]) {
    assert.match(text, new RegExp(`^ {2}${command} `, "mu"), `root help mentions ${command}`);
  }
  assert.match(text, /--help/u);
  assert.match(text, /JMGO_HOST/u);
});

test("remote help shows its commands and inherited options", () => {
  const text = renderHelp(["remote"]);
  assert.match(text, /^jmgo remote — /u);
  assert.match(text, /Usage:\n {2}jmgo remote <command>/u);
  for (const command of ["status", "key", "volume", "watch"]) {
    assert.match(text, new RegExp(`^ {2}${command} `, "mu"), `remote help mentions ${command}`);
  }
  assert.match(text, /--host/u);
});

test("remote key help lists every key, grouped, with Android key codes", () => {
  const text = renderHelp(["remote", "key"]);
  assert.match(text, /^jmgo remote key — /u);
  assert.match(text, /<KEY> — one of:/u);
  assert.match(text, /navigation/u);
  assert.match(text, /power/u);
  for (const [name, code] of Object.entries(keyCodes)) {
    assert.ok(text.includes(`${name} (${code})`), `key help shows ${name} (${code})`);
  }
});

test("leaf renders positional usage and choices", () => {
  const text = renderHelp(["completions"]);
  assert.match(text, /Usage:\n {2}jmgo completions \[options\] <SHELL>/u);
  assert.match(text, /bash, zsh, fish/u);
  assert.match(text, /--install/u);
});

test("usage marks optional and variadic positionals", () => {
  assert.match(renderHelp(["remote", "volume"]), /\[ACTION\] \[LEVEL\]/u);
  assert.match(renderHelp(["adb", "install"]), /<APK\.\.\.>/u);
  assert.match(renderHelp(["host", "set"]), /<HOST>/u);
});

test("suggest finds near misses and stays quiet on junk", () => {
  assert.equal(suggest("remto", ["remote", "doctor"]), "remote");
  assert.equal(suggest("stat", ["status", "set"]), "status");
  assert.equal(suggest("zzzzzzzz", ["remote", "doctor"]), undefined);
});

test("unknown help path throws", () => {
  assert.throws(() => renderHelp(["nope"]), /unknown help path/u);
});
