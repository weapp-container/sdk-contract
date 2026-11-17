<a id="dev-player-protocol-additions-preview5-source"></a>
# 开发播放器协议新增功能（预览版.5 源码）

**简体中文** · [English](PREVIEW5.en.md)


这些是基于 **C ABI 1** 的附加 JSON 适配器协议。Preview.5 未在本文件中发布。已提交的包版本和运行时版本保持其当前发布身份，直到单独构建、验证并发布为止。原始宿主 `weappContainer` 消息 API 保持不变。类型定义位于 `types/weapp-container.d.ts`；它们不会向宿主 JavaScript 添加命令。

<a id="complete-native-layout"></a>
## 完整的原生布局

使用 `hostLayout:{protocolVersion:"1.0",atomic:true}` 创建。在使用此路径之前，需要 `capabilities.chrome.atomicLayout` 协议 `1.0`，`enabled:true`，`initialLayout` 和 `sdkObservationIdentity`。缺少该能力表示不支持的组合，无法近似几何形状。省略配置将保留旧的 ABI 1 resize/windowMetrics/hostChrome 路径。当启用原子布局时，将拒绝那些独立的更新命令。

| 命令 | 输入 | 成功值 |
| --- | --- | --- |
| `hostSurface` | `{action:"attach"}` | SDK 发出的 `HostSurfaceIdentity` |
| `hostSurface` | `{action:"detach",ownerId,surfaceGeneration}` | 当前状态 |
| `observeHostLayout` | `{schemaVersion:1,ownerId,surfaceGeneration,windowMetrics}` | SDK 发出的 `HostLayoutObservation` |
| `hostLayout` | 完整的 `HostLayout` | 当前状态 |
| `completeNavigationLayout` | `{ticket,layout:HostLayout}` | 当前状态 |
| `cancelNavigation` | `{ticket}` | 当前状态 |

原生观察和 UI 测量是两个独立的阶段。观察记录实际附加的绘制表面尺寸，并撤回其输入/呈现证明；它不会发布新的 `wx` 环境值。测量实际壳层，并提交整个 `HostLayout`，其窗口指标与观察的窗口指标匹配，页面/会话绑定、所有者和绘制表面生成情况也需匹配。测量内容尺寸必须与观察到的视口尺寸一致。完整的环境在调整大小钩子之前安装。一个待定的观察在 15 秒后过期；应重新观察和重新测量，而不是重用旧结果。运行时/桥接的截止时间可以独立于此 UI 准备限制，缩短客体执行时间。

`ownerId`、`surfaceGeneration`、`observationId` 和 `layoutRevision` 是规范的正小数 u64 字符串。不要将它们转换为 JavaScript 数字。SDK 发出前三个值；宿主负责提升布局版本。重复一个已验收的布局是幂等的。过期的 owner、observation、page、surface 或旧版本的布局会失败。原生回调不能创建新的 observation  identity。保留现有的安全区域/显示观察值；屏幕边框矩形永远不会变成第二个内容输入变换。

初始加载/重启从测量并附加的候选者中提供 `initialHostLayout`。它与旧版 `initialHostChrome` 互斥，并且仅在原子模式下启用。候选视图的附加必须真正到达原生窗口并报告尺寸，同时在交互被禁用时完成。卸载它或在附加前等待加载会导致测量死锁。关闭操作会在等待候选工作之前放弃待定的测量所有权。一旦被接受，布局所有者的绑定将重新绑定到新的运行时/页面。匹配原生几何形状，并等待正常的精确 GPU 渲染回执后，才启用输入。

<a id="prepared-restart-measurement-preview52-adapters"></a>
### 预备重启测量（预览版 5.2 适配器）

玩家还要求原生适配器能力
`chrome.atomicLayout.preparedRestartMeasurement == "1.0"`。它既不包含在 ABI 1 中，也不包含在核心原子化布局支持中。较旧的适配器会明确拒绝协商。

只有适配器的 `prepareHostLayout` 可以携带 `restartAttempt`：
`{schemaVersion:1,ownerId,attemptId,targetRoot,expectedAccepted}`。IDs 保持精确的正小数字符串；`expectedAccepted` 必须显式存在。适配器被动查询其自身的原生日志，需要一个仍处于 `prepared` 状态的 `load`/`applyDevPack` 尝试被分类为 `restart`，且拥有匹配的 owner、target root 和验收 CAS。在返回前会重新检查回执和当前状态。`hostLayout` 会拒绝该字段，包括空值。此声明无法提交布局、确认帧或启用输入。

一个仅查看类型的故障可能在此已验证重启期间进行测量，
当 AppService 和导航保持健康，没有待处理导航，且原生输入/呈现被禁用时，
窗口指标、实际原生几何形状、绘制表面生成、观察和已验收的会话/页面仍必须匹配。
普通导航测量保留其原有的健康检查。
取消、替换、过期的回执或不同的原生拥有者将使该声明无效。
下一个已验收的会话仍需其自身的匹配呈现回执。

