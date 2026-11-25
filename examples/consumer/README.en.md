# SDK Contract C ABI Consumer

[简体中文](README.md) · **English**

This is a runnable host consumer for the Contract SDK. It links the separately built `container-sdk-ffi` and demonstrates C ABI session creation, window metrics, portable-pack loading, host-method registration and completion, the `pump`/`takeEvents` event loop, first-frame inspection, message delivery, and asynchronous shutdown. Contract defines host interfaces without a platform UI, so this example is a command-line host process.

## Prepare the runtime and test pack

Run these commands from the core repository root to create the portable fixture and a native C ABI static library for the local target:

```sh
node sdk/contract/fixtures/make-acceptance-pack.mjs --out artifacts/contract-pack
node scripts/sdk-native-build.mjs --target aarch64-apple-darwin --out artifacts/sdk/native
```

`aarch64-apple-darwin` is the Apple Silicon macOS target. Choose a Rust target supported by another host. The resulting `artifacts/sdk/native/<target>/` directory contains `weapp_container_sdk.h` and `libweapp_container_sdk.a`.

## Build and run

Run CMake from the core repository root. The header and library must come from the same target:

```sh
cmake -S sdk/contract/examples/consumer -B artifacts/sdk/contract-consumer \
  -DWEAPP_CONTAINER_SDK_INCLUDE_DIR="$PWD/artifacts/sdk/native/aarch64-apple-darwin" \
  -DWEAPP_CONTAINER_SDK_LIBRARY="$PWD/artifacts/sdk/native/aarch64-apple-darwin/libweapp_container_sdk.a"
cmake --build artifacts/sdk/contract-consumer --config Release
artifacts/sdk/contract-consumer/contract_consumer "$PWD/artifacts/contract-pack"
```

The process writes each `takeEvents` JSON value to stdout, prints first-frame dimensions, stride, and revision, and waits for the `closed` event before calling `session_destroy` for final cleanup.

## Code map

- `main.c` checks the ABI version and initializes every result buffer as `{NULL, 0}`.
- `windowMetrics` submits the real host size before `load`.
- `registerHostMethod` registers the fixture's `native.echo` before loading, then `completeHostCall` resolves it on the same owner thread.
- `pump` and `takeEvents` run on the owner thread until a `frame` event arrives.
- `frame_acquire`, `frame_info`, and `frame_release` show the independent frame reference lifetime.
- `sendMessage` shows the host-to-mini-app JSON entry point.

The sample implements only the fixture's `native.echo`. Production hosts must provide real implementations for exposed methods, honor deadlines and cancellation events, and drain `storageFlushed` and `closed`. Detach a GPU surface before closing. See [CONTRACT.md](../../CONTRACT.en.md) and the [C ABI header](../../include/weapp_container_sdk.h) for the complete fields and thread rules.
