import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type DocumentProblem = {
  readonly file: string;
  readonly message: string;
};

type ConventionLink = {
  readonly text: string;
  readonly target: string;
};

export function checkDocuments(root: string): readonly DocumentProblem[] {
  const problems: DocumentProblem[] = [...conventionProblems(root)];
  for (const file of markdownFiles(root)) {
    problems.push(...linkProblems(root, file));
  }
  return problems;
}

function conventionProblems(root: string): readonly DocumentProblem[] {
  const readme = conventionLinks(readFileSync(path.join(root, "README.md"), "utf8"));
  const agents = conventionLinks(readFileSync(path.join(root, "AGENTS.md"), "utf8"));
  if (readme === null) return [{ file: "README.md", message: "Conventions section is missing." }];
  if (agents === null) return [{ file: "AGENTS.md", message: "Conventions section is missing." }];
  if (readme.length === 0) {
    return [{ file: "README.md", message: "Conventions section has no links." }];
  }
  if (!sameLinks(readme, agents)) {
    return [{ file: "AGENTS.md", message: "Convention list does not match README.md." }];
  }
  return [];
}

function sameLinks(left: readonly ConventionLink[], right: readonly ConventionLink[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((link, index) => {
    const other = right[index];
    return other !== undefined && link.text === other.text && link.target === other.target;
  });
}

function conventionLinks(markdown: string): ConventionLink[] | null {
  const section = conventionSection(markdown);
  if (section === null) return null;
  const links: ConventionLink[] = [];
  for (const line of section.split("\n")) {
    const link = conventionLink(line);
    if (link !== null) links.push(link);
  }
  return links;
}

function conventionSection(markdown: string): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Conventions");
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

function conventionLink(line: string): ConventionLink | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- [") || !trimmed.endsWith(")")) return null;
  const splitAt = trimmed.indexOf("](");
  if (splitAt < 0) return null;
  const text = trimmed.slice(3, splitAt);
  const target = trimmed.slice(splitAt + 2, -1);
  if (text.length === 0 || target.length === 0 || target.includes(" ")) return null;
  return { text, target };
}

function markdownFiles(root: string): string[] {
  const files = ["README.md", "AGENTS.md"];
  collectMarkdown(root, path.join(root, "docs"), files);
  return files;
}

function collectMarkdown(root: string, directory: string, files: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectMarkdown(root, fullPath, files);
      continue;
    }
    if (entry.endsWith(".md")) files.push(path.relative(root, fullPath));
  }
}

function linkProblems(root: string, file: string): readonly DocumentProblem[] {
  const problems: DocumentProblem[] = [];
  for (const target of markdownTargets(
    withoutFences(readFileSync(path.join(root, file), "utf8")),
  )) {
    if (isExternal(target)) continue;
    const message = localLinkProblem(root, file, target);
    if (message !== null) problems.push({ file, message });
  }
  return problems;
}

function markdownTargets(markdown: string): string[] {
  const targets: string[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const open = markdown.indexOf("](", cursor);
    if (open < 0) break;
    const close = markdown.indexOf(")", open + 2);
    if (close < 0) break;
    const target = markdown.slice(open + 2, close);
    if (!target.includes(" ") && !target.includes("\n")) targets.push(target);
    cursor = close + 1;
  }
  return targets;
}

function isExternal(target: string): boolean {
  return (
    target.startsWith("https://") || target.startsWith("http://") || target.startsWith("mailto:")
  );
}

function withoutFences(markdown: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const open = markdown.indexOf("```", cursor);
    if (open < 0) {
      parts.push(markdown.slice(cursor));
      break;
    }
    parts.push(markdown.slice(cursor, open));
    const close = markdown.indexOf("```", open + 3);
    if (close < 0) break;
    cursor = close + 3;
  }
  return parts.join("");
}

function localLinkProblem(root: string, file: string, target: string): string | null {
  const hashIndex = target.indexOf("#");
  const pathname = hashIndex < 0 ? target : target.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : target.slice(hashIndex + 1);
  const linkedFile = pathname === "" ? file : relativeInside(root, file, pathname);
  if (linkedFile === null) return `Link target leaves the repository: ${target}.`;
  const absolute = path.join(root, linkedFile);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return `Missing link target ${target}.`;
  }
  if (hash === "" || headingSlugs(readFileSync(absolute, "utf8")).has(decodeURIComponent(hash))) {
    return null;
  }
  return `Missing heading #${hash} in ${linkedFile}.`;
}

function relativeInside(root: string, file: string, pathname: string): string | null {
  const resolved = path.resolve(path.dirname(path.join(root, file)), pathname);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative;
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of withoutFences(markdown).split("\n")) {
    const text = headingText(line);
    if (text !== null) slugs.add(githubSlug(text));
  }
  return slugs;
}

function headingText(line: string): string | null {
  let level = 0;
  while (level < line.length && line[level] === "#") level += 1;
  if (level < 1 || level > 6 || line[level] !== " ") return null;
  return line.slice(level + 1).trim();
}

function githubSlug(text: string): string {
  let slug = "";
  let hyphen = false;
  for (const character of text.toLowerCase()) {
    if (isSlugCharacter(character)) {
      if (hyphen && slug.length > 0) slug += "-";
      hyphen = false;
      slug += character;
      continue;
    }
    if (character === " " || character === "\t") hyphen = true;
  }
  return slug;
}

function isSlugCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code === 95 || code === 45;
}
