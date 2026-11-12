# Weapp Container SDK 合约

运行库发行工具已迁入 [核心仓库](https://github.com/weapp-container/weapp-container/tree/main/tools/runtime-artifacts)。新清单使用核心仓库的精确版本 Release；用 `--manifest` 显式选取。当前默认锁继续读取旧 `runtime-artifacts` 的历史版本，版本、哈希及随附许可不变。旧仓库归档后只保留历史下载；无跨仓库回退。私有仓库下载仍需对应读取权限，源码许可不代表发行物公开可用。

核心运行时与 SDK 自有源码采用 Apache-2.0，可按[主仓库源码构建说明](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-repositories.md)构建当前运行库。现有预编译归档保留原许可、访问要求及精确版本和哈希锁；本次源码更新不发布替代二进制。

**简体中文** | [English](README.en.md)

Weapp Container 各端 SDK 共用的 C ABI、TypeScript 类型、适配协议、测试 pack 和运行库下载工具。应用开发优先使用 [Android](https://github.com/weapp-container/sdk-android)、[iOS](https://github.com/weapp-container/sdk-ios)、[Desktop](https://github.com/weapp-container/sdk-desktop)、[Flutter](https://github.com/weapp-container/sdk-flutter) 或 [React Native](https://github.com/weapp-container/sdk-react-native) SDK；本仓库主要供自研宿主、适配器及构建工具使用。

当前源码版本：`0.1.0-preview.5.7`，C ABI：`1`。源码按 Apache-2.0 开源，不包含运行库实现或二进制。当前运行库源码采用 Apache-2.0，分发时须保留 `RUNTIME-LICENSE` 和第三方声明。

## 获取与目录

工具需要 Node.js 24.x，安装运行库归档还需要 Python 3；无需安装 npm 依赖。

```sh
git clone https://github.com/weapp-container/sdk-contract.git
cd sdk-contract
```

| 文件 | 用途 |
| --- | --- |
| [include/weapp_container_sdk.h](include/weapp_container_sdk.h) | C ABI、会话、帧和 GPU 接口及所有权规则 |
| [include/weapp_container_sdk_gl.h](include/weapp_container_sdk_gl.h) | 可选 GL resolver 扩展 |
| [types/weapp-container.d.ts](types/weapp-container.d.ts) | 小程序业务消息、宿主调用及协议类型 |
| [CONTRACT.md](CONTRACT.md) | 宿主适配器的调度、事件和生命周期协议 |
| [FLUTTER_PROTOCOL.md](FLUTTER_PROTOCOL.md) | Flutter 与原生适配器的通道约定 |
| [runtime-artifacts.schema.json](runtime-artifacts.schema.json) | 精确版本运行库锁文件格式 |
| [platforms.json](platforms.json) | 平台和架构标识，不代表平台已通过验证 |

## 生成可加载的测试 pack

这一步不需要运行库、私有源码或编译器：

```sh
node fixtures/make-acceptance-pack.mjs --out /tmp/sdk-acceptance-pack
```

将生成的目录传给平台 SDK 的 `load` 接口。目录包含 `manifest.json` 和 `blobs/sha256/`，页面提供点击计数、滚动及宿主消息交互。

也可在 Node.js 工具中调用：

```js
import { makeAcceptancePack } from './fixtures/make-acceptance-pack.mjs';

const integrityRoot = makeAcceptancePack('/absolute/sdk-acceptance-pack');
console.log(integrityRoot);
```

此 pack 是手写的 SDK 消费测试输入，不是上游编译器构建产物。生成成功不代表运行库、渲染或平台验收通过。

## 小程序与宿主通信

运行库向小程序提供全局 `weappContainer`。业务代码使用 `postMessage` 发送消息，使用 `invoke` 调用宿主事先注册的方法：

```js
function connectHost() {
  const listener = message => console.log('来自宿主：', message);
  weappContainer.onMessage(listener);
  weappContainer.postMessage({ type: 'demo.ready' });

  weappContainer.invoke('profile.current', {}, { timeout: 5000 })
    .then(profile => console.log('用户：', profile))
    .catch(error => console.error('宿主调用失败：', error));

  return () => weappContainer.offMessage(listener);
}
```

进入页面时调用 `connectHost()`，退出时执行返回的清理函数。宿主须在加载 pack 前注册 `profile.current`，收到 HostCall 后完成或拒绝请求。负载必须是 JSON 数据；具体原生 API 见各端 SDK README。

## C ABI 最小接入

将头文件加入 include 路径，并链接同版本的已授权运行库。可先检查 ABI：

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

自研适配器通过 `weapp_container_sdk_session_new` 创建会话，使用 `weapp_container_sdk_session_command` 执行 [CONTRACT.md](CONTRACT.md) 中定义的命令：

| 步骤 | 操作 |
| --- | --- |
| 创建 | 在固定线程创建会话，提供真实窗口信息与应用私有存储配置 |
| 加载 | `load`，负载为 `{ "packPath": "/absolute/portable-pack" }` |
| 驱动 | 在宿主循环中调用 `pump` 和 `takeEvents`；显示与隐藏时都处理异步完成 |
| 持久化 | `flushStorage`，按返回 ticket 等待对应 `storageFlushed` |
| 关闭 | 使用异步 `close` 命令，继续 pump 到 `closed`，处理持久化错误后销毁句柄 |

每次调用的结果缓冲区须初始化为 `{NULL, 0}`。结果是带长度的 UTF-8 JSON，并非以 NUL 结尾；使用后调用 `weapp_container_sdk_buffer_free()`，再复用缓冲区。会话操作不可重入，必须在创建线程执行。关闭或销毁前先停止渲染并分离 GPU surface；C 的同步 close 只用于最终清理。完整规则以头文件和适配协议为准。

## 按精确版本获取运行库

当前 [默认锁文件](runtime-artifacts.lock.json) 仍锁定历史 `0.1.0-preview.5.3` 归档，不能用作当前 `preview.5.7` 源码的配套运行库。当前源码所需的新归档及独立消费验证仍待提供；接入时应选用与目标 SDK 完全匹配的已审核锁文件。

以下命令仅演示按现有历史锁获取 iOS arm64 运行库。获得授权后，通过密钥管理器或 CI secret 注入 `WEAPP_CONTAINER_RUNTIME_TOKEN`：

```sh
node tools/runtime-artifacts.mjs \
  --manifest runtime-artifacts.lock.json --version 0.1.0-preview.5.3 \
  --component runtime --platform ios --arch arm64-device --abi 1 \
  --out-dir .runtime/downloads \
  --install-dir .runtime/native/aarch64-apple-ios
```

已有授权离线归档时，在同一命令中增加 `--artifact-dir /absolute/authorized-archives`，或设置 `WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR`。显式离线输入不会回退到网络。工具按锁文件校验版本、ABI、大小及 SHA-256，并在完整验证后安装；失败不会选用旧库。

Node.js 调用示例：

```js
import { downloadRuntimeArtifact } from './tools/runtime-artifacts.mjs';

await downloadRuntimeArtifact({
  manifestPath: 'runtime-artifacts.lock.json',
  version: '0.1.0-preview.5.3',
  component: 'runtime', platform: 'ios', arch: 'arm64-device', abiVersion: 1,
  outDirectory: '.runtime/downloads',
  installDirectory: '.runtime/native/aarch64-apple-ios',
});
```

慢速网络可用 `--timeout-ms`、API 的 `timeoutMs` 或 `WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS` 调整下载总超时，默认 900000 毫秒，上限 3600000 毫秒。凭据仅存于私有环境，不应写入源码、命令参数或锁文件。

## 检查与协议细节

```sh
node --test test/*.test.mjs
```

测试使用本地数据和模拟响应，不需要凭据或真实运行库，覆盖归档校验、安装边界、fixture 和类型契约。平台运行验证应在各 SDK 中单独完成。

- [可选布局、导航与执行状态扩展](PREVIEW5.md)
- [原生正确性与生命周期要求](PREVIEW5_3.md)
- [源码许可证](LICENSE) · [原始提取记录](ORIGIN.json)

可选协议能力须先查询并按版本协商；新增字段不改变 C ABI `1`。没有能力声明时，不应假定运行库支持相应扩展。
