import { NextRequest, NextResponse } from "next/server";
import { GitDiffError, getDiff } from "@/lib/git";

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

  try {
    const { diff, parent, commit: resolvedCommit } = await getDiff(repoPath, commit);
    return NextResponse.json({ diff, parent, commit: resolvedCommit });
  } catch (error) {
    if (error instanceof GitDiffError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
