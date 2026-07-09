import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Windows installers commonly add the CLI's directory to the *Machine* PATH,
// which already-running processes (notably explorer.exe) don't pick up until
// logoff/reboot. A batch file double-clicked from Explorer then inherits a
// stale PATH and gets ENOENT even though the binary is installed and a fresh
// terminal can find it fine. Checking well-known install locations directly
// sidesteps that instead of depending on PATH alone.
function resolveClaudeCommand(): string {
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, ".local", "bin", "claude.exe"),
          path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", "claude.cmd"),
        ]
      : [path.join(home, ".local", "bin", "claude"), "/usr/local/bin/claude"];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // None of the known locations matched — fall back to PATH resolution,
  // which still works whenever the environment happens to be fresh.
  return "claude";
}

export class ClaudeCliError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export type ClaudeCliResult<T = unknown> = {
  text: string;
  structuredOutput?: T;
  costUsd?: number;
};

type ClaudeCliOptions = {
  cwd: string;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxBudgetUsd?: number;
  timeoutMs?: number;
  jsonSchema?: object;
};

type ClaudeCliJsonOutput = {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  structured_output?: unknown;
};

/**
 * Runs the `claude` CLI in headless print mode (`-p --output-format json`) and
 * returns its final text result. This reuses whatever session the CLI is
 * already logged into (subscription or API key) — the request genuinely
 * originates from the official client, so it isn't subject to the same
 * rejection a borrowed OAuth token hits when reused through a different HTTP
 * client (see project notes).
 */
export function runClaudeCli<T = unknown>(options: ClaudeCliOptions): Promise<ClaudeCliResult<T>> {
  const {
    cwd,
    systemPrompt,
    userPrompt,
    model = "opus",
    allowedTools = [],
    disallowedTools = [],
    maxBudgetUsd,
    timeoutMs = 5 * 60 * 1000,
    jsonSchema,
  } = options;

  const args = ["-p", "--output-format", "json", "--model", model, "--system-prompt", systemPrompt];
  if (allowedTools.length > 0) args.push("--allowedTools", ...allowedTools);
  if (disallowedTools.length > 0) args.push("--disallowedTools", ...disallowedTools);
  if (maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (jsonSchema !== undefined) args.push("--json-schema", JSON.stringify(jsonSchema));

  return new Promise((resolve, reject) => {
    const child = spawn(resolveClaudeCommand(), args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      settle(() => reject(new ClaudeCliError("claude CLI 실행이 시간 초과되었습니다.", 504)));
    }, timeoutMs);

    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === "ENOENT") {
          reject(
            new ClaudeCliError(
              "claude CLI를 찾을 수 없습니다. `npm install -g @anthropic-ai/claude-code`로 설치한 뒤 로그인해 주세요. " +
                "설치되어 있는데도 이 오류가 발생한다면, 설치 후 PATH가 갱신되지 않은 것일 수 있습니다 — 로그아웃 후 다시 로그인하거나 PC를 재시작한 뒤 다시 시도해 주세요.",
              500,
            ),
          );
        } else {
          reject(new ClaudeCliError(`claude CLI 실행 실패: ${err.message}`, 500));
        }
      });
    });

    child.on("close", (code) => {
      settle(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(
            new ClaudeCliError(
              `claude CLI가 오류로 종료되었습니다 (code ${code}): ${stderr.trim() || "알 수 없는 오류"}`,
              500,
            ),
          );
          return;
        }
        let parsed: ClaudeCliJsonOutput;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          reject(new ClaudeCliError(`claude CLI 출력 파싱 실패: ${stdout.slice(0, 500)}`, 500));
          return;
        }
        if (parsed.is_error) {
          reject(new ClaudeCliError(`claude CLI 오류: ${parsed.result ?? "알 수 없는 오류"}`, 500));
          return;
        }
        resolve({
          text: parsed.result ?? "",
          structuredOutput: parsed.structured_output as T | undefined,
          costUsd: parsed.total_cost_usd,
        });
      });
    });

    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}
