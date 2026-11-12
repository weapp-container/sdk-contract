<a id="sdk-contract-v1"></a>
# SDK 合约 v1

**简体中文** · [English](CONTRACT.en.md)


SDK 源代码版本：`0.1.0-preview.5.3`（私有预览源代码）；C ABI 版本：`1`

[preview.5 源码新增内容](PREVIEW5.md) 定义了可选的完整主机布局、延迟导航、执行健康和可查询包尝试。它们保留了 ABI 1。该文档不是 preview.5 二进制发布或平台通过；现有版本/版本保持不变，直到另行发布。

平台适配器通过 `weapp_container_sdk.h` 调用独立授权的运行时。应用程序代码使用平台的带类型会话和视图 API。下面的 JSON 是内部适配器协议；应用程序不会构造运行时桥接信封。

<a id="session-and-scheduling"></a>
## 会话与调度

创建和运行一个会话时，Android 使用专用的 HandlerThread；Apple 适配器使用主线程。绝不在其他线程中从帧/纹理回调中调用会话。在原生命令返回后，再交付用户事件。独立于显示回调调度完成泵。应用前台生命周期和预览遮挡是独立的：生命周期隐藏会停止呈现和应用定时器，而预览遮挡会保持业务定时器运行。当操作系统允许执行时，HTTP、主机完成、取消、超时和持久性将继续。

每个视图附件是独占的。断开连接会保留会话。在加载替换组件或关闭前，必须先停止渲染并断开原生GPU上下文。无论替换是否成功，都应重新连接：失败的候选者会保留之前的运行时。候选者存储、请求和消息在启动和帧准备成功前保持私有。

主机拥有稳定的 `storageKey` 并提供应用数据 `storageRoot`。
故意省略两者会选择仅内存存储。一个持久化键只有一个写入者，包括在关闭期间，直到工作者释放其锁。重新加载会保持租约。不要从会话身份或包摘要中派生键。

<a id="internal-commands"></a>
## 内部命令

每个结果都是 `{ok:true,value:...}` 或 `{ok:false,error:{code,message}}`。
每次精确释放一个 C 结果缓冲区。即使操作没有返回应用程序值，也需检查结果。

| 命令 | 负载 / 结果 |
| --- | --- |
| `load` | `{packPath, route?, options?, initialHostChrome?}`；已验证的本地 pack 目录 |
| `classifyDevPack` | `{packPath}`；完整验证但不改变会话，返回 `{reloadKind:"inPlace"|"restart"}` |
| `applyDevPack` | `{packPath,route?,options?,initialHostChrome?}`；候选被接受后返回 `{reloadKind,state}`，不代表 GPU 已呈现 |
| `devState` | 只读 `{state,pages:[{id,route,data}]}` 检查 |
| `clearDevStorage` | 清除当前 wx 存储；适配器必须等待 `flushStorage`，确保持久化完成 |
| `registerHostMethod` | `{name}` 在第一次加载之前 |
| `completeHostCall` | `{callId,result}` or `{callId,error:{code,message,retryable}}` |
| `sendMessage` | `{message}` 中包含 JSON 数据 |
| `navigate` | `{route,query?,replace?}` |
| `back` | `{}` |
| `switchTab` | `{route}`；触发运行时的 `wx.switchTab` 语义 |
| `inspectPackChrome` | `{packPath,route?}`；验证所有数据块并解析静态主机Chrome，而不会创建来宾运行时 |
| `hostChrome` | `HostChromeGeometry` 模式 1；测量胶囊/内容矩形和单调布局修订 |
| `setPreviewOccluded` | `{occluded:boolean}`；独立于应用生命周期暂停预览输入/呈现 |
| `lifecycle` | `{event:"show"}` or `{event:"hide"}` |
| `input` | `{events:[...]}`，使用逻辑视口坐标 |
| `resize` | `{width,height}` 逻辑像素单位 |
| `windowMetrics` | `HostWindowMetrics`，包括真实像素比和安全区域 |
| `presented` | `{generation,revision}` 在绘制前捕获；承认在主机呈现成功后的确切原生GPU帧 |
| `pump` | `{}` 使用 SDK 时钟；适配器不能用 uptime 替代 Unix 纳秒 |
| `state` | 当前生成、路径、视口、前景、表面、`frameRevision`、`presentationRequired` 和 `inputEnabled` |
| `capabilities` | 构建功能、实际的GPU呈现状态、APIs和不支持的操作 |
| `takeEvents` | 从有界的事件队列中抽取事件；在执行命令和泵操作后调用 |
| `flushStorage` | 返回 `{pending:true,ticket}` 或 `{pending:false}` |
| `close` | 开始异步关闭；返回 `{pending:true,ticket}` 或 `{pending:false,status:"closed"}` |

观察公共API中的 `ready`、`navigation`、`chrome`、`message`、`error` 和 `closed`。
适配器还消费 `frame`、`hostCall`、`hostCallCancelled` 和 `storageFlushed`。
仅在匹配到 `storageFlushed` 事件时才解决刷新票据；仅在 `closed` 时才解决关闭操作，并传播其持久性错误。在关闭过程中持续泵送。
完成之后，在其拥有线程上销毁C句柄。同步的C关闭函数是一个最终的清理屏障，而不是面向UI的异步关闭API。

