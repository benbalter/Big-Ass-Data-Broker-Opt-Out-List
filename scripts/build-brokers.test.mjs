import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildBrokers, gitBlobSha } from './build-brokers.mjs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const data = buildBrokers(readme);
const byId = Object.fromEntries(data.brokers.map((b) => [b.id, b]));

test('counts brokers by priority from the headings', () => {
  assert.equal(data.brokers.filter((b) => b.flags.crucial).length, 11);
  assert.equal(data.brokers.filter((b) => b.flags.highPriority).length, 5);
  assert.ok(data.brokers.length >= 40);
});

test('parses a heading with no space after the emoji', () => {
  assert.equal(byId.clustal.name, 'Clustal');
  assert.equal(byId.clustal.flags.crucial, true);
});

test('parses stacked emoji', () => {
  const { flags } = byId['white-pages'];
  assert.deepEqual([flags.crucial, flags.phone, flags.paid], [true, true, true]);
});

test('keeps curly apostrophes in names but not ids', () => {
  assert.equal(byId['thats-them'].name, 'That’s Them');
});

test('extracts parent-company relationships', () => {
  assert.ok(byId.intelius.hints.owns.includes('Truthfinder'));
  assert.ok(byId.intelius.hints.owns.includes('Zabasearch'));
  assert.deepEqual(byId.beenverified.hints.owns, ['PeopleLooker', 'PeopleSmart']);
  assert.deepEqual(byId['white-pages'].hints.owns, ['411.com']);
  assert.deepEqual(byId.smartbackgroundchecks.hints.alsoRemoves, ['PeopleFinders']);
});

test('every broker has at least one link', () => {
  for (const b of data.brokers) assert.ok(b.links.length > 0, `${b.name} has no links`);
});

test('only includes People Search Sites', () => {
  assert.ok(!data.brokers.some((b) => /credit/i.test(b.name)));
  assert.ok(data.otherSections.some((s) => s.title === 'Special Circumstances'));
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
