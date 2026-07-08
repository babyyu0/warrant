import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

// git hash-object -t tree /dev/null — a fixed hash representing an empty tree in every repo.
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Reject anything that could be parsed as a flag (leading "-") or shell-special char.
const COMMIT_PATTERN = /^[A-Za-z0-9._/~]+$/;

export class GitDiffError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function resolveRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) {
    throw new GitDiffError(`저장소 경로를 찾을 수 없습니다: ${resolved}`, 400);
  }
  return resolved;
}

export async function assertGitRepo(resolvedRepoPath: string): Promise<void> {
  try {
    await execFileAsync("git", [
      "-C",
      resolvedRepoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
  } catch {
    throw new GitDiffError("지정한 경로는 git 저장소가 아닙니다.", 400);
  }
}

export function validateCommit(commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) {
    throw new GitDiffError("commit 값에 허용되지 않는 문자가 포함되어 있습니다.", 400);
  }
}

export type CommitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
};

export async function getRecentCommits(repoPath: string, limit = 30): Promise<{ commits: CommitLogEntry[]; resolvedRepoPath: string }> {
  const resolvedRepoPath = resolveRepoPath(repoPath);
  await assertGitRepo(resolvedRepoPath);

  // Use ASCII unit/record separators instead of a delimiter like "|" so commit
  // messages containing arbitrary characters can't be misparsed as field breaks.
  const format = "%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedRepoPath, "log", "-n", String(limit), "--date=short", `--pretty=format:${format}`],
      { maxBuffer: 1024 * 1024 * 10 },
    );
    const commits = stdout
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, shortHash, author, date, message] = entry.split("\x1f");
        return { hash, shortHash, author, date, message };
      });
    return { commits, resolvedRepoPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitDiffError(`git log 실행 실패: ${message}`, 500);
  }
}

export type DiffResult = {
  diff: string;
  parent: string;
  commit: string;
  resolvedRepoPath: string;
};

export async function getDiff(repoPath: string, commit: string): Promise<DiffResult> {
  validateCommit(commit);
  const resolvedRepoPath = resolveRepoPath(repoPath);
  await assertGitRepo(resolvedRepoPath);

  try {
    await execFileAsync("git", [
      "-C",
      resolvedRepoPath,
      "rev-parse",
      "--verify",
      `${commit}^{commit}`,
    ]);
  } catch {
    throw new GitDiffError(`커밋을 찾을 수 없습니다: ${commit}`, 400);
  }

  // Root commits have no parent — fall back to diffing against the empty tree.
  let parent = `${commit}^`;
  try {
    await execFileAsync("git", [
      "-C",
      resolvedRepoPath,
      "rev-parse",
      "--verify",
      parent,
    ]);
  } catch {
    parent = EMPTY_TREE_HASH;
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedRepoPath, "diff", parent, commit],
      { maxBuffer: 1024 * 1024 * 20 },
    );
    return { diff: stdout, parent, commit, resolvedRepoPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitDiffError(`git diff 실행 실패: ${message}`, 500);
  }
}
