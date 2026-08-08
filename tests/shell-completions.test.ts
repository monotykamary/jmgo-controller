import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildCompletionBlock,
  hasCompletionBlock,
  removeCompletionBlock,
  resolveZshDropFile,
  rcPathFor,
  sourceLineFor,
  unwireShellCompletions,
  wireShellCompletions,
  type ShellEnvironment,
} from "../src/shell-completions.js";

const fakeEnvironment = (overrides: Partial<ShellEnvironment> = {}): ShellEnvironment & { cleanup: () => void } => {
  const homeDir = mkdtempSync(join(tmpdir(), "jmgo-completions-test-"));
  return {
    homeDir,
    queryZshFpath: async () => [],
    ...overrides,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true }),
  };
};

test("fish wires a drop-file and unwires it", async () => {
  const env = fakeEnvironment();
  try {
    const wired = await wireShellCompletions("fish", env);
    assert.equal(wired.method, "drop-dir");
    assert.equal(wired.path, join(env.homeDir, ".config", "fish", "completions", "jmgo.fish"));
    assert.match(readFileSync(wired.path, "utf8"), /jmgo _completion/u);

    const unwired = await unwireShellCompletions("fish", env);
    assert.deepEqual(unwired, { rcRemoved: false, dropRemoved: true, dropPath: wired.path });
    assert.equal(existsSync(wired.path), false);
  } finally {
    env.cleanup();
  }
});

test("bash without bash-completion's user dir falls back to an rc block", async () => {
  const env = fakeEnvironment();
  try {
    const wired = await wireShellCompletions("bash", env);
    assert.equal(wired.method, "rc");
    const rc = readFileSync(join(env.homeDir, ".bashrc"), "utf8");
    assert.ok(hasCompletionBlock(rc));
    assert.match(rc, /eval "\$\(jmgo completions bash\)"/u);

    // Re-wiring is a no-op, and unwiring restores an empty rc file.
    await wireShellCompletions("bash", env);
    const unwired = await unwireShellCompletions("bash", env);
    assert.deepEqual(unwired.rcRemoved, true);
    assert.equal(readFileSync(join(env.homeDir, ".bashrc"), "utf8"), "");
  } finally {
    env.cleanup();
  }
});

test("bash drop-dir wins over the rc block when bash-completion exists", async () => {
  const env = fakeEnvironment();
  try {
    const dropDir = join(env.homeDir, ".local", "share", "bash-completion", "completions");
    mkdirSync(dropDir, { recursive: true });
    // A pre-existing rc block is removed when the drop-file takes over.
    mkdirSync(env.homeDir, { recursive: true });
    await wireShellCompletions("bash", { ...env, queryZshFpath: env.queryZshFpath });
    const wired = await wireShellCompletions("bash", env);
    assert.equal(wired.method, "drop-dir");
    assert.match(readFileSync(wired.path, "utf8"), /complete -o default/u);
  } finally {
    env.cleanup();
  }
});

test("zsh wires into a writable fpath directory as _jmgo", async () => {
  const fpathDir = mkdtempSync(join(tmpdir(), "jmgo-zsh-fpath-"));
  const env = fakeEnvironment({ queryZshFpath: async () => ["/usr/share/zsh/site-functions", fpathDir] });
  try {
    // Only directories under home count; make the fpath dir look like one.
    rmSync(env.homeDir, { recursive: true, force: true });
    mkdirSync(join(env.homeDir), { recursive: true });
    const localFpath = join(env.homeDir, "site-functions");
    mkdirSync(localFpath, { recursive: true });
    env.queryZshFpath = async () => ["/usr/share/zsh/site-functions", localFpath];

    const wired = await wireShellCompletions("zsh", env);
    assert.equal(wired.method, "drop-dir");
    assert.equal(wired.path, join(localFpath, "_jmgo"));
    assert.match(readFileSync(wired.path, "utf8"), /#compdef jmgo/u);
  } finally {
    env.cleanup();
    rmSync(fpathDir, { recursive: true, force: true });
  }
});

test("zsh without a user fpath dir wires the lazy rc block", async () => {
  const env = fakeEnvironment();
  try {
    const wired = await wireShellCompletions("zsh", env);
    assert.equal(wired.method, "rc");
    const rc = readFileSync(join(env.homeDir, ".zshrc"), "utf8");
    assert.match(rc, /_jmgo_lazy/u);
    assert.match(rc, /compdef _jmgo_lazy jmgo/u);
  } finally {
    env.cleanup();
  }
});

test("resolveZshDropFile skips directories outside home and non-writable ones", () => {
  const env = fakeEnvironment();
  try {
    const inside = join(env.homeDir, "functions");
    mkdirSync(inside, { recursive: true });
    assert.equal(resolveZshDropFile(["/usr/share/zsh/site-functions", inside], env.homeDir), join(inside, "_jmgo"));
    assert.equal(resolveZshDropFile(["/etc/zsh"], env.homeDir), null);
  } finally {
    env.cleanup();
  }
});

test("completion blocks round-trip through rc content", () => {
  const block = buildCompletionBlock("fish");
  const withBlock = `# user config\n${block}\n# more config\n`;
  assert.ok(hasCompletionBlock(withBlock));
  const removed = removeCompletionBlock(withBlock);
  assert.equal(removed, "# user config\n# more config\n");
  assert.equal(hasCompletionBlock(removed), false);
});

test("source lines are guarded and shell-appropriate", () => {
  assert.match(sourceLineFor("bash"), /command -v jmgo/u);
  assert.match(sourceLineFor("zsh"), /compdef/u);
  assert.match(sourceLineFor("fish"), /type -q jmgo/u);
});

test("rc paths resolve under the given home", () => {
  const env = fakeEnvironment();
  try {
    assert.equal(rcPathFor("bash", env), join(env.homeDir, ".bashrc"));
    assert.equal(rcPathFor("fish", env), join(env.homeDir, ".config", "fish", "config.fish"));
    assert.equal(rcPathFor("nushell", env), null);
  } finally {
    env.cleanup();
  }
});

test("unknown shells are rejected", async () => {
  const env = fakeEnvironment();
  try {
    await assert.rejects(wireShellCompletions("tcsh", env), /unknown shell/u);
    await assert.rejects(unwireShellCompletions("tcsh", env), /unknown shell/u);
  } finally {
    env.cleanup();
  }
});
