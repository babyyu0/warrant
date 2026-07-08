import { NextRequest, NextResponse } from "next/server";
import { GitDiffError, getDiff } from "@/lib/git";
import { ClaudeCliError, runClaudeCli } from "@/lib/claudeCli";

const SYSTEM_PROMPT = `당신은 신중한 시니어 코드 리뷰어입니다. 주어진 git diff를 GitHub/GitLab MR 리뷰처럼, 문제가 있는 각 줄에 인라인 코멘트를 다는 방식으로 검토하세요.

diff만으로 판단하기 어려운 부분은 Read, Grep, Glob 도구를 사용해 저장소의 다른 코드를 직접 참고한 뒤 리뷰하세요. 예를 들어 변경된 함수를 호출하는 다른 곳이 있는지, 비슷한 패턴이 기존 코드에 이미 있는지, 변경으로 인해 깨질 수 있는 다른 코드가 있는지 확인하세요.

코멘트를 달 때 지켜야 할 규칙:
- 버그, 로직 오류, 보안 취약점, 기존 코드와의 일관성 문제 등 실질적인 문제가 있는 줄에만 코멘트를 다세요. 사소한 스타일 지적은 지양하고, 문제 없는 줄에는 코멘트를 달지 마세요.
- file은 diff에 나온 경로(예: src/app/page.tsx)를 그대로 쓰세요.
- line은 diff 왼쪽(old)/오른쪽(new) 줄 번호 컬럼에 실제로 표시된 숫자를 그대로 쓰세요. 추가되거나 그대로인 줄은 side="new"와 새 파일의 줄 번호를, 삭제된 줄은 side="old"와 old 파일의 줄 번호를 쓰세요.
- comment는 왜 문제인지와 어떻게 고치면 좋을지 2~4문장으로 간결하게. 한국어로 작성하세요.
- summary에는 전체적인 총평을 1~3문장으로 작성하세요 (지적 사항이 없어도 총평은 작성).
- 파일을 수정하지 마세요 — 읽기 전용 리뷰입니다.`;

const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "전체 리뷰 총평 (1~3문장)",
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "diff에 표시된 파일 경로" },
          line: { type: "integer", description: "diff에 표시된 줄 번호" },
          side: {
            type: "string",
            enum: ["old", "new"],
            description: "old=삭제된/이전 줄, new=추가되었거나 그대로인 줄",
          },
          comment: { type: "string", description: "코멘트 내용" },
        },
        required: ["file", "line", "side", "comment"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "comments"],
  additionalProperties: false,
} as const;

type ReviewComment = {
  file: string;
  line: number;
  side: "old" | "new";
  comment: string;
};

type ReviewStructuredOutput = {
  summary: string;
  comments: ReviewComment[];
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const repoPath = body?.repoPath;
  const commit = body?.commit;

  if (typeof repoPath !== "string" || typeof commit !== "string" || !repoPath || !commit) {
    return NextResponse.json({ error: "repoPath와 commit이 필요합니다." }, { status: 400 });
  }

  let diff: string;
  let resolvedRepoPath: string;
  let resolvedCommit: string;
  try {
    const result = await getDiff(repoPath, commit);
    diff = result.diff;
    resolvedRepoPath = result.resolvedRepoPath;
    resolvedCommit = result.commit;
  } catch (error) {
    if (error instanceof GitDiffError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  if (!diff.trim()) {
    return NextResponse.json({ summary: "변경된 내용이 없어 리뷰할 내용이 없습니다.", comments: [] });
  }

  try {
    // Runs the `claude` CLI itself (not the Anthropic SDK) so it authenticates
    // as the genuine Claude Code client the user is already logged into —
    // see src/lib/claudeCli.ts for why that matters. cwd = the repo, so its
    // built-in Read/Grep/Glob tools can look at other files for context.
    const { structuredOutput } = await runClaudeCli<ReviewStructuredOutput>({
      cwd: resolvedRepoPath,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `다음은 커밋 ${resolvedCommit}의 git diff입니다. 각 줄 번호는 diff에 표시된 그대로입니다. 리뷰해 주세요.\n\n\`\`\`diff\n${diff}\n\`\`\``,
      model: "opus",
      allowedTools: ["Read", "Grep", "Glob"],
      disallowedTools: ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"],
      maxBudgetUsd: 1,
      jsonSchema: REVIEW_JSON_SCHEMA,
    });

    if (!structuredOutput) {
      return NextResponse.json({ error: "claude CLI가 구조화된 리뷰 결과를 반환하지 않았습니다." }, { status: 500 });
    }

    return NextResponse.json({
      summary: structuredOutput.summary ?? "",
      comments: Array.isArray(structuredOutput.comments) ? structuredOutput.comments : [],
    });
  } catch (error) {
    if (error instanceof ClaudeCliError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `리뷰 생성 실패: ${message}` }, { status: 500 });
  }
}
