import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { makeFixture, makeAcceptancePack } from '../fixtures/make-acceptance-pack.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object'
  ? `{${Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
test('consumer fixture generates deterministically with no private source pack or compiler', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wc-fixture-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const first = join(root, 'first'), second = join(root, 'second');
  const integrity = makeFixture('/does-not-exist/private-repository', first);
  assert.equal(makeAcceptancePack(second), integrity);
  assert.deepEqual(await readFile(join(first, 'manifest.json')), await readFile(join(second, 'manifest.json')));
  const manifest = JSON.parse(await readFile(join(first, 'manifest.json'), 'utf8'));
  assert.match(manifest.compiler.commit, /handwritten.*not-a-compiler/);
  manifest.integrity.root = ''; assert.equal(hash(canonical(manifest)), integrity);
  assert.equal(manifest.routes.length, 2);
  for (const name of await readdir(join(first, 'blobs/sha256'))) {
    assert.equal(hash(await readFile(join(first,'blobs/sha256',name))), name);
    assert.deepEqual(await readFile(join(first,'blobs/sha256',name)),await readFile(join(second,'blobs/sha256',name)));
  }
  for (const entry of manifest.modules) await readFile(join(first, 'blobs/sha256', entry.sha256));
  for (const entry of manifest.templates) await readFile(join(first, 'blobs/sha256', entry.wxmlAst.slice(7)));
  for (const entry of manifest.styles) await readFile(join(first, 'blobs/sha256', entry.wxssIr.slice(7)));
});

test('authored page declares every wx dependency used at module load and lifecycle/input', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wc-fixture-api-')); t.after(() => rm(directory, { recursive: true, force: true }));
  makeAcceptancePack(directory);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const page = manifest.modules.find(module => module.id === 'module:pages/home/index.js');
  const source = await readFile(join(directory, 'blobs/sha256', page.sha256), 'utf8');
  const used = new Set(), messages = [], timers = [], storage = new Map();
  const requireCapability = name => {
    assert.ok(['partial', 'full'].includes(manifest.capabilities[name]), `Missing fixture capability: ${name}`);
    used.add(name);
  };
  let definition, listener, instance, orientation = 'portrait';
  const methods = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
    getSystemSetting: () => ({ deviceOrientation: orientation }),
    getStorageSync: key => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    createSelectorQuery: () => ({ select() { return this; }, boundingClientRect() { return this; }, exec(callback) { callback([{ left: 0, top: 0, width: 100, height: 160 }]); } }),
    request: options => options.success({ data: { from: 'fixture-provider' } }),
  };
  runInNewContext(source, {
    wx: new Proxy({}, { get(_target, name) { return (...args) => { requireCapability(`wx.${String(name)}`); assert.equal(typeof methods[name], 'function'); return methods[name](...args); }; } }),
    Page: value => { definition = value; },
    getCurrentPages: () => { requireCapability('getCurrentPages'); return [instance]; },
    setTimeout: callback => { requireCapability('wx.timer'); timers.push(callback); return timers.length; },
    weappContainer: {
      postMessage: value => messages.push(value), invoke: () => Promise.resolve({}),
      onMessage: value => { listener = value; }, offMessage() {},
    },
  });
  instance = { ...definition, route: 'pages/home/index', data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  instance.onLoad(); instance.onShow(); instance.onTap(); timers.shift()();
  orientation = 'landscape'; instance.onResize();
  listener({ op: 'inspect' }); listener({ op: 'request', url: 'http://fixture.invalid/' });
  assert.equal(instance.data.count, 1);
  assert.equal(storage.get('sdk-count'), 1);
  assert.ok(messages.some(message => message.kind === 'timer'));
  assert.ok(messages.some(message => message.kind === 'geometry'));
  assert.equal(messages.find(message => message.kind === 'initial').deviceOrientation, 'portrait');
  assert.equal(messages.find(message => message.kind === 'resize').deviceOrientation, 'landscape');
  assert.equal(messages.find(message => message.kind === 'geometry').deviceOrientation, 'landscape');
  assert.ok(messages.some(message => message.kind === 'network'));
  assert.deepEqual([...used].sort(), Object.keys(manifest.capabilities).sort());
});
