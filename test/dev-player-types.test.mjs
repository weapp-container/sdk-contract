import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const declarationUrl = new URL('../types/weapp-container.d.ts', import.meta.url);
const fixtureUrl = new URL('../fixtures/dev-player-contract.ts', import.meta.url);
// No runtime, private implementation or downloaded binary participates.
const sources = new Map(await Promise.all([declarationUrl, fixtureUrl].map(async url => [url.href, await readFile(url, 'utf8')])));

test('public adapter declarations and examples parse with Node 24 TypeScript syntax', async () => {
  for (const url of [declarationUrl, fixtureUrl]) {
    assert.doesNotThrow(() => stripTypeScriptTypes(sources.get(url.href), { sourceUrl: url.href }));
  }
});

test('adapter typecheck rejects numeric identities, half layouts, missing CAS and invalid retirement origins', t => {
  const require = createRequire(import.meta.url);
  let ts;
  try { ts = require('typescript'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    t.skip('Optional TypeScript compiler is unavailable; install TypeScript to run semantic declaration checks.');
    return;
  }
  const program = ts.createProgram([fileURLToPath(fixtureUrl)], {
    noEmit: true, strict: true, skipLibCheck: false, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
});
