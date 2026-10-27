import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ARTIFACT_TIMEOUT_MS, MAX_ARTIFACT_TIMEOUT_MS, METADATA_TIMEOUT_MS,
  downloadRuntimeArtifact, selectArtifact, SDK_VERSION } from '../tools/runtime-artifacts.mjs';
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

const releaseMetadata = c => ({ tag_name: `runtime-v${SDK_VERSION}`, draft: false,
  assets: [{ id: 17, state: 'uploaded', name: fileName, size: c.bytes.length, digest: `sha256:${hash(c.bytes)}` }] });
function timeoutEnvironment(t, value) {
  const previous = process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS;
  if (value === undefined) delete process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS;
  else process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS = value;
  t.after(() => { if (previous === undefined) delete process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS;
    else process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS = previous; });
}
function stalledBody(ready, cancelled = () => {}) {
  return new ReadableStream({ pull() { ready.resolve(); return new Promise(() => {}); }, cancel: cancelled }, { highWaterMark: 0 });
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

test('timeouts reject invalid API and environment bounds before any cache or network work', async t => {
  const c = await context(t); timeoutEnvironment(t, undefined);
  const options = { ...c.options, token: 'secret', fetchImpl() { assert.fail('Invalid options cannot request a release'); } };
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, MAX_ARTIFACT_TIMEOUT_MS + 1, Number.MAX_SAFE_INTEGER, '900000', null, {}, true]) {
    await assert.rejects(downloadRuntimeArtifact({ ...options, timeoutMs }), { code: 'ERR_RUNTIME_OPTIONS' });
  }
  for (const value of ['', '0', '-1', '1.5', 'NaN', '1e3', ' 1000', String(MAX_ARTIFACT_TIMEOUT_MS + 1)]) {
    process.env.WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS = value;
    await assert.rejects(downloadRuntimeArtifact(options), { code: 'ERR_RUNTIME_OPTIONS' });
  }
  assert.ok(!(await readdir(c.root)).includes('cache'));
  // Explicit settings override even an invalid environment, including offline/cache calls.
  await downloadRuntimeArtifact({ ...options, timeoutMs: 1, artifactDirectory: c.offline });
  await downloadRuntimeArtifact({ ...options, timeoutMs: MAX_ARTIFACT_TIMEOUT_MS, artifactDirectory: c.offline });
});