主机调用标识符中已经包含生成身份。它们是不可读的。最多只执行一次；在取消时将主机作业释放。延迟的或重复的原生完成无法在替换运行时中运行 JavaScript。不要在自己的事件分发中调用 FFI；将完成结果回传到会话队列。

<a id="development-reload-preview4"></a>
## 开发重载（preview.4）

要求 `capabilities.pack.devReload.protocolVersion == "1.0"` 和选定的
重载类型之前才发送开发命令。较旧的运行时会使用 `ERR_UNSUPPORTED_CAPABILITY` 拒绝未知命令；不得模拟成功。Dev Player 创建会话时设置 `gpuRequired:true`：缺少编译的原生 GPU 提供程序的运行时将拒绝创建该会话。省略 `gpuRequired` 保持现有 SDK 行为。此设置从未能证明一帧已被呈现。

`devDiagnostics:true` 显式启用有界的开发控制台诊断。
它默认为 false，并不会改变普通生产会话的追踪。
适配器通过其现有的所有者线程事件流转发诊断事件。

分类与模拟器共享。一个完全验证的 WXML/WXSS/静态资源编辑可以保留实时会话、页面数据、页面栈、存储和定时器。候选视图/布局准备在通过审核前运行。JS/模块、配置、依赖、组件图或不安全的组件/WXS变更将重启会话。重启会保留持久化存储，并在仍可用时尝试当前路由。重启时分离 GPU 表面；在原地编辑时不要分离。适配器在运行时所有者线程上序列化 classify/apply，并在重启成功或失败后重新附加。

包验证和预接受启动失败会留下已接受的包。一旦接受了新的运行时/帧，后续的GPU故障被视为呈现故障：暂停输入并重试，或明确重新加载之前的包。重新加载之前的包无法恢复其旧的JS堆。`clearDevStorage` 会清除 wx 存储，而不是已下载的包或当前页面数据。

可选的 `weapp_container_sdk_gl.h` 扩展提供了用于桌面 OpenGL 3.3 的主机拥有的 GL 函数解析器。原始的 GLES ABI 头文件保持不变。在当前所拥有的上下文中解析函数；从不共享该上下文，也不在屏障/完成回调中调用 FFI。

<a id="presentation"></a>
## 呈现

使用 SDK `frameRevision` 而非应用帧 ID 来检测重绘：滚动重绘可能故意保留应用帧 ID。提交操作会准备经过验证的原生绘制资源，而无需 CPU 页面回读。GLES 和 Metal 直接绘制到主机目标。CPU 绘制器获取一个不可变的引用计数 RGBA8 帧；像素值已预乘，物理尺寸为逻辑视口乘以像素比例。

当 `state.presentationRequired` 为 true 时，准备帧或成功调用 GLES/Metal 绘图入口点并不会将其呈现。在表面附加和绘制之前，读取 `generation` 和 `frameRevision`；只有在成功完成 EGL 交换、完成 Metal 可绘制对象呈现，或等效的可信主机呈现确认之后，才使用捕获的标识调用 `presented`。在会话拥有线程上执行确认，绝不在 GPU 回调中执行。该命令返回当前状态，并可释放接受新帧的 `onReady` 效果。单独安排该新版本；绝不要用最新状态重新标记较早的确认。在调整大小、重新加载、分离或重新附加之后的延迟确认将返回 `ERR_CANCELLED`，且不会污染当前会话。每次附加都会准备一个全新的版本，包括在替换失败后重新附加的情况，因此旧表面的确认无法启用其后继者。

`state.inputEnabled` 标识当前已接受的帧是否已通过运行时呈现边界。未呈现的原生 GPU 帧的输入将被拒绝。SDK 的 `ready` 会报告一个已提交的包；这并不能证明主机表面已将其呈现。当 `presentationRequired` 为 false 时，运行时使用其同步光栅边界；CPU 平台的呈现器仍需单独跟踪成功的原生绘制，并且不得声称已获得 GPU 附件或接收确认。

GLES attach/present/detach 需要拥有者的当前上下文。上下文丢失使用 abandon。SDK 清理不得终止与主机渲染共享的显示。Metal 目标必须是同设备、BGRA8Unorm、2D、采样数为一、渲染目标使用、非仅帧缓冲区且尺寸必须与声明的尺寸完全一致。在 GPU 完成前保留纹理。Flutter 在同一队列上使用完成屏障发布已完成的 IOSurface/CVPixelBuffer；纹理回调仅保留已完成的帧。

帧句柄的生命周期长于会话，并且可能跨越线程，具有独立的保留引用。帧所有权永远不会跨越 Dart 或 React Native JSON 通道。

<a id="mini-program-api"></a>
## 小程序 API

