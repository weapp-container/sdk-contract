import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { downloadRuntimeArtifact, selectArtifact, SDK_VERSION } from '../tools/runtime-artifacts.mjs';
const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileName = 'runtime-0.1.0-preview.2-linux-x86_64.tar.gz';
const expected = { version: SDK_VERSION, platform: 'linux', arch: 'x86_64', component: 'runtime', abiVersion: 1 };
function pin(bytes) { return { schemaVersion: 1, runtimeVersion: SDK_VERSION, abiVersion: 1,
  source: { repository: 'weapp-container/runtime-artifacts', releaseTag: `runtime-v${SDK_VERSION}` },
  artifacts: [{ component: 'runtime', platform: 'linux', arch: 'x86_64', fileName, size: bytes.length, sha256: hash(bytes) }] }; }
async function context(t, bytes = Buffer.from('pinned runtime bytes')) {
  const root = await mkdtemp(join(tmpdir(), 'wc-contract-')); t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = pin(bytes); const manifestPath = join(root, 'pins.json'); await writeFile(manifestPath, JSON.stringify(manifest));
  const offline = join(root, 'offline'); await mkdir(offline); await writeFile(join(offline, fileName), bytes);
  return { root, bytes, manifest, offline, manifestPath, options: { ...expected, manifestPath, outDirectory: join(root, 'cache') } };
}
async function tarBytes(t, members = [{ name: 'lib/runtime.a', data: 'native bytes' }]) {
  const root = await mkdtemp(join(tmpdir(), 'wc-tar-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'archive.tar.gz');
  await run('python3', ['-c', `import io,json,sys,tarfile
with tarfile.open(sys.argv[1],'w:gz',format=tarfile.PAX_FORMAT) as archive:
 for item in json.loads(sys.argv[2]):
  info=tarfile.TarInfo(item['name']); data=item.get('data','').encode(); kind=item.get('kind','file')
  if kind=='file': info.size=len(data); archive.addfile(info,io.BytesIO(data))
  else:
   info.type={'directory':tarfile.DIRTYPE,'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE,'fifo':tarfile.FIFOTYPE}[kind]
   info.linkname=item.get('linkname','../../../escape'); archive.addfile(info)
`, path, JSON.stringify(members)]);
  return readFile(path);
}

test('manifest pins exact version, ABI, component and target without fallback', () => {
  const manifest = pin(Buffer.from('x'));
  assert.equal(selectArtifact(manifest, expected).runtimeVersion, SDK_VERSION);
  for (const override of [{ version: 'latest' }, { version: '0.1.0-preview.1' }, { abiVersion: 2 }, { arch: 'arm64' }, { component: 'desktop-sdk' }, { platform: '__proto__' }]) {
    assert.throws(() => selectArtifact(manifest, { ...expected, ...override }), /match|contain|required/i);
  }
  for (const alter of [m => m.source.repository = 'other/private', m => m.source.releaseTag = 'latest', m => m.artifacts.push({ ...m.artifacts[0] }),
    m => m.artifacts[0].fileName = '../escape.tar.gz', m => m.artifacts[0].size = -1,
    m => m.artifacts[0].sha256 = 'bad', m => m.artifacts[0].platform = '__proto__', m => m.unrecognized = true]) {
    const changed = structuredClone(manifest); alter(changed); assert.throws(() => selectArtifact(changed, expected));
  }
});

test('universal bundles must declare actual distinct slices', () => {
  const manifest = pin(Buffer.from('x')); Object.assign(manifest.artifacts[0], { platform: 'ios', arch: 'universal', component: 'ios-sdk', architectures: ['arm64-device', 'arm64-simulator'] });
  const request = { ...expected, platform: 'ios', arch: 'universal', component: 'ios-sdk' };
  assert.deepEqual(selectArtifact(manifest, request).architectures, ['arm64-device', 'arm64-simulator']);
  manifest.artifacts[0].architectures = ['arm64-device', 'arm64-device']; assert.throws(() => selectArtifact(manifest, request), /slices/);
});

test('offline copy verifies bytes and rechecks a cached artifact without credentials or network', async t => {
  const c = await context(t); const options = { ...c.options, artifactDirectory: c.offline, token: '', fetchImpl() { assert.fail('No network in offline mode'); } };
  const first = await downloadRuntimeArtifact(options); assert.equal(first.receipt.source, 'offline'); assert.deepEqual(await readFile(first.path), c.bytes);
  const second = await downloadRuntimeArtifact(options); assert.equal(second.receipt.source, 'verified-cache');
  await writeFile(first.path, Buffer.alloc(c.bytes.length, 'z'));
  await assert.rejects(downloadRuntimeArtifact(options), { code: 'ERR_RUNTIME_INTEGRITY' });
  assert.deepEqual(await readFile(first.path), Buffer.alloc(c.bytes.length, 'z'));
});

test('wrong offline bytes and symlinks fail without publishing a cache entry', async t => {
  const c = await context(t); await writeFile(join(c.offline, fileName), Buffer.alloc(c.bytes.length, 'z'));
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, artifactDirectory: c.offline }), { code: 'ERR_RUNTIME_INTEGRITY' });
  assert.deepEqual(await readdir(c.options.outDirectory), []);
  await rm(join(c.offline, fileName)); await writeFile(join(c.root, 'outside'), c.bytes); await symlink(join(c.root, 'outside'), join(c.offline, fileName));
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, artifactDirectory: c.offline }), { code: 'ERR_RUNTIME_INTEGRITY' });
});

