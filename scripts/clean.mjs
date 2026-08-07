import { rm } from "node:fs/promises";

for (const target of process.argv.slice(2)) {
  await rm(target, { recursive: true, force: true });
}
