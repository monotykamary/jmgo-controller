import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBashCompletionScript,
  buildFishCompletionScript,
  buildZshCompletionFile,
  buildZshCompletionScript,
  completionFileFor,
  completionScriptFor,
  isSupportedShell,
} from "../src/completion-scripts.js";

test("every script defers to jmgo _completion", () => {
  for (const script of [buildBashCompletionScript(), buildZshCompletionScript(), buildZshCompletionFile(), buildFishCompletionScript()]) {
    assert.match(script, /jmgo _completion/u);
  }
});

test("bash registers completion with default fallback for file paths", () => {
  const script = buildBashCompletionScript();
  assert.match(script, /complete -o default -F _jmgo_completion jmgo/u);
  assert.match(script, /compgen -W/u);
});

test("zsh source script guards compdef; drop file is fpath-body form", () => {
  assert.match(buildZshCompletionScript(), /command -v compdef/u);
  const file = buildZshCompletionFile();
  assert.ok(file.startsWith("#compdef jmgo"));
  assert.doesNotMatch(file, /compdef _jmgo jmgo/u);
  assert.match(file, /_files/u);
});

test("fish script falls back to path completion when the CLI has nothing", () => {
  const script = buildFishCompletionScript();
  assert.match(script, /__fish_complete_path/u);
  assert.match(script, /complete -c jmgo -a/u);
});

test("scriptFor/fileFor select per shell and reject unknown shells", () => {
  assert.equal(completionScriptFor("bash"), buildBashCompletionScript());
  assert.equal(completionScriptFor("zsh"), buildZshCompletionScript());
  assert.equal(completionFileFor("zsh"), buildZshCompletionFile());
  assert.equal(completionScriptFor("powershell"), "");
  assert.equal(completionFileFor("powershell"), "");
  assert.equal(isSupportedShell("fish"), true);
  assert.equal(isSupportedShell("tcsh"), false);
});