test('missing credentials fail explicitly before networking', async t => {
  const c = await context(t);
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, token: '', artifactDirectory: undefined, fetchImpl() { assert.fail('No request without credentials'); } }), { code: 'ERR_RUNTIME_CREDENTIALS' });
});

test('authorized GitHub redirect strips Authorization from signed asset host', async t => {
  const c = await context(t); const token = 'private-test-token'; const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (String(url).includes('/releases/tags/')) return Response.json({ tag_name: `runtime-v${SDK_VERSION}`, draft: false,
      assets: [{ id: 17, state: 'uploaded', name: fileName, size: c.bytes.length, digest: `sha256:${hash(c.bytes)}` }] });
    if (url.hostname === 'api.github.com') return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?signature=opaque' } });
    return new Response(c.bytes, { headers: { 'Content-Length': String(c.bytes.length) } });
  };
  const result = await downloadRuntimeArtifact({ ...c.options, token, fetchImpl });
  assert.equal(calls.length, 3); assert.equal(calls[0].headers.Authorization, `Bearer ${token}`); assert.equal(calls[1].headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[2].headers.Authorization, undefined); assert.ok(calls.every(call => call.redirect === 'manual'));
  assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!JSON.stringify(result).includes('signature'));
});

test('foreign repository or HTTP redirect is rejected before forwarding credentials', async t => {
  for (const location of ['https://api.github.com/repos/evil/private/releases/1', 'http://release-assets.githubusercontent.com/asset', 'https://evil.example/asset']) {
    const c = await context(t); let requests = 0;
    const fetchImpl = async () => { requests++; return new Response(null, { status: 302, headers: { location } }); };
    await assert.rejects(downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl }), { code: 'ERR_RUNTIME_REDIRECT' }); assert.equal(requests, 1);
  }
});

test('network failures never include the token or raw remote error text', async t => {
  const c = await context(t); const token = 'cannot-appear-in-output';
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, token, fetchImpl() { throw new Error(token); } }), error => error.code === 'ERR_RUNTIME_NETWORK' && !error.message.includes(token));
});

test('release size mismatch and truncated stream cannot publish an artifact', async t => {
  const c = await context(t);
  const metadata = { tag_name: `runtime-v${SDK_VERSION}`, draft: false, assets: [{ id: 4, state: 'uploaded', name: fileName, size: c.bytes.length + 1 }] };
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl: async () => Response.json(metadata) }), { code: 'ERR_RUNTIME_RELEASE' });
  metadata.assets[0].size = c.bytes.length;
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl: async url => String(url).includes('/tags/') ? Response.json(metadata) : new Response(c.bytes.subarray(0, 3)) }), { code: 'ERR_RUNTIME_INTEGRITY' });
  assert.deepEqual(await readdir(c.options.outDirectory), []);
});