test('metadata has its own 30 second deadline even if fetch ignores abort', async t => {
  const c = await context(t), ready = Promise.withResolvers(); timeoutEnvironment(t, undefined);
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal, calls = 0;
  const operation = downloadRuntimeArtifact({ ...c.options, timeoutMs: MAX_ARTIFACT_TIMEOUT_MS, token: 'secret',
    fetchImpl(_url, options) { calls++; signal = options.signal; ready.resolve(); return new Promise(() => {}); } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await ready.promise;
  t.mock.timers.tick(METADATA_TIMEOUT_MS - 1); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected; assert.equal(signal.aborted, true); assert.equal(calls, 1);
  assert.deepEqual(await readdir(c.options.outDirectory), []);
});

test('default artifact body deadline allows more than 120 seconds and cleans stalled partial files', async t => {
  const c = await context(t), ready = Promise.withResolvers(); timeoutEnvironment(t, undefined);
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal, cancelled = false;
  const operation = downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl: async (url, options) => {
    if (String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
    signal = options.signal; return new Response(stalledBody(ready, () => { cancelled = true; }));
  } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await ready.promise;
  assert.equal(DEFAULT_ARTIFACT_TIMEOUT_MS, 900_000);
  t.mock.timers.tick(120_001); assert.equal(signal.aborted, false);
  t.mock.timers.tick(DEFAULT_ARTIFACT_TIMEOUT_MS - 120_001); await rejected;
  assert.equal(signal.aborted, true); assert.equal(cancelled, true);
  assert.deepEqual(await readdir(c.options.outDirectory), []);
});

test('one configured artifact deadline covers redirects and body without a fresh budget', async t => {
  const c = await context(t), ready = Promise.withResolvers(); timeoutEnvironment(t, undefined);
  t.mock.timers.enable({ apis: ['setTimeout'] }); const signals = [];
  const operation = downloadRuntimeArtifact({ ...c.options, timeoutMs: 500, token: 'secret', fetchImpl: async (url, options) => {
    if (String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
    signals.push(options.signal);
    if (url.hostname === 'api.github.com') {
      t.mock.timers.tick(350); return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } });
    }
    return new Response(stalledBody(ready));
  } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await ready.promise;
  assert.equal(signals.length, 2); assert.equal(signals[0], signals[1]);
  t.mock.timers.tick(149); assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(1); await rejected; assert.deepEqual(await readdir(c.options.outDirectory), []);
});

test('environment timeout configures unchanged wrapper API calls', async t => {
  const c = await context(t), ready = Promise.withResolvers(); timeoutEnvironment(t, '250');
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal;
  const operation = downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl: async (url, options) => {
    if (String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
    signal = options.signal; return new Response(stalledBody(ready));
  } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await ready.promise;
  t.mock.timers.tick(249); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
});

test('a timeout after body progress removes partial bytes and preserves an existing installation', async t => {
  const c = await context(t, await tarBytes(t)), ready = Promise.withResolvers(); timeoutEnvironment(t, undefined);
  const installation = join(c.root, 'installed'); await mkdir(installation); await writeFile(join(installation, 'preserve'), 'existing installation');
  t.mock.timers.enable({ apis: ['setTimeout'] }); let reads = 0;
  const prefix = c.bytes.subarray(0, Math.floor(c.bytes.length / 2));
  const operation = downloadRuntimeArtifact({ ...c.options, installDirectory: installation, timeoutMs: 500, token: 'secret', fetchImpl: async url => {
    if (String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
    return new Response(new ReadableStream({ pull(controller) {
      if (reads++ === 0) { controller.enqueue(prefix); return; }
      ready.resolve(); return new Promise(() => {});
    } }, { highWaterMark: 0 }));
  } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await ready.promise;
  const partial = (await readdir(c.options.outDirectory)).find(name => name.endsWith('.part')); assert.ok(partial);
  assert.deepEqual(await readFile(join(c.options.outDirectory, partial)), prefix);
  t.mock.timers.tick(500); await rejected;
  assert.deepEqual(await readdir(c.options.outDirectory), []);
  assert.deepEqual(await readdir(installation), ['preserve']);
  assert.equal(await readFile(join(installation, 'preserve'), 'utf8'), 'existing installation');
});

test('responses arriving after a header timeout are disposed instead of retained', async t => {
  const c = await context(t), started = Promise.withResolvers(), response = Promise.withResolvers(); timeoutEnvironment(t, undefined);
  t.mock.timers.enable({ apis: ['setTimeout'] }); let cancelled = false;
  const operation = downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl() { started.resolve(); return response.promise; } });
  const rejected = assert.rejects(operation, { code: 'ERR_RUNTIME_NETWORK' }); await started.promise;
  t.mock.timers.tick(METADATA_TIMEOUT_MS); await rejected;
  response.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(cancelled, true); assert.deepEqual(await readdir(c.options.outDirectory), []);
});

test('metadata and artifact body failures have stable errors without remote text or credentials', async t => {
  const token = 'cannot-appear-in-body-error';
  for (const phase of ['metadata', 'artifact']) {
    const c = await context(t); let calls = 0;
    const fetchImpl = async url => {
      calls++;
      if (phase === 'artifact' && String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error(`${token} https://signed.example/private`)); } }));
    };
    await assert.rejects(downloadRuntimeArtifact({ ...c.options, token, fetchImpl }),
      error => error.code === 'ERR_RUNTIME_NETWORK' && !error.message.includes(token) && !error.message.includes('signed.example'));
    assert.equal(calls, phase === 'metadata' ? 1 : 2); assert.deepEqual(await readdir(c.options.outDirectory), []);
  }
});

test('local write failures retain their IO error and dispose the unused network body', async t => {
  const c = await context(t); let cancelled = false;
  const fetchImpl = async url => {
    if (String(url).includes('/tags/')) return Response.json(releaseMetadata(c));
    await rm(c.options.outDirectory, { recursive: true });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  };
  await assert.rejects(downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl }), { code: 'ENOENT' });
  assert.equal(cancelled, true);
});

test('completed transfers clear both deadline timers', async t => {
  const c = await context(t); timeoutEnvironment(t, undefined); t.mock.timers.enable({ apis: ['setTimeout'] }); const signals = [];
  const result = await downloadRuntimeArtifact({ ...c.options, token: 'secret', fetchImpl: async (url, options) => {
    signals.push(options.signal); return String(url).includes('/tags/') ? Response.json(releaseMetadata(c)) : new Response(c.bytes);
  } });
  t.mock.timers.tick(MAX_ARTIFACT_TIMEOUT_MS + METADATA_TIMEOUT_MS);
  assert.ok(signals.every(signal => !signal.aborted)); assert.deepEqual(await readFile(result.path), c.bytes);
});

test('CLI timeout validates decimal bounds and overrides the environment for offline installation', async t => {
  const c = await context(t), script = fileURLToPath(new URL('../tools/runtime-artifacts.mjs', import.meta.url));
  const argv = [script, '--manifest', c.manifestPath, '--platform', 'linux', '--arch', 'x86_64', '--out-dir', c.options.outDirectory, '--artifact-dir', c.offline];
  const env = { ...process.env, WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS: 'invalid', WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR: '' };
  for (const timeout of ['0', '1.5', '1e3', String(MAX_ARTIFACT_TIMEOUT_MS + 1)]) {
    await assert.rejects(run(process.execPath, [...argv, '--timeout-ms', timeout], { env }),
      error => error.stderr.includes('ERR_RUNTIME_OPTIONS') && !error.stderr.includes('Bearer'));
  }
  const result = await run(process.execPath, [...argv, '--timeout-ms', '900000'], { env });
  assert.equal(JSON.parse(result.stdout).receipt.source, 'offline');
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
