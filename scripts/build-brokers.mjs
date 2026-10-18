#!/usr/bin/env node
// Generates data/brokers.json from README.md so agents (see AGENTS.md) can work
// from structured data. README.md stays the source of truth: never edit the
// JSON by hand. Run `npm run build:data` after syncing README changes, and
// `npm run check:data` (CI) to confirm the JSON is current.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const OUTPUT = join(ROOT, 'data', 'brokers.json');

const BROKER_SECTION = 'People Search Sites';

// Symbols from the legend at the top of the README.
const FLAGS = {
  '💐': 'crucial',
  '☠': 'highPriority',
  '🎫': 'requiresId',
  '📞': 'phone',
  '💰': 'paid',
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\b1[\s-])?\(?\b\d{3}\)?[\s.-]\d{3}[\s.‑-]\d{4}\b/g;

// git's blob hash, so agents can compare against `git hash-object README.md`.
export function gitBlobSha(content) {
  const buf = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseHeading(text) {
  const flags = Object.fromEntries(Object.values(FLAGS).map((f) => [f, false]));
  for (const [symbol, flag] of Object.entries(FLAGS)) {
    if (text.includes(symbol)) flags[flag] = true;
  }
  const name = text
    .replace(new RegExp(`[${Object.keys(FLAGS).join('')}]`, 'gu'), '')
    .replace(/️/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, flags };
}

function collectLinks(nodes) {
  const links = [];
  const walk = (node) => {
    if (node.type === 'link') links.push({ text: toString(node), url: node.url });
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return links;
}

function unique(values) {
  return [...new Set(values)];
}

function splitList(list) {
  return list
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.replace(/^and\s+/, '').trim())
    .filter(Boolean);
}

function hints(text) {
  const owns = text.match(/\bowns (.+?)(?:\.(?:\s|$)|, so )/);
  const alsoRemoves = text.match(/also remove your information from ([^.]+)\./);
  return {
    emailConfirm:
      /(confirm|verif)\w*[^.]{0,80}(email|inbox|link)|(email|inbox)[^.]{0,80}(confirm|verif)|link in the email/i.test(text),
    captcha: /captcha/i.test(text),
    accountOrTrial: /free (account|trial)|sign up/i.test(text),
    owns: owns ? splitList(owns[1]) : [],
    alsoRemoves: alsoRemoves ? splitList(alsoRemoves[1]) : [],
  };
}

// Split the document into h2 sections, each with h3 subsections.
function sections(tree, source) {
  const result = [];
  let h2 = null;
  let h3 = null;
  const slice = (nodes) =>
    nodes.length
      ? source.slice(nodes[0].position.start.offset, nodes.at(-1).position.end.offset).trim()
      : '';

  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth <= 2) {
      h2 = { title: toString(node).trim(), nodes: [], subsections: [] };
      h3 = null;
      result.push(h2);
    } else if (node.type === 'heading' && node.depth === 3 && h2) {
      h3 = { heading: toString(node).trim(), nodes: [] };
      h2.subsections.push(h3);
    } else if (h3) {
      h3.nodes.push(node);
    } else if (h2) {
      h2.nodes.push(node);
    }
  }

  for (const section of result) {
    section.markdown = slice(section.nodes);
    for (const sub of section.subsections) sub.markdown = slice(sub.nodes);
  }
  return result;
}

export function buildBrokers(source) {
  const tree = unified().use(remarkParse).parse(source);
  const all = sections(tree, source);

  const brokerSection = all.find((s) => s.title === BROKER_SECTION);
  if (!brokerSection) throw new Error(`README has no "## ${BROKER_SECTION}" section`);

  const brokers = brokerSection.subsections.map((sub) => {
    const { name, flags } = parseHeading(sub.heading);
    const text = sub.nodes.map((n) => toString(n)).join('\n');
    const links = collectLinks(sub.nodes);
    const emails = unique(
      [
        ...links.filter((l) => l.url.startsWith('mailto:')).map((l) => l.url.slice(7)),
        ...(sub.markdown.match(EMAIL) ?? []),
      ].map((e) => e.toLowerCase()),
    );
    return {
      id: slugify(name),
      name,
      tier: flags.crucial ? 1 : flags.highPriority ? 2 : 3,
      flags,
      links: links.filter((l) => !l.url.startsWith('mailto:')),
      emails,
      phones: unique(text.match(PHONE) ?? []),
      hints: hints(text),
      instructions: sub.markdown,
    };
  });

  const updated = source.match(/most recently updated on ([A-Z][a-z]+ \d{1,2}, \d{4})/);

  return {
    $comment:
      'Generated from README.md by scripts/build-brokers.mjs. Do not edit. README.md is the source of truth; "hints" are heuristics.',
    source: 'https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List',
    author: 'Yael Grauer',
    license: 'CC BY-NC-SA 4.0',
    generatedFrom: { file: 'README.md', gitBlobSha: gitBlobSha(source) },
    readmeUpdated: updated ? updated[1] : null,
    legend: FLAGS,
    brokers,
    otherSections: all
      .filter((s) => s !== brokerSection && s.title !== all[0].title)
      .map((s) => ({
        title: s.title,
        markdown: [s.markdown, ...s.subsections.map((sub) => `### ${sub.heading}\n${sub.markdown}`)]
          .filter(Boolean)
          .join('\n\n'),
        links: collectLinks([...s.nodes, ...s.subsections.flatMap((sub) => sub.nodes)]),
      })),
  };
}

function main() {
  const json = `${JSON.stringify(buildBrokers(readFileSync(README, 'utf8')), null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {}
    if (current !== json) {
      console.error('data/brokers.json is out of date with README.md. Run `npm run build:data`.');
      process.exit(1);
    }
    console.log('data/brokers.json is up to date.');
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, json);
  console.log(`Wrote ${OUTPUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
