import { readFileSync } from 'node:fs';

const [path, minimumText] = process.argv.slice(2);
const minimum = Number(minimumText);
if (!path || !Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
  throw new Error('usage: node scripts/check-go-coverage.mjs REPORT MINIMUM_PERCENT');
}

const report = readFileSync(path, 'utf8');
const match = report.match(/^total:.*?([0-9]+(?:\.[0-9]+)?)%\s*$/m);
if (!match) {
  throw new Error(`Go coverage report ${path} has no total`);
}
const actual = Number(match[1]);
if (actual < minimum) {
  throw new Error(`Go statement coverage ${actual.toFixed(1)}% is below ${minimum.toFixed(1)}%`);
}
console.log(`Go statement coverage ${actual.toFixed(1)}% meets ${minimum.toFixed(1)}%`);