包括 `types/weapp-container.d.ts`。`weappContainer.invoke()` 返回一个 Promise；`postMessage`、`onMessage` 和 `offMessage` 提供双向的 JSON 消息。`wx.request` 执行真正的异步 HTTP(S)，支持 JSON/text/ArrayBuffer，超时和中止。上传、下载和 WebSocket 不是预览功能。


<a id="native-host-chrome-preview4"></a>
## 原生宿主 chrome（preview.4）

协商 `capabilities.chrome.protocolVersion == "1.0"` 加上 `geometry`、`inspectPack` 和 `occlusion` 之后，再启用 Player shell。这些新增功能使用 ABI 1；旧版运行时必须在能力协商中失败，绝不能猜测坐标。

`inspectPackChrome` 从经过 SHA-256 验证的 JSON 模块（或旧版资源）中解析配置。它不会执行应用/页面代码、获取存储或附加 GPU。解析初始导航布局，测量实际内容区域，提供原生的 `windowMetrics` 和 `hostChrome`，然后执行 `load` 操作。`windowMetrics` 也可以在加载前提供；它始终是视口/显示更新的唯一边界。内容矩形的尺寸必须与初始窗口度量一致。

`state.chrome` 和 `{type:"chrome",generation,chrome}` 事件包含声明中定义的 `PageChrome` 观察。应用窗口的默认设置、页面覆盖以及每页动态标题/颜色有一个统一的运行时解析器。快照包含实际的运行时页面栈和配置的系统标签栏；`custom:true` 标签栏保持为应用组件，永远不会是一个假的原生栏。Chrome 版本独立于内容帧版本：更改标题或颜色不会重新评估视图脚本，也不会证明出现了新的 GPU 帧。标签图标是包资源引用，而不是任意的主机文件访问。

`hostChrome` 使用实际的当前屏幕逻辑像素矩形，而不是设备像素。`contentRect` 不会重新解释 `screenTop` 或 `safeArea`，其原点从未被用作第二个输入坐标变换。原生输入始终相对于测量的内容表面。运行时通过 `wx.getMenuButtonBoundingClientRect` 返回测量的胶囊。重复使用完全相同的观察结果是幂等的；观察值的变更需要更大的版本更新。可选的会话/页面绑定会拒绝已退役所有者的更新。无效的更新保持之前的主机几何结构不变。在实时缩放过程中，当内容尺寸与最新的原生视口观察值不同时，输入和呈现收据保持禁用状态。

Occlusion 会撤消当前的输入/呈现权限并取消活动联系。它不会调用应用程序的隐藏/显示钩子，不会停止业务定时器，不会替换会话或清除存储。解遮蔽会提交一个全新的渲染版本；在 GPU 模式下，再次需要有效的呈现确认。在被遮蔽期间持续运行。下载不可变更新可能继续，但玩家会推迟候选激活，直到其预览可见为止。


`capabilities.chrome.transactionalRestart:true` 协商替换布局
staging。重启可能携带顶层 `initialHostChrome`，在调用前将其测量并转换为实际屏幕逻辑坐标。其可选的所有者绑定指向旧的已接受会话/页面。只有新的隔离候选者在 `App.onLaunch` / `Page.onLoad` 之前接收其视口和胶囊几何体；启动失败将保留之前的配置、几何体和实例。
`initialHostChrome` 对于原地更新会被拒绝。

成功后，`state.hostChrome` 会被重新绑定到新的拥有者。原生表面可能仍保留其之前的物理尺寸：`state.chromeGeometryReady` 直到原生 `windowMetrics` 观察值与新内容尺寸匹配时才变为 true。绘制/呈现/输入必须等待该标志和正常的呈现确认。在阶段期间的旧尺寸观察无法将新会话回退到旧尺寸。原生包装器的仅变换 `prepareHostChrome` 必须使用 Flutter 根到屏幕的变换，而不是将预期矩形对齐到旧内容视图的原点；准备过程永远不会修改已接受的运行时。


<a id="宿主布局扩展--host-layout-extension"></a>
<a id="host-layout-extension"></a>
## 宿主布局扩展

`HostWindowMetrics.hostLayout` 是可选的 version-1 容器扩展，与完整窗口快照原子提交。
`safeInsets`、`reservedRegions` 均位于当前渲染 View 的局部逻辑坐标系；`verticalBarEdge`
使用已解析的物理 `left/right/none`。保留区域仅包含有效遮挡与折叠分隔，系统 margins 已计入框。
画布覆盖完整 View，内容与控件独立避让；原有 `safeArea` 的屏幕固定坐标语义不变。
省略扩展会清除旧布局。布局字段、保留区域或侧栏发生变化时，即使窗口宽高相同也会撤销旧输入及呈现回执；
新的对应画面确认后才能继续交互。

页面使用 `wx.getWindowInfo().hostLayout` 读取已提交值，并显式声明和订阅
`wx.onHostLayoutChange(listener)` / `wx.offHostLayoutChange(listener)`。
通知为 `{ hostLayout }`，清除时为 `null`；仅布局变化不触发尺寸事件 `onResize`。
