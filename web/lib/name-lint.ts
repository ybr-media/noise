export type NameLintSeverity = "hard" | "warning";

export type NameLintMessage = {
  row: number;
  title: string;
  severity: NameLintSeverity;
  message: string;
};

export type NameLintResult = {
  messages: NameLintMessage[];
  hardFailures: NameLintMessage[];
  warnings: NameLintMessage[];
};

const keywordChain = /\b(for|sleep|focus|calm|study|asmr)\b/gi;
const urlOrHandle = /(https?:\/\/|www\.|\b[\w.-]+\.(?:com|net|org)\b|@\w+)/i;
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export function lintNames(titles: string[]): NameLintResult {
  const messages: NameLintMessage[] = [];
  const seen = new Map<string, number>();
  titles.forEach((title, row) => {
    const add = (severity: NameLintSeverity, message: string) => messages.push({ row, title, severity, message });
    const normalized = title.trim().toLowerCase();
    if (normalized) {
      const previous = seen.get(normalized);
      if (previous !== undefined) add("hard", `Duplicate title with row ${previous + 1}`);
      else seen.set(normalized, row);
    }
    if (!title.trim()) add("hard", "Title is missing");
    if (title !== title.trim()) add("hard", "Remove leading or trailing whitespace");
    const keywordMatches = title.match(keywordChain) ?? [];
    if (keywordMatches.length >= 4) {
      add("warning", "Avoid keyword-stuffed title chains");
    }
    if (title.length > 2 && title === title.toUpperCase() && /[A-Z]/.test(title)) add("warning", "Avoid ALL CAPS");
    if (emoji.test(title)) add("hard", "Emoji are not allowed");
    if (urlOrHandle.test(title)) add("hard", "URLs and social handles are not allowed");
  });
  return {
    messages,
    hardFailures: messages.filter((message) => message.severity === "hard"),
    warnings: messages.filter((message) => message.severity === "warning"),
  };
}
