"use client";

import { useEffect, useState } from "react";
import styles from "./FolderPicker.module.css";

type Entry = {
  name: string;
  path: string;
};

type BrowseResponse = {
  path: string | null;
  parent: string | null;
  entries: Entry[];
  error?: string;
};

type FolderPickerProps = {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
};

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.entryIcon}
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export default function FolderPicker({ initialPath, onSelect, onClose }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath || null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const params = currentPath ? `?path=${encodeURIComponent(currentPath)}` : "";
    fetch(`/api/browse${params}`)
      .then((res) => res.json())
      .then((data: BrowseResponse) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setCurrentPath(data.path);
        setParent(data.parent);
        setEntries(data.entries);
      })
      .catch(() => {
        if (!cancelled) setError("폴더 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the user navigates to a new directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath === null ? "__drives__" : currentPath]);

  function navigateTo(path: string | null) {
    setLoading(true);
    setError(null);
    setCurrentPath(path);
  }

  return (
    <div role="dialog" aria-modal="true" className={styles.overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.title}>폴더 선택</span>
          <span className={styles.path}>{currentPath ?? "드라이브 선택"}</span>
        </div>

        <div className={styles.toolbar}>
          <button
            type="button"
            onClick={() => navigateTo(parent)}
            disabled={currentPath === null}
            className={styles.upButton}
          >
            ↑ 상위 폴더
          </button>
        </div>

        <div className={styles.list}>
          {loading && <div className={styles.loadingState}>불러오는 중...</div>}
          {error && <div className={styles.errorState}>{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className={styles.emptyState}>하위 폴더가 없습니다.</div>
          )}
          {!loading &&
            !error &&
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => navigateTo(entry.path)}
                className={styles.entry}
              >
                <FolderIcon />
                {entry.name}
              </button>
            ))}
        </div>

        <div className={styles.footer}>
          <button type="button" onClick={onClose} className={styles.cancelButton}>
            취소
          </button>
          <button
            type="button"
            onClick={() => currentPath && onSelect(currentPath)}
            disabled={!currentPath}
            className={styles.selectButton}
          >
            이 폴더 선택
          </button>
        </div>
      </div>
    </div>
  );
}
