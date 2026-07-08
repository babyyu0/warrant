"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { html as diff2html, parse as diff2htmlParse } from "diff2html";
import { ColorSchemeType, LineMatchingType, type DiffFile } from "diff2html/lib/types";
import { getHtmlId } from "diff2html/lib/render-utils";
import styles from "./DiffViewer.module.css";

type DiffViewerProps = {
  diff: string;
};

// diff2html's own README flags line-similarity matching as unreliable and slow on
// big diffs (it can even misorder line numbers) — fall back to strict positional
// pairing past this size instead of the fuzzy "lines" matcher.
const LARGE_DIFF_THRESHOLD = 200_000;

function fileStatus(file: DiffFile): "added" | "deleted" | "renamed" | "modified" {
  if (file.isNew) return "added";
  if (file.isDeleted) return "deleted";
  if (file.isRename) return "renamed";
  return "modified";
}

const STATUS_DOT_CLASS: Record<string, string> = {
  added: styles.statusAdded,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
  modified: styles.statusModified,
};

export default function DiffViewer({ diff }: DiffViewerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const files = useMemo(() => {
    if (!diff.trim()) return [];
    const matching = diff.length > LARGE_DIFF_THRESHOLD ? LineMatchingType.NONE : LineMatchingType.LINES;
    return diff2htmlParse(diff, { matching });
  }, [diff]);

  const diffHtml = useMemo(() => {
    if (files.length === 0) return "";
    return diff2html(files, {
      drawFileList: false,
      outputFormat: "side-by-side",
      colorScheme: ColorSchemeType.AUTO,
    });
  }, [files]);

  // Wrapping long lines (see the CSS) makes each row's height content-dependent,
  // but diff2html renders the old/new panes as two *independent* tables. If a row
  // wraps taller on one side than the other, every row after it drifts out of
  // alignment between the two tables. Force each row pair to the taller side's
  // height so both tables advance in lockstep.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Batched into reset-all / measure-all / write-all passes instead of
    // interleaving reads and writes per row — reading layout (getBoundingClientRect)
    // right after writing it (style.height) forces a synchronous reflow, so doing
    // that row-by-row across a large diff (thousands of rows) was costing over a
    // second of blocked main thread. Batching collapses it to ~2 reflows total.
    function equalizeRowHeights() {
      const rowPairs: [HTMLElement, HTMLElement][] = [];
      container!.querySelectorAll(".d2h-file-wrapper").forEach((wrapper) => {
        const [left, right] = wrapper.querySelectorAll(".d2h-file-side-diff");
        if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) return;

        const leftRows = left.querySelectorAll("tr");
        const rightRows = right.querySelectorAll("tr");
        const count = Math.min(leftRows.length, rightRows.length);
        for (let i = 0; i < count; i++) {
          const leftRow = leftRows[i];
          const rightRow = rightRows[i];
          if (leftRow instanceof HTMLElement && rightRow instanceof HTMLElement) {
            rowPairs.push([leftRow, rightRow]);
          }
        }
      });

      for (const [leftRow, rightRow] of rowPairs) {
        leftRow.style.height = "";
        rightRow.style.height = "";
      }

      const heights = rowPairs.map(([leftRow, rightRow]) =>
        Math.max(leftRow.getBoundingClientRect().height, rightRow.getBoundingClientRect().height),
      );

      rowPairs.forEach(([leftRow, rightRow], i) => {
        const height = `${heights[i]}px`;
        leftRow.style.height = height;
        rightRow.style.height = height;
      });
    }

    equalizeRowHeights();

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(equalizeRowHeights, 100);
    };
    window.addEventListener("resize", onResize);

    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", onResize);
    };
  }, [diffHtml]);

  // diff2html already stamps each `.d2h-file-wrapper` with this same deterministic
  // id, so we can link straight to it instead of patching the DOM after render.
  function goToFile(file: DiffFile) {
    const id = getHtmlId(file);
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }

  if (files.length === 0) {
    return <p className={styles.emptyState}>변경된 내용이 없습니다.</p>;
  }

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Files changed ({files.length})</div>
        <ul className={styles.fileList}>
          {files.map((file, index) => {
            const status = fileStatus(file);
            const displayName = file.isDeleted ? file.oldName : file.newName;
            const id = getHtmlId(file);
            return (
              <li key={`${file.oldName}:${file.newName}:${index}`}>
                <button
                  type="button"
                  onClick={() => goToFile(file)}
                  className={`${styles.fileItem} ${id === activeId ? styles.fileItemActive : ""}`}
                  title={displayName}
                >
                  <span className={styles.fileItemRow}>
                    <span className={`${styles.fileStatusDot} ${STATUS_DOT_CLASS[status]}`} />
                    <span className={styles.fileName}>{displayName}</span>
                    <span className={styles.fileStats}>
                      <span className={styles.statsAdded}>+{file.addedLines}</span>{" "}
                      <span className={styles.statsDeleted}>-{file.deletedLines}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        ref={contentRef}
        className={styles.content}
        // diff2html renders trusted output from our own server-side `git diff` call, not raw user HTML.
        dangerouslySetInnerHTML={{ __html: diffHtml }}
      />
    </div>
  );
}
