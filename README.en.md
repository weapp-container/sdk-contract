# Weapp Container SDK Contracts

SDK contracts, C headers and runtime download tools are distributed through npm. Historical private archives and locks retain their original identities.

Contract version `0.1.0-preview.7.0`, C ABI `1`. Public preview installation:

```sh
npm install @weapp-container/sdk-contract@0.1.0-preview.7.0
```

This version is public on npm with the `preview` tag. Future releases use trusted publishing from `weapp-container/sdk-contract` and `publish-npm.yml`. The publisher waits for registry metadata, exact archive bytes and the tag to propagate. If verification times out, run `node tools/publish-npm.mjs --receipt /absolute/build.json --verify-published` with the original receipt to verify the public artifact without uploading again.

The package root exports types. Import tools from `@weapp-container/sdk-contract/runtime-artifacts` and `@weapp-container/sdk-contract/fixtures`. Public C headers are in `include/`. Native runtime implementations are distributed separately.

## Generate a loadable test pack

This needs no runtime, private source, or compiler:

```sh
node fixtures/make-acceptance-pack.mjs --out /tmp/sdk-acceptance-pack
```

Pass the resulting directory to your platform SDK's `load` API. It contains `manifest.json` and `blobs/sha256/`, with pages for tap counts, scrolling, and host messaging.

You can also call it from Node.js:

```js
import { makeAcceptancePack } from './fixtures/make-acceptance-pack.mjs';

const integrityRoot = makeAcceptancePack('/absolute/sdk-acceptance-pack');
console.log(integrityRoot);
```

This is handwritten SDK consumer test input, not upstream compiler output. Generating it does not establish runtime, rendering, or platform acceptance.

## Mini-app and host messaging

The runtime exposes the global `weappContainer` to mini apps. Use `postMessage` for messages and `invoke` for methods registered by your host:

```js
function connectHost() {
  const listener = message => console.log('From host:', message);
  weappContainer.onMessage(listener);
  weappContainer.postMessage({ type: 'demo.ready' });

  weappContainer.invoke('profile.current', {}, { timeout: 5000 })
    .then(profile => console.log('Profile:', profile))
    .catch(error => console.error('Host call failed:', error));

  return () => weappContainer.offMessage(listener);
}
```

Call `connectHost()` on page entry and its returned cleanup function on exit. Register `profile.current` in the host before loading the pack, then complete or reject the incoming HostCall. Payloads must be JSON values. See each platform SDK README for the native API.

## Minimal C ABI integration

Add the headers to your include path and link a matching public runtime. Start by checking the ABI:

```c
#include <stdio.h>
#include <weapp_container_sdk.h>

int main(void) {
  if (weapp_container_sdk_abi_version() != WEAPP_CONTAINER_SDK_ABI_VERSION)
    return 1;
  printf("Weapp Container %s\n", weapp_container_sdk_version());
  return 0;
}
```

Custom adapters create sessions with `weapp_container_sdk_session_new` and send the commands defined in [CONTRACT.md](CONTRACT.md) through `weapp_container_sdk_session_command`:

| Step | Operation |
| --- | --- |
| Create | Use one owner thread and provide real window metrics and app-private storage configuration |
| Load | `load` with `{ "packPath": "/absolute/portable-pack" }` |
| Drive | Call `pump` and `takeEvents` in the host loop; process asynchronous completion while visible and hidden |
| Persist | Call `flushStorage` and match its ticket to the corresponding `storageFlushed` |
| Close | Send asynchronous `close`, keep pumping until `closed`, handle persistence errors, then destroy the handle |

Initialize every result buffer to `{NULL, 0}`. Results are length-delimited UTF-8 JSON, not NUL-terminated strings. Release each with `weapp_container_sdk_buffer_free()` before reuse. Session operations must run on their creating thread without reentry. Stop rendering and detach the GPU surface before close or destruction. The synchronous C close function is only the final cleanup barrier. The header and adapter contract define the complete rules.

## Retrieve an exact runtime version

The [public lock](runtime-artifacts.0.1.0-preview.7.0.lock.json) pins the archives, sizes and SHA-256 hashes for `0.1.0-preview.7.0` from the core `runtime-v0.1.0-preview.7.0` Release. Downloads support anonymous access. The [historical lock](runtime-artifacts.lock.json) remains unchanged.

From a source checkout, retrieve the iOS arm64 runtime using the public lock:

```sh
node tools/runtime-artifacts.mjs \
  --manifest runtime-artifacts.0.1.0-preview.7.0.lock.json --version 0.1.0-preview.7.0 \
  --component runtime --platform ios --arch arm64-device --abi 1 \
  --out-dir .runtime/downloads \
  --install-dir .runtime/native/aarch64-apple-ios
```

For verified offline archives of this version, add `--artifact-dir /absolute/verified-archives` or set `WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR`. Explicit offline input never falls back to the network. The tool checks version, ABI, size, and SHA-256 against the lock and installs only after full verification. Failures do not select older libraries.

Node.js API example:

```js
import { fileURLToPath } from 'node:url';
import { downloadRuntimeArtifact } from '@weapp-container/sdk-contract/runtime-artifacts';

await downloadRuntimeArtifact({
  manifestPath: fileURLToPath(import.meta.resolve('@weapp-container/sdk-contract/runtime-artifacts.lock.json')),
  version: '0.1.0-preview.7.0',
  component: 'runtime', platform: 'ios', arch: 'arm64-device', abiVersion: 1,
  outDirectory: '.runtime/downloads',
  installDirectory: '.runtime/native/aarch64-apple-ios',
});
```

For slower connections, use `--timeout-ms`, API `timeoutMs`, or `WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS`. The total transfer deadline defaults to 900000 ms, with a maximum of 3600000 ms. Keep credentials in private environments; do not place them in source files, command arguments, or locks.

## Checks and protocol details

```sh
node --test test/*.test.mjs
```

Tests use local data and simulated responses without credentials or a real runtime. They cover archive verification, installation boundaries, fixtures, and type contracts. Validate platform execution separately in each SDK.

- [Optional layout, navigation, and execution-state extensions](PREVIEW5.md)
- [Native correctness and lifecycle requirements](PREVIEW5_3.md)
- [Source license](LICENSE) · [Original extraction receipt](ORIGIN.json)

Query and negotiate optional capabilities by version before using them. Additive fields preserve C ABI `1`; an absent capability declaration does not imply support.