移动包装器中的日志查询是被动的：没有原生分配、事件消耗/重放、客体执行、渲染器无效化或呈现操作。新版本 `0.1.0-preview.5.2` 包装器捆绑体中保留了原生库生产者 `0.1.0-preview.5.1`，源代码和哈希值分别标识了各自的身份。

<a id="deferred-navigation"></a>
## 延迟导航

原子模式会发出 `{type:"navigationLayout",request}`，并在 `state.pendingNavigation` 中暴露相同的请求。非空的 `NavigationLayoutRequest` 包含一个不可读的票据、会话/根节点、目标路由、目标chrome以及一个精确的Unix纳秒 `deadlineNs` 十进制字符串。保持截止时间作为字符串，或使用任意精度进行解析以规划超时；JSON数字无法表示其完整精度。它不是会话或布局的标识。测量目标shell，并提交包含新观察到的完整布局的 `completeNavigationLayout`。导航队列保持请求的顺序。在UI进行测量时，不会保留任何引擎轮询。

提交前，若源所有者/根节点、超时、取消或验证失败，将拒绝请求且不发布目标环境。
一旦提交/生命周期效果开始，失败可能不可逆。它们会产生一个粘性导航故障，包含阶段、实际提交的堆栈/布局以及原始原因。不要推断回滚、重放生命周期或重写已验收状态。需通过新的有效候选方案重新启动。过期/重复的票据无法完成另一次导航。已加载/渲染的响应不会确认原生呈现。

`presented` 保留其现有的 `generation`/`revision` 捕获，并额外携带已验收布局的 `ownerId`、`surfaceGeneration`、`observationId` 和 `layoutRevision`，以原子模式进行。绘制前进行捕获；仅确认完成的原始帧。在测量、导航或执行出错时，使显示的画面无效，输入和呈现操作保持禁用。

<a id="pack-attempts-and-response-loss"></a>
## 尝试打包和响应丢失

要求 `capabilities.pack.devReload.attemptJournal.protocolVersion == "1.0"`，
`terminalRetention:64` 和 `acceptedIdentity:true`。`acceptedPackIdentity`
对于空的拥有者返回 null，或 `{root,acceptedPackRevision,sessionId}`。
包验收修订版本与帧修订版本是分开的：业务定时器、滚动和调整大小可以改变帧而不会改变已验收的包。

1. `beginDevPackAttempt` 接受 `{operation:"load"|"applyDevPack",packPath,
   expectedAccepted,route?,options?}`。`expectedAccepted` 是必需的，仅在拥有者为空时明确为 null。SDK 会验证包并生成一个作用域为拥有者的尝试 ID 和一个 `prepared` 状态的回执。
2. `applyDevPackAttempt` 接受 `{ownerId,attemptId,expectedAccepted,
   initialHostLayout?}`。应用操作会重新检查接受的 CAS 和目标根。确切的应用负载会绑定该尝试。存在冲突的重用将失败。
3. 在响应丢失后，通过 `queryDevPackAttempt({ownerId,attemptId})` 查询。保留的结果是回执本身，状态为 `prepared`、`applying`、`accepted`、`rejected` 或 `cancelled`。最终回执携带权威的接受身份，以及在可用时携带状态或错误信息。`devPackAttempt` 事件是通知；它们不是获取结果的唯一方式。`state` 即使在 `accepted` 情况下也是可选的：当存在时，`observationErrors` 会分别记录 `{phase:"state"|"postCommit",error}`，与执行结果分开。发布后观察者失败无法将 `accepted` 变为 `rejected`，无法丢失最终回执，也无法在重复应用时重放启动。
4. 缺失结果为 `{schemaVersion:1,ownerId,attemptId,status,
   acceptedPackIdentity}`。`notRetained` 表示已发出的回执被驱逐；`notSeen` 表示该拥有者从未发出该 ID。外部拥有者和格式错误的 ID 都是错误。缺失回执观察不会运行任何来宾代码。

日志最多保留 64 个终端回执和最多 256 个已准备/应用尝试。其高水位线防止被驱逐的 ID 再次执行。对过期或未发出的 ID 执行应用或取消操作将失败。`cancelDevPackAttempt` 仅能取消仍处于准备状态的尝试；无法撤销已应用的提交。调用超时不是取消操作，也不是验收或回滚的证据。不要启动第二个存储写入器来猜测结果。在丢失保留后，需检查权威的已验收身份并显式进行一致性处理；旧的 ID 从来不是新的操作。现有的 `load`/`applyDevPack` 仍可供旧版调用者使用。被取消的准备尝试将在取消时记录当前已验收的身份。每个保留的终端回执都是不可变的；后续查询或重复应用即使当前会话已更改或已关闭，仍会返回原始回执。

<a id="execution-health-and-measured-work"></a>
## 执行健康状况和测量工作量

