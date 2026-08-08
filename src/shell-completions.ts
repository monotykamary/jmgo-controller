import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { programName } from "./spec.js";
import { completionFileFor, isSupportedShell, supportedShells } from "./completion-scripts.js";

// Wiring for `jmgo completions <shell> --install/--uninstall`, adapted from
// localterm: prefer the shell's auto-loaded completion drop-directory (no rc
// edit), fall back to a marker-delimited block in the rc file. Switching
// methods removes the other's artifact, and both directions are idempotent.

const execFileAsync = promisify(execFile);

export const rcBlockBegin = `# >>> ${programName} completions >>>`;
export const rcBlockEnd = `# <<< ${programName} completions <<<`;

export interface WireResult {
  method: "drop-dir" | "rc";
  path: string;
}

export interface UnwireResult {
  rcRemoved: boolean;
  dropRemoved: boolean;
  dropPath?: string;
}

// Test seams: completers probe a fake HOME (and a fake zsh fpath) without
// touching the developer's real shell setup.
export interface ShellEnvironment {
  homeDir: string;
  queryZshFpath: () => Promise<readonly string[]>;
}

const realZshFpath = async (): Promise<readonly string[]> => {
  try {
    const { stdout } = await execFileAsync("zsh", ["-c", "print -l $fpath"], { timeout: 3000 });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const defaultShellEnvironment = (): ShellEnvironment => ({
  homeDir: os.homedir(),
  queryZshFpath: realZshFpath,
});

export const rcRelativePath = (shell: string): string | null => {
  switch (shell) {
    case "bash":
      return ".bashrc";
    case "zsh":
      return ".zshrc";
    case "fish":
      return ".config/fish/config.fish";
    default:
      return null;
  }
};

export const rcPathFor = (shell: string, env: ShellEnvironment): string | null => {
  const relative = rcRelativePath(shell);
  return relative ? path.join(env.homeDir, relative) : null;
};

export const sourceLineFor = (shell: string): string => {
  switch (shell) {
    case "bash":
      // Guarded: a no-op (no startup noise) when jmgo isn't on PATH.
      return `command -v ${programName} >/dev/null 2>&1 && eval "$(${programName} completions bash)"`;
    case "zsh":
      // Lazy + guarded: the real completion script (a node spawn) is deferred
      // to the first <Tab> by a one-shot stub that evals it and forwards the
      // in-flight call.
      return [
        `if command -v ${programName} >/dev/null 2>&1 && command -v compdef >/dev/null 2>&1; then`,
        `  _${programName}_lazy() {`,
        `    unset -f _${programName}_lazy`,
        `    eval "$(${programName} completions zsh)"`,
        `    _${programName} "$@"`,
        "  }",
        `  compdef _${programName}_lazy ${programName}`,
        "fi",
      ].join("\n");
    case "fish":
      return `type -q ${programName}; and ${programName} completions fish | source`;
    default:
      return `eval "$(${programName} completions ${shell})"`;
  }
};

export const buildCompletionBlock = (shell: string): string =>
  [rcBlockBegin, sourceLineFor(shell), rcBlockEnd].join("\n");

export const hasCompletionBlock = (content: string): boolean =>
  content.includes(rcBlockBegin) && content.includes(rcBlockEnd);

export const removeCompletionBlock = (content: string): string => {
  const lines = content.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === rcBlockBegin) {
      skipping = true;
      continue;
    }
    if (line === rcBlockEnd) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
};

// Each shell's conventional completion drop-directory, which it auto-loads
// with no rc edit. fish always has one (we create it on write); bash only when
// bash-completion has already created its user dir; zsh only when a writable
// directory under the user's home is already on fpath — we never put one on
// fpath ourselves, since that would require an rc edit anyway.

const fishCompletionFilePath = (env: ShellEnvironment): string =>
  path.join(env.homeDir, ".config", "fish", "completions", `${programName}.fish`);

const bashCompletionUserDir = (env: ShellEnvironment): string =>
  path.join(env.homeDir, ".local", "share", "bash-completion", "completions");

// Pure-ish: from a zsh fpath listing, pick the first writable directory under
// the user's home and return its `_jmgo` path, or null. System dirs (outside
// home) are skipped — we only write into user-owned dirs.
export const resolveZshDropFile = (
  fpathDirs: readonly string[],
  homeDir: string,
): string | null => {
  for (const dir of fpathDirs) {
    if (dir !== homeDir && !dir.startsWith(`${homeDir}${path.sep}`)) continue;
    try {
      accessSync(dir, constants.W_OK);
      return path.join(dir, `_${programName}`);
    } catch {
      // not writable; keep scanning
    }
  }
  return null;
};

export const completionDropFile = async (
  shell: string,
  env: ShellEnvironment,
): Promise<string | null> => {
  switch (shell) {
    case "fish":
      return fishCompletionFilePath(env);
    case "bash": {
      const dir = bashCompletionUserDir(env);
      return existsSync(dir) ? path.join(dir, programName) : null;
    }
    case "zsh":
      return resolveZshDropFile(await env.queryZshFpath(), env.homeDir);
    default:
      return null;
  }
};

const ensureRcBlock = (shell: string, env: ShellEnvironment): void => {
  const rcPath = rcPathFor(shell, env);
  if (!rcPath) return;
  mkdirSync(path.dirname(rcPath), { recursive: true });
  const existing = existsSync(rcPath) ? readFileSync(rcPath, "utf8") : "";
  if (hasCompletionBlock(existing)) return;
  const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  writeFileSync(rcPath, `${prefix}${buildCompletionBlock(shell)}\n`, "utf8");
};

const removeRcBlock = (shell: string, env: ShellEnvironment): boolean => {
  const rcPath = rcPathFor(shell, env);
  if (!rcPath || !existsSync(rcPath)) return false;
  const content = readFileSync(rcPath, "utf8");
  if (!hasCompletionBlock(content)) return false;
  writeFileSync(rcPath, removeCompletionBlock(content), "utf8");
  return true;
};

export const wireShellCompletions = async (
  shell: string,
  env: ShellEnvironment = defaultShellEnvironment(),
): Promise<WireResult> => {
  if (!isSupportedShell(shell)) {
    throw new Error(`unknown shell '${shell}'. supported: ${supportedShells.join(", ")}`);
  }
  const dropFile = await completionDropFile(shell, env);
  if (dropFile) {
    mkdirSync(path.dirname(dropFile), { recursive: true });
    writeFileSync(dropFile, completionFileFor(shell), "utf8");
    removeRcBlock(shell, env);
    return { method: "drop-dir", path: dropFile };
  }
  const rcPath = rcPathFor(shell, env);
  if (!rcPath) throw new Error(`no rc file for shell '${shell}'`);
  ensureRcBlock(shell, env);
  return { method: "rc", path: rcPath };
};

export const unwireShellCompletions = async (
  shell: string,
  env: ShellEnvironment = defaultShellEnvironment(),
): Promise<UnwireResult> => {
  if (!isSupportedShell(shell)) {
    throw new Error(`unknown shell '${shell}'. supported: ${supportedShells.join(", ")}`);
  }
  const rcRemoved = removeRcBlock(shell, env);
  let dropRemoved = false;
  let dropPath: string | undefined;
  const dropFile = await completionDropFile(shell, env);
  if (dropFile && existsSync(dropFile)) {
    try {
      unlinkSync(dropFile);
      dropRemoved = true;
      dropPath = dropFile;
    } catch {
      // race or permission; leave it
    }
  }
  return { rcRemoved, dropRemoved, ...(dropPath !== undefined ? { dropPath } : {}) };
};

export const detectShell = (): string | null => {
  const name = path.basename(process.env.SHELL ?? "");
  return isSupportedShell(name) ? name : null;
};
