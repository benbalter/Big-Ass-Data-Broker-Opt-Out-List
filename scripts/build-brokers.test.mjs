import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildBrokers, gitBlobSha } from './build-brokers.mjs';

// Parser edge cases, from a fixture so upstream README edits don't break them.
const fixture = `# List

Most recently updated on September 27, 2026.

## Search Engines
Remove results [from Google](https://example.com/google).

## People Search Sites

### 💐Nospace
[Opt out](https://nospace.example/optout). Click on the opt-out link in the email sent to you.

### 💐 📞 💰 Stacked
[Opt out](https://stacked.example/optout). Stacked also owns [411.com](https://411.example), so check there.

### ☠ That’s Them
[Opt out](https://thatsthem.example/optout). Parent owns Alpha, Beta, and Gamma. You may need to solve a captcha.

### Plain
Email <help@plain.example> or call (555) 123-4567. This will likely also remove your information from Other.

## Preventing Identity Theft

### 📞 Consider freezing your credit
Call someone.
`;

const data = buildBrokers(fixture);
const byId = Object.fromEntries(data.brokers.map((b) => [b.id, b]));

test('only includes People Search Sites', () => {
  assert.deepEqual(Object.keys(byId), ['nospace', 'stacked', 'thats-them', 'plain']);
  assert.deepEqual(
    data.otherSections.map((s) => s.title),
    ['Search Engines', 'Preventing Identity Theft'],
  );
});

test('parses a heading with no space after the emoji', () => {
  assert.equal(byId.nospace.name, 'Nospace');
  assert.equal(byId.nospace.tier, 1);
  assert.equal(byId.nospace.hints.emailConfirm, true);
});

test('parses stacked emoji', () => {
  const { flags } = byId.stacked;
  assert.deepEqual([flags.crucial, flags.phone, flags.paid, flags.requiresId], [true, true, true, false]);
});

test('keeps curly apostrophes in names but not ids', () => {
  assert.equal(byId['thats-them'].name, 'That’s Them');
  assert.equal(byId['thats-them'].tier, 2);
  assert.equal(byId['thats-them'].hints.captcha, true);
});

test('extracts parent-company relationships', () => {
  assert.deepEqual(byId.stacked.hints.owns, ['411.com']);
  assert.deepEqual(byId['thats-them'].hints.owns, ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(byId.plain.hints.alsoRemoves, ['Other']);
});

test('extracts emails and phones', () => {
  assert.deepEqual(byId.plain.emails, ['help@plain.example']);
  assert.deepEqual(byId.plain.phones, ['(555) 123-4567']);
  assert.equal(byId.plain.tier, 3);
});

test('extracts the README update date', () => {
  assert.equal(data.readmeUpdated, 'September 27, 2026');
});

// Invariants against the real README.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const real = buildBrokers(readme);

test('real README parses into a plausible broker list', () => {
  assert.ok(real.brokers.length > 10);
  assert.ok(real.brokers.some((b) => b.flags.crucial));
  assert.ok(real.brokers.some((b) => b.flags.highPriority));
  for (const b of real.brokers) assert.ok(b.links.length > 0, `${b.name} has no links`);
  assert.equal(new Set(real.brokers.map((b) => b.id)).size, real.brokers.length, 'ids are unique');
});

test('generatedFrom matches git hash-object', (t) => {
  let expected;
  try {
    expected = execFileSync('git', ['hash-object', 'README.md'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    }).trim();
  } catch {
    return t.skip('git unavailable');
  }
  assert.equal(gitBlobSha(readme), expected);
});
