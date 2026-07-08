"use client";

import { useEffect, useState, type FormEvent } from "react";
import DiffViewer from "@/components/DiffViewer";
import FolderPicker from "@/components/FolderPicker";
import styles from "./page.module.css";

type DiffResponse = {
  diff?: string;
  parent?: string;
  commit?: string;
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

    try {
      const params = new URLSearchParams({ repoPath, commit });
      const res = await fetch(`/api/diff?${params.toString()}`);
      const data: DiffResponse = await res.json();

      if (!res.ok) {
        setError(data.error ?? "diff를 가져오는 중 오류가 발생했습니다.");
        return;
      }

      setDiff(data.diff ?? "");
    } catch {
      setError("서버 요청에 실패했습니다.");
    } finally {
      setLoading(false);
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

        {diff !== null && (
          <div className={styles.diffCard}>
            <DiffViewer diff={diff} />
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
