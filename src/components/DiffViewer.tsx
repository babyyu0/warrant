"use client";

import { useMemo } from "react";
import { html as diff2html } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";

type DiffViewerProps = {
  diff: string;
};

export default function DiffViewer({ diff }: DiffViewerProps) {
  const renderedHtml = useMemo(() => {
    if (!diff.trim()) return "";
    return diff2html(diff, {
      drawFileList: true,
      matching: "lines",
      outputFormat: "side-by-side",
      colorScheme: ColorSchemeType.AUTO,
    });
  }, [diff]);

  if (!diff.trim()) {
    return <p>변경된 내용이 없습니다.</p>;
  }

  return (
    <div
      className="diff-viewer"
      // diff2html renders trusted output from our own server-side `git diff` call, not raw user HTML.
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
