<a id="flutter-plugin-transport-preview4"></a>
# Flutter 插件传输，预览版 4

**简体中文** · [English](FLUTTER_PROTOCOL.en.md)


这是五个联邦实现共享的内部协议。
应用代码使用带类型的安全 Dart 控制器、小部件、事件和宿主调用。
此通道中不会传输图像字节、Rust 指针或序列化的桥接信封。

[预览版 5 源码协议](PREVIEW5.md) 增加了可选的完整原生布局、延迟导航、带类型健康信息和可查询的包尝试（基于 ABI 1）。原生插件必须协商并转发精确的运行时身份和事件；声明本身并不表示五个适配器均已执行或已释放。
旧版预览版 4 二进制文件仍保留以下方法。

<a id="engine-and-ownership"></a>
## 引擎与所有权

- 方法通道：`dev.weapp.container/methods`。
- 事件通道：`dev.weapp.container/events`。
- Linux 平台将每个方法参数映射、成功非空结果和事件以 UTF-8 JSON 编码，封装在 `Uint8List` 标准消息编码器（StandardMessageCodec）值中。这避免了 Linux 嵌入器 NUL 终止的 `FlValue` 字符串截断 JSON 负载。
  空结果可以是原生空值或编码为 JSON 空值。方法名和平台错误码/消息保持标准通道表示。
  其他平台使用普通结构化的 StandardMessageCodec 值。
- 移动平台视图类型：`dev.weapp.container/view`，创建参数为 `{id: integer}`。Android 显式使用混合组合；iOS 使用 UiKitView。
- 一个原生注册表属于一个 Flutter 引擎。会话 ID 在该注册表内单调递增。单个会话最多只能附加一个视图或纹理。已断开的会话在显式关闭前保持可用。
- 在创建会话之前，Dart 会订阅事件并调用 `initialize({clientEpoch: string})`。新的 Dart 运行时生成新的纪元；
  变更纪元将清除并关闭前一个运行时的会话，清除其存储并注销其纹理，然后在初始化完成前进行操作。
  重复相同的纪元是幂等的。热重载保留纪元。
- 引擎断开时也会清理其注册表。对已退役的 ID 或纪元的结果不会影响新会话。没有操作会从栅格回调、宿主回调或后台完成线程进入 Rust。
- 原生回调在运行时操作返回后被分发。原生运行时拥有线程处理命令、泵送和完成交付。
  Android 使用其 SDK HandlerThread，并将 Flutter 回调桥接到主线程；Apple 和桌面插件遵循其原生 SDK 线程契约。
  完成泵送在渲染隐藏时持续进行，但受操作系统限制。

<a id="methods"></a>
## 方法
所有方法返回异步平台结果。失败时使用 SDK 错误码作为平台错误码，并保留错误消息。返回无值的操作返回 `null`。除 `initialize` 和 `create` 之外的所有方法均需要 `id`。

| 方法 | 超出 `id` 的参数 | 返回值 |
| --- | --- | --- |
| `initialize` | `clientEpoch` | 在退任前一纪元后返回 `null` |
| `create` | `storageKey`（字符串；显式为 null 选择内存），可选 `sessionId`、`gpuRequired`、`devDiagnostics` | 返回 `{id}` |
| `registerHostMethod` | `name` | 返回 `null`；在首次加载前 |
| `load` | `packPath`，可选 `route`、`options`（映射） | 在候选激活后返回 `null` |
| `applyDevPack` | `packPath`，可选 `route`、`options`（映射） | 在接受后返回 `{reloadKind,state}`；实际呈现为独立操作 |
| `devState` | 无 | 仅读取的 `{state,pages:[{id,route,data}]}` |
| `clearDevStorage` | 无 | 在清除 wx 存储后持久化刷新返回 `null` |
| `navigate` | `route`、`query`（映射）、`replace`（布尔值） | 返回 `null` |
| `back` | 无 | 返回 `null` |
| `sendMessage` | `message`（JSON 值） | 返回 `null` |
| `setForeground` | `foreground`（布尔值） | 返回 `null` |
| `flushStorage` | 无 | 在持久化后返回 `null` |
| `close` | 无 | 在 GPU/资源退任并持久化后返回 `null`；幂等操作 |
| `state` | 无 | 原生状态映射 |
| `capabilities` | 无 | 实际原生能力映射 |
| `completeHostCall` | `callId`，`result` 或 `error` 中恰好一个 | 返回 `null` |
| `attach` | 下列初始指标完整 | 返回 `{textureId}`；仅桌面端支持 |
| `resize` | 下列指标完整 | 返回 `null`；仅桌面端支持 |
| `detachView` | 无 | 在确认原生 View 退任后返回 `null`；仅移动端支持；用于小部件销毁 |
| `detach` | 无 | 在退任纹理后返回 `null`；仅桌面端支持 |
| `input` | `events`（SDK 输入映射列表） | 返回 `null`；仅桌面端支持 |

主机调用错误形状使用共享提供者错误码，即 `{code, message, retryable}`。原生会话验证生成和调用身份；插件不会复活或重试过期的完成。

桌面端指标使用共享的平面 HostWindowMetrics 名称：`windowWidth`、`windowHeight`、`pixelRatio`、`screenWidth`、`screenHeight`、`statusBarHeight`、`screenTop`、`deviceOrientation`，以及可选的 `safeArea`。逻辑视口和屏幕尺寸必须为正数且需测量。物理纹理尺寸为四舍五入后的逻辑视口尺寸乘以 pixelRatio。一个待处理的
加载会等待有效的初始布局；插件不会虚构视口。移动视图直接从嵌入窗口获取其度量信息。

包路径是一个已验证的本地目录。Dart 包可能提供资源提取便利功能，但平台插件不会实现第二个包解析器、运行时、页面栈、持久化格式或定时器系统。

<a id="events-and-rendering"></a>
## 事件与渲染

每个事件都是 `{id: integer, event: {type: string, ...fields}}`。事件字段符合 SDK 合约（`ready`、`error`、`navigation`、`message`、`closed`、`hostCall`、`hostCallCancelled`、`storageFlushed` 以及内部帧元数据）。插件在丢弃会话前会处理待定的刷新/关闭方法结果。原生宿主调用会转换为带可观察取消令牌的 Dart 类型调用；其异步结果通过 `completeHostCall` 返回。

Windows/Linux 的纹理回调仅读取一个不可变的已完成原生帧。它们会保留该帧，直到 Flutter 释放它，且从不访问会话。macOS 将 Metal 渲染结果转为基于 IOSurface 的 CVPixelBuffer。同一 Metal 队列上的完成缓冲区用于同步 Skia 工作；只有在该工作完成之后，插件才会将像素缓冲区发布给 Flutter。读取者会独立于下一帧、尺寸变更、视图解绑或会话关闭，保留已发布的缓冲区。GPU 故障将保留清理所有权，报告错误，并且永远不会发布不完整的缓冲区。
