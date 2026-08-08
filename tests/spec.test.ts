import assert from "node:assert/strict";
import { test } from "node:test";
import { keyCodes } from "../src/remote.js";
import { commandSpec, findSubcommand, resolveCommandPath, type CommandSpec } from "../src/spec.js";

const allNodes = (node: CommandSpec): CommandSpec[] => [
  node,
  ...node.subcommands.flatMap(allNodes),
];

test("primary commands match the dispatch in cli.ts", () => {
  assert.deepEqual(
    commandSpec.subcommands.map((child) => child.name),
    ["discover", "host", "remote", "adb", "artemis", "play", "doctor", "completions"],
  );
});

test("internal commands stay out of the tree", () => {
  assert.equal(findSubcommand(commandSpec, "_completion"), undefined);
});

test("remote key positional mirrors every entry in keyCodes", () => {
  const remote = findSubcommand(commandSpec, "remote");
  const key = remote && findSubcommand(remote, "key");
  const positional = key?.positionals[0];
  assert.ok(positional, "remote key positional exists");
  assert.deepEqual([...(positional.values ?? [])].sort(), Object.keys(keyCodes).sort());
  const grouped = (positional.groups ?? []).flatMap((group) => group.values);
  assert.deepEqual([...grouped].sort(), Object.keys(keyCodes).sort());
});

test("every node has a summary and well-formed options", () => {
  for (const node of allNodes(commandSpec)) {
    if (node.name !== "") assert.ok(node.summary.length > 0, `${node.name} has a summary`);
    for (const option of node.options) {
      assert.ok(option.long.startsWith("--"), `${node.name} option ${option.long} is long-form`);
      assert.ok(option.description.length > 0, `${node.name} option ${option.long} is described`);
    }
    for (const positional of node.positionals) {
      assert.match(positional.name, /^[A-Z_|]+$/u, `${node.name} positional ${positional.name} is uppercase`);
    }
  }
});

test("resolveCommandPath descends past options with values", () => {
  assert.deepEqual(resolveCommandPath(["remote", "--host", "10.0.0.8", "key"]).path, ["remote", "key"]);
  assert.deepEqual(resolveCommandPath(["remote", "--host=10.0.0.8", "key"]).path, ["remote", "key"]);
});

test("resolveCommandPath stops at the first positional and ignores flags after --", () => {
  assert.deepEqual(resolveCommandPath(["remote", "key", "ok"]).path, ["remote", "key"]);
  assert.deepEqual(resolveCommandPath(["adb", "input", "keyevent", "KEYCODE_DPAD_OK"]).path, ["adb", "input"]);
});

test("resolveCommandPath does not confuse a value-taking option with a subcommand", () => {
  // The token after --host is an IP, not a subcommand name.
  assert.deepEqual(resolveCommandPath(["adb", "--host", "key"]).path, ["adb"]);
});
