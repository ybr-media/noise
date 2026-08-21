import { BELL_MARK_BODY as BELL_MARK_PATHS } from "./bell-mark-paths";

const paths = BELL_MARK_PATHS.match(/<path\b[^>]*\/>/g);
if (!paths || paths.length !== 6) throw new Error("Invalid bell mark paths");

function withClass(path: string, className: string): string {
  return path.replace("<path ", `<path class="${className}" `);
}

const faceBase = `<path class="bell-face-base" fill="#fcecac" d="M 48.9 61.8 C 40.5 61.2 33.7 55.2 32.6 47.4 C 32.4 46.5 32.4 46.2 32.4 45.0 L 32.4 43.9 L 32.5 43.4 C 33.0 39.3 34.7 35.9 37.7 33.1 C 46.2 25.1 60.4 27.4 65.7 37.6 C 70.0 45.8 66.6 55.7 58.0 59.9 C 55.3 61.3 51.9 62.0 48.9 61.8 Z" />`;

export const BELL_MARK_BODY = [
  withClass(paths[0], "bell-body"),
  withClass(paths[1], "bell-shadow"),
  faceBase,
  withClass(paths[2], "bell-face"),
  withClass(paths[3], "bell-ink"),
  withClass(paths[4], "bell-eyes"),
  withClass(paths[5], "bell-smile"),
].join("");
