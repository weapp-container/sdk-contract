# Weapp Container SDK contracts

Source version `0.1.0-preview.5` (private preview), C ABI `1`. This repository contains the C embedding
header, TypeScript business API, adapter contract, shared consumer fixture and
authorized binary retrieval tools. It contains no Rust runtime, engine, renderer
implementation, native binary, private monorepo history or build cache.

The Apache-2.0 license applies to this repository's contracts, wrappers/tooling
and authored example code. It does **not** license the separate runtime binaries.
Those remain governed by their accompanying `RUNTIME-LICENSE` and third-party
notices. A read token authorizes downloading; it does not change those licenses.
This repository is private initially. The tooling performs no public publishing.

## Contracts and fixture

- `include/weapp_container_sdk.h`: versioned C ABI; immutable frame handles and ownership.
- `include/weapp_container_sdk_gl.h`: optional GL resolver extension; the GLES ABI header is unchanged.
- `types/weapp-container.d.ts`: `weappContainer` business messaging and host methods.
- `CONTRACT.md` and `FLUTTER_PROTOCOL.md`: adapter scheduling and transport behavior.
- `PREVIEW5.md`: additive source protocols for atomic layout, deferred navigation,
  independent execution health and accepted-pack attempt reconciliation; not a release notice.
- `platforms.json`: requested platform matrix, not a list of passed environments.
- `ORIGIN.json`: exact allowlisted source commit, source hashes and export transformations.

Generate the shared app directly with Node 24; no private source pack, compiler
or runtime is needed:

```sh
node fixtures/make-acceptance-pack.mjs --out /tmp/sdk-acceptance-pack
```

`makeAcceptancePack(destination)` and the compatible
`makeFixture(unusedRepository, destination)` export the same deterministic fixture.
It authors a portable manifest and content-addressed blobs. Schema v1 requires the
compiler name `weapp-vite`; the fixture's commit explicitly says
`handwritten-sdk-contract-fixture-not-a-compiler-build`. It is consumer test input,
not actual upstream compiler output, official parity or platform execution evidence.
No private implementation or official private resource is included.

The default lock identifies the newly built **0.1.0-preview.5** QuickJS + Skia GPU
artifacts by exact size and SHA-256. It contains seven runtime slices and Android,
iOS and macOS universal SDK packages; native production is bound to
`05aec6c4056a124a9c399c75b34d081cffbdaa5d`, while wrapper producer commits are
recorded separately in archive provenance. Historical preview.2/3/4 releases,
reports and source identities remain unchanged. No older-runtime fallback is
allowed. Windows/Linux runtime distributions remain blocked. Archive validation,
private publication and actual Player/GPU/device acceptance are separate gates.
`ORIGIN.json` preserves the initial extraction and records subsequent SDK changes.

## Pin runtime distributions

Node 24 and, for installation, Python 3 are required. The downloader has no npm
dependencies. Keep a reviewed JSON pin file in each SDK; it follows
`runtime-artifacts.schema.json`:

The committed `runtime-artifacts.lock.json` pins preview.5: seven QuickJS + Skia
runtime slices and Android, iOS and macOS universal SDK installations. Its
SHA-256 is `413ecc39ee09f19a807720716e8d8b0657eddeb4bc40e6bfd473b9527e81323d`. The release tag is
`runtime-v0.1.0-preview.5` in the private `weapp-container/runtime-artifacts`
repository. Native production is bound to
`05aec6c4056a124a9c399c75b34d081cffbdaa5d`; archive provenance identifies
wrapper commits separately. A pin identifies exact version, ABI, component,
platform, architecture, byte size and SHA-256. Unknown fields, duplicated
targets/names and mismatched requests fail. There is no `latest`, older-library
search, engine fallback or download from another repository.

`component` is `runtime`, `android-sdk`, `ios-sdk` or `desktop-sdk`. Single-slice
architectures follow `platforms.json`. Multi-slice Android/iOS/macOS archives use
`arch: "universal"` and must list their distinct actual slices in `architectures`.
Windows/Linux use `x86_64`. A failed Windows build remains blocked; a pin cannot
create execution evidence.

A runtime archive contains a single target's installation files directly:
`build.json`, its selected library, public header, `RUNTIME-LICENSE` and `licenses/`.
`runtime-distribution.json` records the retained original build receipt hash and
selected/omitted file partition. Public headers retain Apache-2.0 independently
of the runtime binary license. Unused build intermediates are not distributed.
Install that archive into `<native-root>/<target-triple>`. Complete SDK archives
also start directly at their installation root: Android contains `maven/`,
`licenses/` and `validation.json`; iOS contains `Package.swift`, `Sources/`,
`Frameworks/`, its podspec, `build.json` and licenses; desktop contains `lib/`,
`include/`, `share/` and `package.json`. Archives have no extra enclosing directory.

