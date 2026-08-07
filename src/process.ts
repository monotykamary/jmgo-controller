import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

export type ProcessResult = {
  stdout: Buffer;
  stderr: Buffer;
  code: number;
};

export async function runProcess(
  command: string,
  args: readonly string[],
  options: { inherit?: boolean; allowFailure?: boolean } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.inherit ? "inherit" : "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        code: code ?? 1,
      };
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(result.stderr.toString().trim() || `${command} exited ${result.code}`));
      } else {
        resolve(result);
      }
    });
  });
}

export async function findExecutable(name: string): Promise<string | undefined> {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return undefined;
}