`state.executionHealth` 是一个被动的 schema 1 观察值，具有独立的
`appServiceFault`、`viewFault`、`navigationFault` 和 `requiresRestart`。故障
携带其原始的类型/消息，以及可获取的视图堆栈的源映射信息和导航事务详情。一个中断的视图域会撤销输入、ACK、几何图形和保留帧的权限，而诊断像素可能仍保留。不要原地重置该域，在其失败的图上发送合成的 touchcancel，发送 `onHide`，或禁用健康 AppService 的业务定时器。下一次被接受的包即使内容未变也必须创建新的会话。

`executionHealth`、`navigationLayout`、`hostLayoutObservation`、`hostLayoutAccepted`、`hostLayoutError` 和 `devPackAttempt` 使用普通的有界 SDK 事件队列。通知丢失后，查询当前状态/尝试。

`state.viewExecutionMetrics` 计算最新的准备、渲染前沿和作用域释放。它报告验证/编码、提供者和回执阶段，以及成功和不可变缓存命中情况。准备阶段的 `providerInitializationNs` 测量领域构造和启动过程；`validationEncodingNs` 排除了冷启动初始化成本。可选的 `providerStages` 记录测量批次数和输入编码、VM输入解析、执行（包括懒加载编译）、VM输出编码和输出解码的纳秒级数据。当没有提供者测量数据时，该字段为 null。原生提供者将 `compileNs` 设为 null，因为懒加载编译和执行共享一次 VM 调用；现代回复编码在宿主 JS 中仍保留在执行时间。`vmOutputEncodeNs` 仅测量内建/字符串复制边界。不要从这些总和中臆造单独的编译或传输成本。这些时间是观测值，而非身份令牌或性能测试结果。已验证的程序缓存复用绑定完整清单值和保留的不可变资源租约；源文档编码复用要求源文档完全相等。状态化的 View 函数仍会在每次提交前沿时执行。默认 50 毫秒的 View 预算和更短的共享外层截止时间仍然有效。

<a id="validation-and-compatibility-boundary"></a>
## 验证和兼容性边界

`node --test test/*.test.mjs` 使用 Node 24 解析声明。当安装了 TypeScript 编译器时，额外的语义检查会精确匹配字符串身份、完整布局和必需的 CAS；它包含必须在类型检查中失败的负赋值。在没有该可选编译器的情况下，此语义检查会被明确跳过。测试不使用任何私有二进制文件、源代码或网络。

传递声明和本地运行时测试并不能确立平台 GPU、窗口、可折叠/平板、物理设备或性能验收。原生适配器必须传播所有协商的字段和事件，保持测量等待时间有界/可取消，并保留实际所有者/绘制表面的生命周期。仍停留在 preview.4 版本的运行时不能被描述为 preview.5 已验证，仅仅因为包装器源码声明了这些新增内容。

<a id="optional-quickjs-outputcleanup-diagnostic-breakdown"></a>
### 可选的 QuickJS 输出/清理诊断分解

`providerStages.lastBatchBreakdown` 是一个独立的闭合模式 1。其
引擎/配置/操作/线程/序列必须与相邻的 `lastBatch` 匹配；这些身份不建立进程纪元或玩家事件的因果关联。
V8 及已禁用/不支持的观察会省略此可选字段。消费者也可将 null 视为不可用；两种表示均不报告测量到的零值。

固定阶段为 `contextCall`、`jsonStringifyApi`、`utf8CopyApi`、`finalDeadlineCheck` 和 `poisonDrop`。空阶段表示该阶段未尝试、不适用或没有支持的测量。一个阶段的 `completed` 表示被包装的 API 返回时没有错误，并不表示该阶段满足截止时间或生成了验收的帧。失败的 API 返回仍然有测量值。每个时钟是一个无符号十进制 u64 字符串或 null；缺失或退化的时钟对会产生 null 的经过时间值，永远不会生成伪造的零值。`outputBytes` 是实际成功提取的 UTF-8 长度或 null。

JSON 阶段包括 QuickJS 的公共内建包装器及其输入值释放；它不是纯 C 序列化 CPU。UTF-8 阶段包括转换、UTF-8 验证、Rust 内存分配/复制和原生字符串释放。现代 View 的私有 JSON 写入器仍处于执行状态；其原生 JSON 阶段为空。
`contextCall` 是一个嵌套聚合，包含运行时锁获取、解析、执行、输出、原生错误映射以及本地/保护对象销毁。切勿将其与内部阶段相加，也切勿在没有独立证据的情况下将其残余耗时归因于 GC 或调度。Poison drop 包含 Context/运行时销毁，包括 QuickJS 的关闭 GC；它无法证明 GC 消耗了多少时间。

现有的 `vmOutputEncodeNs` 聚合和封闭的 `lastBatch` 模式保持不变。原始阶段样本不分配资源，也不调用虚拟机函数；仅在现有最终截止时间检查和任何毒化丢弃之后进行线缆格式化，保留原始检查后的销毁和格式化顺序。50 毫秒或更短的外部截止时间策略保持不变；这些测量不会增加预算，也无法证明诊断开销能容纳在其中。

此观察结果不会影响错误、取消、领域生命周期、结果缓存或健康决策。成功的 API 测量可以伴随最终超时。这些诊断本身并不能构成性能通过。
