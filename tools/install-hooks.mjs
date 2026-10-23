// Installs the git pre-commit hook that sets the release number (tools/bump-version.mjs) in every
// commit. Run once per clone: node tools/install-hooks.mjs
import { writeFileSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";

const hooks = execSync("git rev-parse --git-path hooks", { encoding: "utf8" }).trim();
const hook = `${hooks}/pre-commit`;
writeFileSync(hook, "#!/bin/sh\nnode tools/bump-version.mjs && git add version.js\n");
try {
  chmodSync(hook, 0o755);
} catch {
  // Windows: git runs it anyway.
}
console.log(`installed ${hook}`);
