import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Runs git with a short time limit. Returns null on any failure, so hooks never stall. */
function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export function projectRoot(dir: string): string | null {
  return git(dir, ["rev-parse", "--show-toplevel"])?.trim() || null;
}

export function currentBranch(root: string): string | null {
  return git(root, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() || null;
}

export function headCommit(root: string): string | null {
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() || null;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  paths: string[];
}

/**
 * The commit's subject and changed paths, or null if someone else authored it
 * (for example a teammate's commit that arrived with a pull).
 */
export function ownCommit(root: string, hash: string): CommitInfo | null {
  const out = git(root, ["log", "-1", "--format=%H%x00%s%x00%ae", hash]);
  if (!out) return null;
  const [full, subject, author] = out.trim().split("\0");
  if (!full) return null;
  const me = git(root, ["config", "user.email"])?.trim();
  if (me && author && me.toLowerCase() !== author.toLowerCase()) return null;
  const paths = (git(root, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash]) ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, 500);
  return { hash: full, subject: subject ?? "", paths };
}

/**
 * Signature (size and modification time) of every file git reports as changed or
 * untracked. Comparing two of these shows which files a turn touched.
 */
export function dirtySignatures(root: string): Record<string, string> {
  const out = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const sigs: Record<string, string> = {};
  if (!out) return sigs;
  const parts = out.split("\0");
  for (let i = 0; i < parts.length && Object.keys(sigs).length < 2000; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status.includes("R") || status.includes("C")) i++; // the next part is the old name
    try {
      const st = fs.statSync(path.join(root, file));
      sigs[file] = `${st.size}:${Math.trunc(st.mtimeMs)}`;
    } catch {
      sigs[file] = "deleted";
    }
  }
  return sigs;
}

/** Files whose signature differs between two scans, including ones that became clean (committed or reverted). */
export function changedSince(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]).sort();
}
