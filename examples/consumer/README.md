# SDK Contract C ABI 消费示例

**简体中文** · [English](README.en.md)

这是 Contract SDK 的可运行宿主消费者。它链接独立构建的 `container-sdk-ffi`，演示 C ABI 的会话创建、窗口指标、portable pack 加载、主机方法注册与完成、`pump`/`takeEvents` 事件循环、首帧读取、消息发送和异步关闭。Contract SDK 定义宿主接口，不提供平台 UI，因此示例是一个命令行宿主进程。

## 准备运行库和测试 pack

从核心仓库根目录执行以下命令，生成 portable fixture 和本机 C ABI 静态库：

```sh
node sdk/contract/fixtures/make-acceptance-pack.mjs --out artifacts/contract-pack
node scripts/sdk-native-build.mjs --target aarch64-apple-darwin --out artifacts/sdk/native
```

`aarch64-apple-darwin` 是 Apple Silicon macOS 目标。其他主机需替换为当前支持的 Rust target。构建完成后，`artifacts/sdk/native/<target>/` 包含 `weapp_container_sdk.h` 和 `libweapp_container_sdk.a`。

## 构建并运行

仍从核心仓库根目录运行 CMake，头文件和静态库路径必须指向同一 target：

```sh
cmake -S sdk/contract/examples/consumer -B artifacts/sdk/contract-consumer \
  -DWEAPP_CONTAINER_SDK_INCLUDE_DIR="$PWD/artifacts/sdk/native/aarch64-apple-darwin" \
  -DWEAPP_CONTAINER_SDK_LIBRARY="$PWD/artifacts/sdk/native/aarch64-apple-darwin/libweapp_container_sdk.a"
cmake --build artifacts/sdk/contract-consumer --config Release
artifacts/sdk/contract-consumer/contract_consumer "$PWD/artifacts/contract-pack"
```

程序会把每次 `takeEvents` 的 JSON 写到标准输出，打印首帧尺寸、stride 和 revision，并等待 `closed` 事件后调用 `session_destroy` 完成最终清理。

## 代码对应关系

- `main.c` 检查 ABI 版本，并把所有 result buffer 初始化为 `{NULL, 0}`。
- `windowMetrics` 在 `load` 前提交真实宿主尺寸。
- `registerHostMethod` 在加载前注册 fixture 使用的 `native.echo`，事件返回后通过 `completeHostCall` 在同一宿主线程完成调用。
- `pump` 与 `takeEvents` 在同一宿主线程运行，直到收到 `frame` 事件。
- `frame_acquire`、`frame_info` 和 `frame_release` 展示帧引用的独立生命周期。
- `sendMessage` 展示宿主向小程序发送 JSON 消息的入口。

示例仅实现 fixture 所需的 `native.echo`，生产宿主需要为其暴露的方法提供真实实现，遵循 deadline 与取消事件，并持续处理 `storageFlushed` 和 `closed`。关闭前先分离 GPU surface。完整字段与线程约束见 [CONTRACT.md](../../CONTRACT.md) 和 [C ABI 头文件](../../include/weapp_container_sdk.h)。