## Authorized download or offline installation

Give `WEAPP_CONTAINER_RUNTIME_TOKEN` access only to read the private
`weapp-container/runtime-artifacts` repository. Inject it through your shell's
secret manager or CI secret; never put its value in a command, pin, log or Git.
Then select an exact pin:

```sh
node tools/runtime-artifacts.mjs \
  --manifest runtime-artifacts.lock.json --version 0.1.0-preview.5 \
  --component runtime --platform ios --arch arm64-device --abi 1 \
  --out-dir .runtime/downloads --install-dir .runtime/native/aarch64-apple-ios \
  --timeout-ms 900000
```

Without credentials, provide a directory containing the exact pinned archive:

```sh
node tools/runtime-artifacts.mjs \
  --manifest runtime-artifacts.lock.json --version 0.1.0-preview.5 \
  --component runtime --platform ios --arch arm64-device --abi 1 \
  --artifact-dir /authorized/offline-archives \
  --out-dir .runtime/downloads --install-dir .runtime/native/aarch64-apple-ios
```

`WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR` is the equivalent offline directory.
An explicit offline input never falls back to the network. A cached file is reused
only after rechecking its full hash and size. Missing access, missing targets,
corrupt downloads and changed installed files fail explicitly. Tokens are sent
only to the fixed GitHub Releases API repository path. Redirects are handled
manually; signed GitHub storage URLs never receive Authorization.

An artifact transfer has one total deadline for request headers, redirects and
the complete body. The default is 900,000 ms (15 minutes); release metadata has
a separate fixed 30,000 ms deadline. Set `--timeout-ms`, API `timeoutMs`, or
`WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS` for slower authorized downloads. An explicit
CLI/API value takes precedence over the environment, then the default applies.
Values must be positive base-10 integer milliseconds, at most 3,600,000 (one hour);
the API takes a number. Invalid values fail with `ERR_RUNTIME_OPTIONS` before
network/cache work. The setting applies to network transfer, not offline/cache
verification or archive extraction, and does not change the independent 8 GiB
archive limit. Fetch failures, body read errors and timeouts return sanitized
`ERR_RUNTIME_NETWORK`; partial files are removed and no installation is published.
Integrity errors and local I/O errors retain their own error types. The downloader
does not retry, select an older archive or switch transports automatically.

Installation checks the archive again, rejects paths outside the target,
backslashes/control characters, duplicates, all links and special members, sparse
files, excessive metadata, more than 100,000 entries and more than 8 GiB of file
content. It extracts only ordinary files/directories into a fresh sibling staging
directory and publishes after complete validation. Existing unrelated directories
are preserved. A previously owned installation can be reused only when its
`.runtime-install.json` identity and every file/path/hash still match a fresh
independent inventory derived from the pinned archive; the mutable receipt is not
a trust anchor.
The extractor never runs archive scripts and does not infer platform support.

For a wrapper's preparation script, copy **both** `tools/runtime-artifacts.mjs`
and `tools/unpack-runtime.py`, retaining this license, or import the fixed contract
checkout. The API is:

```js
import { downloadRuntimeArtifact } from './runtime-artifacts.mjs';
const result = await downloadRuntimeArtifact({
  manifestPath: 'runtime-artifacts.lock.json', version: '0.1.0-preview.2',
  component: 'runtime', platform: 'ios', arch: 'arm64-device', abiVersion: 1,
  outDirectory: '.runtime/downloads', installDirectory: '.runtime/native/aarch64-apple-ios',
  timeoutMs: 900000, // optional; explicit value overrides the environment
  // artifactDirectory: '/authorized/offline-archives',
});
// result.path, result.receiptPath, result.receipt, result.installDirectory
```

## Verify the tooling

```sh
node --test test/*.test.mjs
```

Tests use local temporary files and injected HTTP responses; they require no
GitHub credentials, actual runtime binary or network. They verify byte pins,
redirect credential boundaries, rejection/cleanup, strict tar installation and
fixture determinism. Mocked fetches and clocks cover metadata/artifact deadlines,
redirect budgets, partial body failures, cleanup and timeout configuration bounds.
These are tooling tests, not native SDK, GPU, simulator,
physical-device or WeChat compatibility acceptance.

The Dev Player declaration fixture also parses with Node 24 and, when an optional
TypeScript compiler is installed, checks correct assignments plus rejected numeric
identities, incomplete layouts and missing acceptance CAS. Without TypeScript that
semantic check is explicitly skipped; syntax/tooling checks still run. Neither
check executes a runtime or upgrades the current artifact lock to preview.5.
