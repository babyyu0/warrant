import { NextRequest, NextResponse } from "next/server";
import { GitDiffError, getRecentCommits } from "@/lib/git";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");

  if (!repoPath) {
    return NextResponse.json({ error: "repoPath가 필요합니다." }, { status: 400 });
  }

  try {
    const { commits } = await getRecentCommits(repoPath);
    return NextResponse.json({ commits });
  } catch (error) {
    if (error instanceof GitDiffError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
