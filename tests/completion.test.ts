import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCandidates, resolveCandidates, resolveCompletionContext, runCompletion } from "../src/completion.js";
import { keyCodes } from "../src/remote.js";

test("completes root commands", () => {
  const context = resolveCompletionContext(["jmgo", ""]);
  assert.equal(context.command.name, "");
  assert.deepEqual(resolveCandidates(context), ["discover", "host", "remote", "adb", "scrcpy", "artemis", "play", "doctor", "completions"]);
});

test("descends into subcommands and resets positionals", () => {
  const context = resolveCompletionContext(["jmgo", "remote", ""]);
  assert.equal(context.command.name, "remote");
  assert.deepEqual(resolveCandidates(context), ["status", "key", "volume", "watch"]);
});

test("descends through nested subcommands", () => {
  const context = resolveCompletionContext(["jmgo", "artemis", ""]);
  assert.deepEqual(resolveCandidates(context), ["open", "apps", "monitors"]);
});

test("completes every remote key, filtered by prefix", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "key", ""]);
  assert.equal(context.command.name, "key");
  assert.deepEqual(
    [...resolveCandidates(context)].sort(),
    Object.keys(keyCodes).sort(),
  );
  assert.deepEqual(formatCandidates(resolveCandidates(context), "v"), "volume-down\nvolume-up\n");
});

test("completes volume actions then falls quiet on LEVEL", () => {
  const action = resolveCompletionContext(["jmgo", "remote", "volume", ""]);
  assert.deepEqual(resolveCandidates(action), ["up", "down", "set"]);
  const level = resolveCompletionContext(["jmgo", "remote", "volume", "set", ""]);
  assert.equal(level.positionalIndex, 1);
  assert.deepEqual(resolveCandidates(level), []);
});

test("completes option flags when the current word starts with -", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "status", "--"]);
  assert.deepEqual(resolveCandidates(context), ["--host", "--include-identifiers"]);
  assert.equal(formatCandidates(resolveCandidates(context), "--inc"), "--include-identifiers\n");
});

test("skips an option's value while walking", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "--host", "10.0.0.8", ""]);
  assert.equal(context.command.name, "remote");
  assert.equal(context.positionalIndex, 0);
  assert.deepEqual(resolveCandidates(context), ["status", "key", "volume", "watch"]);
});

test("marks the current word as an option value", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "key", "--host", ""]);
  assert.equal(context.completingOptionValue?.long, "--host");
  assert.deepEqual(resolveCandidates(context), []);
});

test("consumes inline option values and resumes positionals", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "--host=10.0.0.8", "key", ""]);
  assert.equal(context.command.name, "key");
  assert.equal(context.completingOptionValue, null);
});

test("completes shell names for completions <SHELL>", () => {
  const context = resolveCompletionContext(["jmgo", "completions", ""]);
  assert.deepEqual(resolveCandidates(context), ["bash", "zsh", "fish"]);
  assert.equal(formatCandidates(resolveCandidates(context), "z"), "zsh\n");
});

test("passthrough commands complete nothing", () => {
  const context = resolveCompletionContext(["jmgo", "scrcpy", "--", "--tcpip=9006", ""]);
  assert.equal(context.command.name, "scrcpy");
  assert.deepEqual(resolveCandidates(context), []);
});

test("path-like positionals defer to the shell's filename completion", () => {
  const context = resolveCompletionContext(["jmgo", "adb", "install", ""]);
  assert.deepEqual(resolveCandidates(context), []);
});

test("variadic positionals keep serving their values", () => {
  const context = resolveCompletionContext(["jmgo", "remote", "key", "ok", ""]);
  // KEY is not variadic, so a second positional has no candidates.
  assert.deepEqual(resolveCandidates(context), []);
});

test("runCompletion prints sorted candidates and never throws", () => {
  assert.equal(runCompletion(["jmgo", "completions", ""]), "bash\nfish\nzsh\n");
  assert.equal(runCompletion([]), "adb\nartemis\ncompletions\ndiscover\ndoctor\nhost\nplay\nremote\nscrcpy\n");
  assert.equal(runCompletion(["jmgo", "remote", "key", "po"]), "power\npower-menu\n");
});