test('valid tar installs atomically and detects tampering before reuse', async t => {
  const c = await context(t, await tarBytes(t)); const destination = join(c.root, 'installed');
  const options = { ...c.options, artifactDirectory: c.offline, installDirectory: destination };
  const installed = await downloadRuntimeArtifact(options); assert.equal(installed.installDirectory, destination); assert.equal(installed.installation.reused, false);
  assert.equal(await readFile(join(destination, 'lib/runtime.a'), 'utf8'), 'native bytes');
  assert.equal((await downloadRuntimeArtifact(options)).installation.reused, true);
  await writeFile(join(destination, 'lib/runtime.a'), 'changed');
  await assert.rejects(downloadRuntimeArtifact(options), { code: 'ERR_RUNTIME_INSTALL' });
  assert.equal(await readFile(join(destination, 'lib/runtime.a'), 'utf8'), 'changed');
});

test('unsafe tar paths, links, duplicates and control characters never publish a destination', async t => {
  for (const members of [
    [{ name: '../escape', data: 'x' }], [{ name: '/absolute', data: 'x' }], [{ name: 'a\\b', data: 'x' }], [{ name: 'bad\nname', data: 'x' }],
    [{ name: 'link', kind: 'symlink' }], [{ name: 'link', kind: 'hardlink' }], [{ name: 'pipe', kind: 'fifo' }],
    [{ name: 'same', data: 'x' }, { name: './same', data: 'y' }], [{ name: '.runtime-install.json', data: '{}' }],
  ]) {
    const c = await context(t, await tarBytes(t, members)); const destination = join(c.root, 'installed');
    await assert.rejects(downloadRuntimeArtifact({ ...c.options, artifactDirectory: c.offline, installDirectory: destination }), { code: 'ERR_RUNTIME_INSTALL' });
    assert.ok(!(await readdir(c.root)).some(name => name.startsWith('.installed.install-') || name === 'installed'));
  }
});

test('extractor bounds bytes and preserves preexisting unowned directories', async t => {
  const c = await context(t, await tarBytes(t)); const destination = join(c.root, 'installed');
  await mkdir(destination); await writeFile(join(destination, 'owned-by-app'), 'preserve');
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, artifactDirectory: c.offline, installDirectory: destination }), { code: 'ERR_RUNTIME_INSTALL' });
  assert.equal(await readFile(join(destination, 'owned-by-app'), 'utf8'), 'preserve');
  const fresh = join(c.root, 'bounded'); const script = fileURLToPath(new URL('../tools/unpack-runtime.py', import.meta.url));
  await assert.rejects(run('python3', [script, '--archive', join(c.offline, fileName), '--destination', fresh, '--sha256', hash(c.bytes), '--identity-json', '{}', '--max-bytes', '1']));
  assert.ok(!(await readdir(c.root)).includes('bounded'));
});

test('CLI reports missing credentials without exposing environment credentials', async t => {
  const c = await context(t); const script = fileURLToPath(new URL('../tools/runtime-artifacts.mjs', import.meta.url));
  await assert.rejects(run(process.execPath, [script, '--manifest', c.manifestPath, '--platform', 'linux', '--arch', 'x86_64', '--out-dir', c.options.outDirectory],
    { env: { ...process.env, WEAPP_CONTAINER_RUNTIME_TOKEN: '', WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR: '' } }), error => error.stderr.includes('ERR_RUNTIME_OPTIONS') && !error.stderr.includes('Bearer'));
});


test('changing both installed bytes and its local receipt cannot forge archive provenance', async t => {
  const c = await context(t, await tarBytes(t)); const destination = join(c.root, 'installed');
  const options = { ...c.options, artifactDirectory: c.offline, installDirectory: destination };
  await downloadRuntimeArtifact(options);
  const changed = Buffer.from('forged bytes'); await writeFile(join(destination, 'lib/runtime.a'), changed);
  const receiptFile = join(destination, '.runtime-install.json'); const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  const item = receipt.files.find(value => value.path === 'lib/runtime.a'); item.size = changed.length; item.sha256 = hash(changed);
  await writeFile(receiptFile, JSON.stringify(receipt));
  await assert.rejects(downloadRuntimeArtifact(options), { code: 'ERR_RUNTIME_INSTALL' });
  assert.deepEqual(await readFile(join(destination, 'lib/runtime.a')), changed);
});

test('a concatenated hidden second tar is rejected rather than ignored', async t => {
  const first = await tarBytes(t), second = await tarBytes(t, [{ name: '../hidden-escape', data: 'bad' }]);
  const c = await context(t, Buffer.concat([first, second]));
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, artifactDirectory: c.offline, installDirectory: join(c.root, 'installed') }), { code: 'ERR_RUNTIME_INSTALL' });
});
