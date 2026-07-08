import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

// git hash-object -t tree /dev/null — a fixed hash representing an empty tree in every repo.
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Reject anything that could be parsed as a flag (leading "-") or shell-special char.
const COMMIT_PATTERN = /^[A-Za-z0-9._/~]+$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoPath = searchParams.get("repoPath");
  const commit = searchParams.get("commit");

  if (!repoPath || !commit) {
    return NextResponse.json(
      { error: "repoPath와 commit 쿼리 파라미터가 필요합니다." },
      { status: 400 },
    );
  }

  if (!COMMIT_PATTERN.test(commit)) {
    return NextResponse.json(
      { error: "commit 값에 허용되지 않는 문자가 포함되어 있습니다." },
      { status: 400 },
    );
  }

  const resolvedRepoPath = path.resolve(repoPath);

  if (!fs.existsSync(resolvedRepoPath)) {
    return NextResponse.json(
      { error: `저장소 경로를 찾을 수 없습니다: ${resolvedRepoPath}` },
      { status: 400 },
    );
  }

  try {
    await execFileAsync("git", [
      "-C",
      resolvedRepoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
  } catch {
    return NextResponse.json(
      { error: "지정한 경로는 git 저장소가 아닙니다." },
      { status: 400 },
    );
  }

  try {
    await execFileAsync("git", [
      "-C",
      resolvedRepoPath,
      "rev-parse",
      "--verify",
      `${commit}^{commit}`,
    ]);
  } catch {
    return NextResponse.json(
      { error: `커밋을 찾을 수 없습니다: ${commit}` },
      { status: 400 },
    );
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
    return NextResponse.json({ diff: stdout, parent, commit });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `git diff 실행 실패: ${message}` },
      { status: 500 },
    );
  }
}
