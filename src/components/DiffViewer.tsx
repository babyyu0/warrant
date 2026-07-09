"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { html as diff2html, parse as diff2htmlParse } from "diff2html";
import { ColorSchemeType, LineMatchingType, type DiffFile } from "diff2html/lib/types";
import { getHtmlId } from "diff2html/lib/render-utils";
import styles from "./DiffViewer.module.css";

export type ReviewComment = {
  file: string;
  line: number;
  side: "old" | "new";
  comment: string;
};

type DiffViewerProps = {
  diff: string;
  comments?: ReviewComment[];
};

// diff2html's own README flags line-similarity matching as unreliable and slow on
// big diffs (it can even misorder line numbers) — fall back to strict positional
// pairing past this size instead of the fuzzy "lines" matcher.
const LARGE_DIFF_THRESHOLD = 200_000;

// Marks rows we inject (comment boxes + their alignment spacers) so a later
// re-render can strip them back to diff2html's pristine output before
// inserting the next set.
const INJECTED_ROW_CLASS = "warrant-injected-row";

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

export default function DiffViewer({ diff, comments = [] }: DiffViewerProps) {
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

  // Inserts one inline comment box per review comment (GitHub/GitLab MR style),
  // then re-runs the row-height equalizer so the two independent old/new
  // tables stay aligned around the rows we just added.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // diff2html's line template has real newlines/indentation *between* the
    // "+"/"-" prefix span and the code span inside `.d2h-code-side-line`.
    // That element needs `white-space: normal` (see DiffViewer.module.css)
    // so long lines don't force the table wider than the pane — but `normal`
    // also turns that template whitespace into a real break opportunity,
    // so a wrapped line could split right after the prefix instead of
    // within the code. Stripping those whitespace-only text nodes removes
    // the break point at its source instead of fighting it with CSS.
    function stripLineTemplateWhitespace() {
      container!.querySelectorAll(".d2h-code-side-line").forEach((line) => {
        Array.from(line.childNodes).forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && /^\s*$/.test(node.textContent ?? "")) {
            node.remove();
          }
        });
      });
    }

    function insertComments(): void {
      container!.querySelectorAll(`.${INJECTED_ROW_CLASS}`).forEach((el) => el.remove());
      if (comments.length === 0) return;

      const wrappers = Array.from(container!.querySelectorAll(".d2h-file-wrapper"));
      const wrapperByFile = new Map<string, Element>();
      wrappers.forEach((wrapper, index) => {
        const file = files[index];
        if (!file) return;
        wrapperByFile.set(file.newName, wrapper);
        wrapperByFile.set(file.oldName, wrapper);
      });

      for (const comment of comments) {
        const wrapper = wrapperByFile.get(comment.file);
        if (!wrapper) {
          console.warn(
            `[DiffViewer] no file match for comment.file=${JSON.stringify(comment.file)}. Known files:`,
            Array.from(wrapperByFile.keys()),
          );
          continue;
        }

        const panes = wrapper.querySelectorAll(".d2h-file-side-diff");
        const [left, right] = panes;
        if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) continue;
        const [targetPane, otherPane] = comment.side === "old" ? [left, right] : [right, left];

        const targetRows = Array.from(targetPane.querySelectorAll("tr"));
        const rowIndex = targetRows.findIndex((row) => {
          const lineText = row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim();
          return lineText === String(comment.line);
        });
        if (rowIndex === -1) {
          console.warn(
            `[DiffViewer] no row match for comment.file=${comment.file} side=${comment.side} line=${comment.line} (searched ${targetRows.length} rows)`,
          );
          continue;
        }

        const commentRow = document.createElement("tr");
        commentRow.className = INJECTED_ROW_CLASS;
        const commentCell = document.createElement("td");
        commentCell.colSpan = 2;
        commentCell.className = styles.commentCell;
        const commentBox = document.createElement("div");
        commentBox.className = styles.commentBox;
        commentBox.innerHTML = `<span class="${styles.commentBadge}">AI</span><span class="${styles.commentText}"></span>`;
        commentBox.querySelector(`.${styles.commentText}`)!.textContent = comment.comment;
        commentCell.appendChild(commentBox);
        commentRow.appendChild(commentCell);
        targetRows[rowIndex].after(commentRow);

        const otherRows = Array.from(otherPane.querySelectorAll("tr"));
        const spacerRow = document.createElement("tr");
        spacerRow.className = INJECTED_ROW_CLASS;
        const spacerCell = document.createElement("td");
        spacerCell.colSpan = 2;
        spacerRow.appendChild(spacerCell);
        (otherRows[rowIndex] ?? otherRows[otherRows.length - 1])?.after(spacerRow);
      }
    }

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

    // Some re-renders reset this container's `dangerouslySetInnerHTML` back to
    // diff2html's pristine output — wiping whatever we've injected/stripped
    // above — for reasons that don't line up with any prop/state change we can
    // put in this effect's dependency array (observed even right after initial
    // mount, with no click or comment update involved). Rather than chase every
    // possible trigger, process once up front, then let a MutationObserver
    // watch this container's own childList (the pristine root swap shows up
    // there) and reprocess whenever that happens. Our own writes above only
    // touch descendants of that root (rows inside its tables), never the
    // container's direct children, so this can't loop back on itself.
    function process(scroll: boolean) {
      stripLineTemplateWhitespace();
      insertComments();
      equalizeRowHeights();
      if (!scroll) return;

      // If a file is active (the user just clicked it), jump to that file's
      // first comment, or its top if it has none. Otherwise (initial load of
      // a fresh review) jump to the first comment anywhere so it isn't
      // silently off-screen.
      let scrollTarget: Element | null = null;
      let scrollBlock: ScrollLogicalPosition = "start";
      if (activeId) {
        const activeWrapper = document.getElementById(activeId);
        const firstCommentBox = activeWrapper?.querySelector(`.${styles.commentBox}`) ?? null;
        if (firstCommentBox) {
          scrollTarget = firstCommentBox.closest("tr");
          scrollBlock = "center";
        } else {
          scrollTarget = activeWrapper;
        }
      } else {
        scrollTarget = container!.querySelector(`.${styles.commentBox}`)?.closest("tr") ?? null;
        scrollBlock = "center";
      }
      scrollTarget?.scrollIntoView({ block: scrollBlock });
    }

    process(true);

    const resetObserver = new MutationObserver(() => process(false));
    resetObserver.observe(container, { childList: true });

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(equalizeRowHeights, 100);
    };
    window.addEventListener("resize", onResize);

    return () => {
      resetObserver.disconnect();
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", onResize);
    };
  }, [diffHtml, comments, files, activeId]);

  // diff2html already stamps each `.d2h-file-wrapper` with this same deterministic
  // id, so setting it as the active file is enough — the effect above re-runs
  // on activeId changes and handles scrolling to it (and to its first comment,
  // if any).
  function goToFile(file: DiffFile) {
    setActiveId(getHtmlId(file));
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
            const commentCount = comments.filter(
              (c) => c.file === file.newName || c.file === file.oldName,
            ).length;
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
                    {commentCount > 0 && <span className={styles.commentCountBadge}>{commentCount}</span>}
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
