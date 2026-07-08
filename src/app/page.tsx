"use client";

import { useEffect, useState, type FormEvent } from "react";
import DiffViewer, { type ReviewComment } from "@/components/DiffViewer";
import FolderPicker from "@/components/FolderPicker";
import styles from "./page.module.css";

type DiffResponse = {
  diff?: string;
  parent?: string;
  commit?: string;
  error?: string;
};

type ReviewResponse = {
  summary?: string;
  comments?: ReviewComment[];
  error?: string;
};

const STORAGE_KEY = "warrant:lastQuery";

export default function Home() {
  const [repoPath, setRepoPath] = useState("");
  const [commit, setCommit] = useState("");
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [queriedRepoPath, setQueriedRepoPath] = useState("");
  const [queriedCommit, setQueriedCommit] = useState("");
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // One-time sync from localStorage (unavailable during SSR) after mount, so
  // server-rendered and hydrated markup match on the first pass.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed: { repoPath?: string; commit?: string } = JSON.parse(saved);
      /* eslint-disable react-hooks/set-state-in-effect --
         Restoring state from localStorage on mount, not a data fetch. */
      if (parsed.repoPath) setRepoPath(parsed.repoPath);
      if (parsed.commit) setCommit(parsed.commit);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Ignore malformed or inaccessible storage.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ repoPath, commit }));
  }, [repoPath, commit]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDiff(null);
    setReviewSummary(null);
    setReviewComments([]);
    setReviewError(null);

    try {
      const params = new URLSearchParams({ repoPath, commit });
      const res = await fetch(`/api/diff?${params.toString()}`);
      const data: DiffResponse = await res.json();

      if (!res.ok) {
        setError(data.error ?? "diff를 가져오는 중 오류가 발생했습니다.");
        return;
      }

      setDiff(data.diff ?? "");
      setQueriedRepoPath(repoPath);
      setQueriedCommit(commit);
    } catch {
      setError("서버 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview() {
    setReviewLoading(true);
    setReviewError(null);
    setReviewSummary(null);
    setReviewComments([]);

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: queriedRepoPath, commit: queriedCommit }),
      });
      const data: ReviewResponse = await res.json();

      if (!res.ok) {
        setReviewError(data.error ?? "리뷰 생성 중 오류가 발생했습니다.");
        return;
      }

      setReviewSummary(data.summary ?? "");
      setReviewComments(data.comments ?? []);
    } catch {
      setReviewError("서버 요청에 실패했습니다.");
    } finally {
      setReviewLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>Warrant</h1>
          <p className={styles.subtitle}>git diff를 커밋 단위로 비교하고 AI 리뷰 코멘트를 생성합니다.</p>
        </div>

        <div className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.inputGroup}>
              <input
                type="text"
                placeholder="저장소 로컬 경로 (예: C:\source\repos\my-project)"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                required
                className={styles.input}
              />
              <button type="button" onClick={() => setPickerOpen(true)} className={styles.button}>
                찾아보기...
              </button>
            </div>
            <input
              type="text"
              placeholder="커밋 ID (예: a1b2c3d)"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              required
              className={`${styles.input} ${styles.commitInput}`}
            />
            <button type="submit" disabled={loading} className={styles.buttonPrimary}>
              {loading ? "조회 중..." : "비교하기"}
            </button>
          </form>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        {diff !== null && diff.trim() !== "" && (
          <div className={styles.reviewBar}>
            <button
              type="button"
              onClick={handleReview}
              disabled={reviewLoading}
              className={styles.buttonPrimary}
            >
              {reviewLoading ? "리뷰 생성 중..." : "AI 리뷰 받기"}
            </button>
          </div>
        )}

        {reviewError && <div className={styles.errorBanner}>{reviewError}</div>}

        {reviewSummary !== null && (
          <div className={styles.reviewCard}>
            <div className={styles.reviewHeader}>
              AI 리뷰 총평{reviewComments.length > 0 ? ` · 인라인 코멘트 ${reviewComments.length}개` : ""}
            </div>
            <p className={styles.reviewBody}>{reviewSummary || "(총평이 비어 있습니다.)"}</p>
          </div>
        )}

        {diff !== null && (
          <div className={styles.diffCard}>
            <DiffViewer diff={diff} comments={reviewComments} />
          </div>
        )}

        {pickerOpen && (
          <FolderPicker
            initialPath={repoPath || undefined}
            onClose={() => setPickerOpen(false)}
            onSelect={(path) => {
              setRepoPath(path);
              setPickerOpen(false);
            }}
          />
        )}
      </main>
    </div>
  );
}
