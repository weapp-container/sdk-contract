<a id="weapp-container-sdk-合约"></a>
# Weapp Container SDK Contracts

[简体中文](README.md) · **English**

<a id="公开发行候选preview7"></a>
## Public distribution candidate: preview.7

The current core builder and these source examples use preview.7. Core runtime and the iOS and Desktop SDK tarballs in the core prerelease are anonymously downloadable; standalone `sdk-ios` / `sdk-desktop` GitHub releases and fixed CocoaPods archives are not published. Check the [release status](https://github.com/weapp-container/weapp-container/blob/main/docs/public-sdk-release.en.md) for npm, Maven Central and pub.dev publication status. Do not treat a core prerelease archive as a standalone SDK package. Source availability, package publication, compilation and device acceptance are recorded separately.

Contract is public on npm and passed anonymous installation checks. See the release status above for the other SDKs. Historical private archives and locks retain their original identities.

Contract version `0.1.0-preview.7.1`, C ABI `1`. Public preview installation:

```sh
npm install @weapp-container/sdk-contract@0.1.0-preview.7.1
```

This version is public on npm with the `preview` tag. Future releases use trusted publishing from `weapp-container/sdk-contract` and `publish-npm.yml`. The publisher waits for registry metadata, exact archive bytes and the tag to propagate. If verification times out, run `node tools/publish-npm.mjs --receipt /absolute/build.json --verify-published` with the original receipt to verify the public artifact without uploading again.

The package root exports types. Import tools from `@weapp-container/sdk-contract/runtime-artifacts` and `@weapp-container/sdk-contract/fixtures`. Public C headers are in `include/`. Native runtime implementations are distributed separately.

[Documentation](https://container.weapp.dev/en/docs/) · [Source builds](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md) · [APIs and protocols](https://github.com/weapp-container/sdk-contract/blob/main/README.en.md)

Shared C ABI, TypeScript types, adapter protocols, test packs, and runtime retrieval tools for Weapp Container SDKs. Application developers should start with the [Android](https://github.com/weapp-container/sdk-android/blob/main/README.en.md), [iOS](https://github.com/weapp-container/sdk-ios/blob/main/README.en.md), [Desktop](https://github.com/weapp-container/sdk-desktop/blob/main/README.en.md), [Flutter](https://github.com/weapp-container/sdk-flutter/blob/main/README.en.md), or [React Native](https://github.com/weapp-container/sdk-react-native/blob/main/README.en.md) SDK. This repository primarily serves custom hosts, adapters, and build tools.

Source version: `0.1.0-preview.5.7`. C ABI: `1`. Source is open under Apache-2.0; runtime implementations and binaries are not included. New builds of the open-source runtime carry Apache-2.0. Download access does not grant binary usage rights; retain `RUNTIME-LICENSE` and third-party notices when distributing them.

<a id="从当前源码开始"></a>
## Maintainer source builds

Normal applications should install the npm package above. When maintaining the protocol, rebuilding tools, or updating release manifests, use a maintainer-prepared checkout and follow the [source build guide](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md). This package contains protocol types, C headers and test tools, not a native runtime library.

<a id="获取与目录"></a>
## Maintainer source files

Normal applications do not need a source checkout. Maintainer tools require Node.js 24.x; installing runtime archives also needs Python 3.

| File | Purpose |
| --- | --- |
| [include/weapp_container_sdk.h](include/weapp_container_sdk.h) | C ABI, sessions, frames, GPU APIs, and ownership rules |
| [include/weapp_container_sdk_gl.h](include/weapp_container_sdk_gl.h) | Optional GL resolver extension |
| [types/weapp-container.d.ts](types/weapp-container.d.ts) | Mini-app messaging, host calls, and protocol types |
| [CONTRACT.md](CONTRACT.en.md) | Host adapter scheduling, events, and lifecycle |
| [FLUTTER_PROTOCOL.md](FLUTTER_PROTOCOL.en.md) | Flutter/native adapter channel contract |
| [runtime-artifacts.schema.json](runtime-artifacts.schema.json) | Exact runtime artifact lock format |
| [platforms.json](platforms.json) | Platform and architecture identifiers, not acceptance results |

<a id="生成可加载的测试-pack"></a>
## Generate a loadable test pack

This needs no runtime, private source, or compiler:

```sh
node --input-type=module -e "import { makeAcceptancePack } from '@weapp-container/sdk-contract/fixtures'; makeAcceptancePack('/tmp/sdk-acceptance-pack')"
```

Pass the resulting directory to your platform SDK's `load` API. It contains `manifest.json` and `blobs/sha256/`, with pages for tap counts, scrolling, and host messaging.

You can also call it from Node.js:

```js
import { makeAcceptancePack } from '@weapp-container/sdk-contract/fixtures';

const integrityRoot = makeAcceptancePack('/absolute/sdk-acceptance-pack');
console.log(integrityRoot);
```

This is handwritten SDK consumer test input, not upstream compiler output. Generating it does not establish runtime, rendering, or platform acceptance.

<a id="小程序与宿主通信"></a>
## Mini-app and host messaging

The runtime exposes the global `weappContainer` to mini apps. Use `postMessage` for messages and `invoke` for methods registered by your host:

```js
function connectHost() {
  const listener = message => console.log('From host:', message);
  weappContainer.onMessage(listener);
  weappContainer.postMessage({ type: 'demo.ready' });

  weappContainer.invoke('profile.current', {}, { timeout: 5000 })
    .then(profile => console.log('用户：', profile))
    .catch(error => console.error('宿主调用失败：', error));

  return () => weappContainer.offMessage(listener);
}
```

Call `connectHost()` on page entry and its returned cleanup function on exit. Register `profile.current` in the host before loading the pack, then complete or reject the incoming HostCall. Payloads must be JSON values. See each platform SDK README for the native API.

<a id="c-abi-最小接入"></a>
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

Custom adapters create sessions with `weapp_container_sdk_session_new` and send the commands defined in [CONTRACT.md](CONTRACT.en.md) through `weapp_container_sdk_session_command`:

| Step | Operation |
| --- | --- |
| Create | Use one owner thread and provide real window metrics and app-private storage configuration |
| Load | `load` with `{ "packPath": "/absolute/portable-pack" }` |
| Drive | Call `pump` and `takeEvents` in the host loop; process asynchronous completion while visible and hidden |
| Persist | Call `flushStorage` and match its ticket to the corresponding `storageFlushed` |
| Close | Send asynchronous `close`, keep pumping until `closed`, handle persistence errors, then destroy the handle |

Initialize every result buffer to `{NULL, 0}`. Results are length-delimited UTF-8 JSON, not NUL-terminated strings. Release each with `weapp_container_sdk_buffer_free()` before reuse. Session operations must run on their creating thread without reentry. Stop rendering and detach the GPU surface before close or destruction. The synchronous C close function is only the final cleanup barrier. The header and adapter contract define the complete rules.

The [runnable C ABI host consumer](examples/consumer/README.en.md) covers session creation, host-method completion, the event loop, first-frame inspection, and asynchronous shutdown. It is included in the npm package and links a native runtime built from the core repository. The package does not contain runtime binaries.

<a id="按精确版本获取运行库"></a>
## Retrieve an exact runtime version

The [public lock](runtime-artifacts.0.1.0-preview.7.1.lock.json) pins the archives, sizes and SHA-256 hashes for `0.1.0-preview.7.1` from the core `runtime-v0.1.0-preview.7.1` Release. Downloads support anonymous access. The [historical lock](runtime-artifacts.lock.json) remains unchanged.

From the root of a Node.js project with this npm package installed, retrieve the iOS arm64 runtime using the public lock:

```sh
node node_modules/@weapp-container/sdk-contract/tools/runtime-artifacts.mjs \
  --manifest node_modules/@weapp-container/sdk-contract/runtime-artifacts.0.1.0-preview.7.1.lock.json --version 0.1.0-preview.7.1 \
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
  version: '0.1.0-preview.7.1',
  component: 'runtime', platform: 'ios', arch: 'arm64-device', abiVersion: 1,
  outDirectory: '.runtime/downloads',
  installDirectory: '.runtime/native/aarch64-apple-ios',
});
```

For slower connections, use `--timeout-ms`, API `timeoutMs`, or `WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS`. The total transfer deadline defaults to 900000 ms, with a maximum of 3600000 ms. Keep credentials in private environments; do not place them in source files, command arguments, or locks.


<a id="检查与协议细节"></a>
## Checks and protocol details

```sh
node --test test/*.test.mjs
```

Tests use local data and simulated responses without credentials or a real runtime. They cover archive verification, installation boundaries, fixtures, and type contracts. Validate platform execution separately in each SDK.

- [Optional layout, navigation, and execution-state extensions](PREVIEW5.en.md)
- [Native correctness and lifecycle requirements](PREVIEW5_3.en.md)
- [Source license](LICENSE) · [Original extraction receipt](ORIGIN.json)

Query and negotiate optional capabilities by version before using them. Additive fields preserve C ABI `1`; an absent capability declaration does not imply support.

<a id="历史归档与迁移"></a>
## Historical archives and migration

Historical storage: updated downloaders map the nine frozen legacy `runtime-artifacts` versions to the private `weapp-container/runtime-artifacts-private-archive`, retaining original lock bytes, hashes and licenses and recording the resolved repository. Old downloaders must upgrade. The new repository at the old name contains retired tool source only; new runtime releases use the core repository. Private archive access still requires authorization, with no cross-repository fallback.

Runtime packaging and publication now live in the [core repository](https://github.com/weapp-container/weapp-container/tree/main/tools/runtime-artifacts). New manifests select exact core releases through `--manifest`. The default lock retains its historical `runtime-artifacts` source, version, hashes and bundled licenses. The retired repository remains a read-only archive; downloads never fall back between repositories. Private repositories still require read access; source licensing does not imply public binary availability.

The core runtime and SDK source are available under Apache-2.0. Build the current runtime from the [core source guide](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md). Existing prebuilt archives retain their original licenses, access requirements and exact version/hash pins; this source update does not publish replacement binaries.
