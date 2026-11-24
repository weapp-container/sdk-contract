import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyNpmPublication } from '../tools/verify-npm-publication.mjs';
import { releasePublication } from '../tools/public-release.mjs';

test('release version selects a stable or preview GitHub channel', () => {
  assert.deepEqual(releasePublication('0.1.0'), { preview: false, prerelease: false, latest: true, channel: 'stable' });
  assert.deepEqual(releasePublication('0.1.0-preview.7.1'), { preview: true, prerelease: true, latest: false, channel: 'preview' });
  assert.throws(() => releasePublication('preview'), /Invalid SDK release version/);
});

const pkg = { name: '@example/contract', version: '0.1.0-preview.7.0' };
const bytes = Buffer.from('frozen verified npm archive');
const metadata = { ...pkg, dist: { integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), tarball: 'https://registry.npmjs.org/archive.tgz' } };
const json = value => new Response(JSON.stringify(value));

test('waits for metadata, archive and preview tag propagation without publishing again', async () => {
  let waits = 0;
  const responses = [new Response('', { status: 404 }), json(metadata), new Response('', { status: 503 }), json(metadata), new Response(bytes), json({}), json(metadata), new Response(bytes), json({ preview: pkg.version })];
  const calls = [];
  const result = await verifyNpmPublication(pkg, bytes, { attempts: 4, wait: async () => waits++, fetchImpl: async (url, options) => {
    assert.equal(options.method, undefined); // Every operation is a read.
    calls.push(url);
    assert.ok(responses.length);
    return responses.shift();
  } });
  assert.equal(waits, 3);
  assert.equal(result.tag, 'preview');
  assert.equal(responses.length, 0);
  assert.equal(calls.length, 9);
});

test('stable npm releases are verified through the latest dist-tag', async () => {
  const stablePackage = { ...pkg, version: '0.1.0' };
  const stableMetadata = { ...stablePackage, dist: metadata.dist };
  const responses = [json(stableMetadata), new Response(bytes), json({ latest: stablePackage.version })];
  const result = await verifyNpmPublication(stablePackage, bytes, {
    fetchImpl: async () => responses.shift(),
  });
  assert.equal(result.tag, 'latest');
  assert.equal(responses.length, 0);
});

test('rejects changed registry bytes even when metadata claims the expected integrity', async () => {
  const responses = [json(metadata), new Response('different archive')];
  await assert.rejects(verifyNpmPublication(pkg, bytes, { fetchImpl: async () => responses.shift() }), /bytes differ/);
});

test('fails closed for a conflicting version and for an exhausted propagation window', async () => {
  await assert.rejects(verifyNpmPublication(pkg, bytes, { fetchImpl: async () => json({ ...metadata, version: 'old' }) }), /identity differs/);
  await assert.rejects(verifyNpmPublication(pkg, bytes, { attempts: 2, wait: async () => {}, fetchImpl: async () => new Response('', { status: 404 }) }), /--verify-published.*do not republish/);
});
