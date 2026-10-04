import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export function isReadableDocument(path) {
  return /\.(?:md|rst|txt)$/i.test(path) || /(?:^|\/)README(?:\.[^/]*)?$/i.test(path);
}

// These rules supplement the credential scanner; they do not certify all text.
const disclosureRules = [
  ['private deployment label', /\bsandbox\d+\b|\bgrok-bot(?:-sandbox)?\b/i],
  ['downstream project detail', /\bWAOS\b|\bwaosLoginEpoch\b|docs\/superpowers\//],
  ['private workflow reference', /\brelease-tray\b|\bputtyprofile\b|\btmux\b|\bpane\s+%\d+\b/i],
  ['captured account or storage path', /\/home\/(?:ubuntu\/|sandbox\b|tester\/dev\/|\.remotexapp)|\/mnt\/(?:CloudDrive|MyDrive)\b/],
  ['captured runtime identity', /\b(?:lightview|mousepad|firefox-esr|edge|xfce-desktop|xfce-user-desktop)-[a-f0-9]{8,}\b/i],
  ['personal contact address', /\bwoodegg@hotmail\.com\b/i],
  ['private downstream task', /\b(?:TASK-\d+(?:-\d+)?|RELEASE-\d+|RUNTIME-\d+|BROWSER-\d+|EDITOR-\d+|QA-\d+)\b/],
];

export function disclosureFindings(source) {
  const findings = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const [rule, pattern] of disclosureRules) {
      if (pattern.test(line)) findings.push({ line: index + 1, rule });
    }
  });
  return findings;
}

export function documentLinks(source) {
  return [...source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)]
    .map((match) => ({ match: match[0], target: match[1] }));
}

export function localLinkTarget(target) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return null;
  return target.split('#')[0];
}

export function checkDocuments(root, paths) {
  const failures = [];
  const boundary = resolve(root) + sep;
  for (const path of paths.filter(isReadableDocument)) {
    const source = readFileSync(join(root, path), 'utf8');
    for (const finding of disclosureFindings(source)) {
      failures.push(`${path}:${finding.line}: ${finding.rule}`);
    }
    for (const { target } of documentLinks(source)) {
      const local = localLinkTarget(target);
      if (local === null) continue;
      const destination = resolve(root, dirname(path), local);
      if (!destination.startsWith(boundary) || !existsSync(destination)) {
        failures.push(`${path}: missing or out-of-tree local link: ${target}`);
      }
    }
  }
  return failures;
}

export function readableDocumentsUnder(root, prefix = '') {
  const documents = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) documents.push(...readableDocumentsUnder(root, path));
    else if (entry.isFile() && isReadableDocument(path)) documents.push(path);
    // Do not follow symlinks to files outside the reviewed archive.
    else if (entry.isSymbolicLink() && isReadableDocument(path)) {
      throw new Error(`document symlink is not reviewable: ${path}`);
    }
  }
  return documents.sort();
}

export function rewriteArchiveLinks(root, path, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('expected full source commit');
  let source = readFileSync(join(root, path), 'utf8');
  for (const { match, target } of documentLinks(source)) {
    const local = localLinkTarget(target);
    if (local === null) continue;
    const destination = resolve(root, dirname(path), local);
    if (!destination.startsWith(resolve(root) + sep)) throw new Error(`out-of-tree link: ${path}`);
    if (existsSync(destination)) continue;
    const repoPath = relative(root, destination).split(sep).map(encodeURIComponent).join('/');
    const fragment = target.includes('#') ? target.slice(target.indexOf('#')) : '';
    const url = `https://github.com/woodegg/remotexapp/blob/${commit}/${repoPath}${fragment}`;
    source = source.replace(match, match.replace(`(${target})`, `(${url})`));
  }
  return source;
}
