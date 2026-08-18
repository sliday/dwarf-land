import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The save has three parties and no contract between them.
 *
 *  - `getSerializableState` in `public/game-worker.js` — the one that actually runs. When a
 *    worker exists, `saveGameState` posts `save_request` and the worker's reply is what reaches
 *    `/api/state/save`.
 *  - `getSerializableState` in `public/index.html` — the no-worker fallback, and `beforeunload`
 *    when the worker is inactive.
 *  - `restoreState` in `public/index.html` — reads `saved.*` back.
 *
 * Nothing has ever checked that the three agree. Adding a field to the page copy alone is
 * invisible: that is exactly what happened with `colonies` on 2026-08-18, and the commit log
 * records the same class of failure before it under "silent save loss". A field read by
 * `restoreState` but never written is the mirror image — it restores as undefined, forever.
 *
 * Two style assumptions this parser depends on, neither of which anything enforces:
 *   - the serializers write `name: value`, not shorthand `name,`. A shorthand field adopted in
 *     BOTH files at once vanishes from both key sets, so the agreement check still passes while
 *     covering nothing.
 *   - `restoreState` reads `saved.x`, not `const { x } = saved` or `saved['x']`. A destructured
 *     read becomes invisible here, which would hide the very case this file exists to catch.
 * The explicit key list at the bottom is the backstop for both.
 *
 * Delete this file when the main-thread fallback goes and there is only one serializer left.
 */

const idxSrc = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrkSrc = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

/**
 * Comments have to go before anything is parsed. A prose comment containing a colon — say
 * "the hard-coded table: colonies founded by ..." — otherwise reads as an object key, which is
 * precisely the false positive that showed up while writing this file.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, (_m, lead) => lead);
}

/** Take a whole function by brace matching, so a truncated slice cannot pass silently. */
function functionSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is unterminated`);
}

/** Top-level keys of the object literal the function returns. Nested keys are not counted. */
function savedKeys(src: string, name: string): string[] {
  const fn = stripComments(functionSource(src, name));
  const r = fn.indexOf('return {');
  if (r === -1) throw new Error(`${name} does not return an object literal`);
  const open = fn.indexOf('{', r);
  let depth = 0, end = -1;
  for (let i = open; i < fn.length; i++) {
    if ('{[('.includes(fn[i])) depth++;
    else if ('}])'.includes(fn[i])) {
      depth--;
      if (depth === 0 && fn[i] === '}') { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${name} return literal is unterminated`);

  const body = fn.slice(open + 1, end);
  const keys: string[] = [];
  let d = 0, buf = '';
  for (const ch of body) {
    if ('{[('.includes(ch)) d++;
    else if ('}])'.includes(ch)) d--;
    if (ch === '\n' || (ch === ',' && d === 0)) { buf = ''; continue; }
    buf += ch;
    if (ch === ':' && d === 0) {
      const m = buf.match(/([A-Za-z_$][\w$]*)\s*:$/);
      if (m) keys.push(m[1]);
      buf = '';
    }
  }
  return [...new Set(keys)];
}

/** Every `saved.x` the restore path reads. */
function restoredKeys(): string[] {
  const start = idxSrc.search(/async function restoreState\(|function restoreState\(/);
  if (start === -1) throw new Error('restoreState not found');
  const open = idxSrc.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < idxSrc.length; i++) {
    if (idxSrc[i] === '{') depth++;
    else if (idxSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const fn = stripComments(idxSrc.slice(start, end + 1));
  return [...new Set([...fn.matchAll(/saved\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
}

const pageKeys = savedKeys(idxSrc, 'getSerializableState');
const workerKeys = savedKeys(wrkSrc, 'getSerializableState');
const readKeys = restoredKeys();

describe('the save contract holds across all three parties', () => {
  it('parses a plausible set from each', () => {
    expect(pageKeys.length).toBeGreaterThan(8);
    expect(workerKeys.length).toBeGreaterThan(8);
    expect(readKeys.length).toBeGreaterThan(8);
    // A guard against the comment false positive coming back.
    expect(pageKeys).not.toContain('table');
    expect(workerKeys).not.toContain('table');
  });

  it('both serializers write the same fields', () => {
    const onlyPage = pageKeys.filter((k) => !workerKeys.includes(k));
    const onlyWorker = workerKeys.filter((k) => !pageKeys.includes(k));
    expect(
      { onlyPage, onlyWorker },
      'the worker serializer is the live one; a field in only the page copy is dead weight',
    ).toEqual({ onlyPage: [], onlyWorker: [] });
  });

  it('everything the restore reads is actually written', () => {
    const missing = readKeys.filter((k) => !workerKeys.includes(k));
    expect(missing, 'restoreState reads these but the live save never writes them').toEqual([]);
  });

  it('everything written is actually read back', () => {
    const ignored = workerKeys.filter((k) => !readKeys.includes(k));
    expect(ignored, 'the save carries these but restoreState never reads them').toEqual([]);
  });

  it('carries the fields the simulation cannot be rebuilt without', () => {
    // Named explicitly so deleting one fails here rather than at a player's next reload.
    for (const key of ['tick', 'cityResources', 'colonies', 'dwarves', 'mapDeltas', 'suburbs']) {
      expect(workerKeys, `${key} missing from the live save`).toContain(key);
      expect(readKeys, `${key} never restored`).toContain(key);
    }
  });
});
