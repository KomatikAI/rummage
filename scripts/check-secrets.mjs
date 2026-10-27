#!/usr/bin/env node
// Pre-commit secret check. Scans the staged version of every added, copied or
// modified file and exits 1 listing file:line for anything that looks like a
// secret. Wired through simple-git-hooks (see package.json).

import { execFileSync } from "node:child_process";
import path from "node:path";
import { findSecrets, isBinary, SKIPPED_FILES } from "./secret-patterns.mjs";

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { encoding, maxBuffer: 64 * 1024 * 1024 });
}

const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"])
  .split("\0")
  .filter(Boolean);

const problems = [];

for (const file of staged) {
  if (SKIPPED_FILES.has(path.posix.basename(file))) continue;
  const buffer = git(["show", `:${file}`], "buffer");
  if (isBinary(buffer)) continue;
  for (const finding of findSecrets(buffer.toString("utf8"))) {
    problems.push(`${file}:${finding.line}  ${finding.pattern}`);
  }
}

if (problems.length > 0) {
  console.error("check-secrets: possible secrets in staged files:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("Remove them (keep real values in .env.local, which is gitignored) and try again.");
  process.exit(1);
}

console.log(`check-secrets: ${staged.length} staged file(s) clean.`);
