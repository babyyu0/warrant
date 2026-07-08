import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type Entry = {
  name: string;
  path: string;
};

function listWindowsDrives(): Entry[] {
  const drives: Entry[] = [];
  for (const code of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const drivePath = `${code}:\\`;
    if (fs.existsSync(drivePath)) {
      drives.push({ name: drivePath, path: drivePath });
    }
  }
  return drives;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path");

  // No path yet: show drive list on Windows, or the home directory elsewhere.
  if (!requestedPath) {
    if (process.platform === "win32") {
      return NextResponse.json({ path: null, parent: null, entries: listWindowsDrives() });
    }
    const home = os.homedir();
    return listDirectory(home);
  }

  return listDirectory(path.resolve(requestedPath));
}

function listDirectory(dirPath: string): NextResponse {
  if (!fs.existsSync(dirPath)) {
    return NextResponse.json({ error: `경로를 찾을 수 없습니다: ${dirPath}` }, { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    return NextResponse.json({ error: `경로에 접근할 수 없습니다: ${dirPath}` }, { status: 400 });
  }

  if (!stat.isDirectory()) {
    return NextResponse.json({ error: `폴더가 아닙니다: ${dirPath}` }, { status: 400 });
  }

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: `폴더를 읽을 수 없습니다: ${dirPath}` }, { status: 400 });
  }

  const entries: Entry[] = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ name: d.name, path: path.join(dirPath, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parsed = path.parse(dirPath);
  const isDriveRoot = process.platform === "win32" && parsed.root === dirPath;
  const parent = isDriveRoot ? null : path.dirname(dirPath);

  return NextResponse.json({ path: dirPath, parent, entries });
}
