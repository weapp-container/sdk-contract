<a id="开发播放器协议新增功能预览版5-源码"></a>
# Dev Player protocol additions (preview.5 source)

[简体中文](PREVIEW5.md) · **English**


These are additive JSON adapter protocols over **C ABI 1**. Preview.5 is not
published by this document. The committed package version and runtime pins keep
their current release identity until separately built, validated and released.
The original guest `weappContainer` messaging API is unchanged. Types live in
`types/weapp-container.d.ts`; they do not add host commands to guest JavaScript.

<a id="完整的原生布局"></a>
## Complete native layout

Create with `hostLayout:{protocolVersion:"1.0",atomic:true}`. Require
`capabilities.chrome.atomicLayout` protocol `1.0`, `enabled:true`, `initialLayout`
and `sdkObservationIdentity` before using this path. An absent capability is an
unsupported combination, not permission to approximate geometry. Omitting the
configuration preserves the legacy ABI 1 resize/windowMetrics/hostChrome path.
When atomic layout is enabled, those separate update commands are rejected.

| Command | Input | Successful value |
| --- | --- | --- |
| `hostSurface` | `{action:"attach"}` | SDK-issued `HostSurfaceIdentity` |
| `hostSurface` | `{action:"detach",ownerId,surfaceGeneration}` | current state |
| `observeHostLayout` | `{schemaVersion:1,ownerId,surfaceGeneration,windowMetrics}` | SDK-issued `HostLayoutObservation` |
| `hostLayout` | complete `HostLayout` | current state |
| `completeNavigationLayout` | `{ticket,layout:HostLayout}` | current state |
| `cancelNavigation` | `{ticket}` | current state |

Native observation and UI measurement are separate stages. Observation records
the real attached surface dimensions and retires its input/presentation proof;
it does not publish new `wx` environment values. Measure the actual shell and
submit the entire `HostLayout`, matching the observation's window metrics,
session/page bindings, owner and surface generation. The measured content size
must match the observed viewport. The complete environment is installed before
resize hooks. A pending observation expires after 15 seconds; reobserve and
remeasure rather than relabeling an old result. Runtime/bridge deadlines can
shorten guest execution independently of this UI preparation limit.

`ownerId`, `surfaceGeneration`, `observationId` and `layoutRevision` are canonical
positive decimal u64 strings. Do not cast them to JavaScript Number. The SDK
issues the first three; the host advances layout revision. Repeating an exact
accepted layout is idempotent. A stale owner, observation, page, surface or
changed layout with an old revision fails. A native callback cannot invent a
new observation identity. Preserve the existing safe-area/display observations;
screen chrome rectangles never become a second content input transform.

Initial load/restart supplies `initialHostLayout` from the measured, attached
candidate. It is mutually exclusive with legacy `initialHostChrome`, and only
enabled in atomic mode. Candidate View attachment must actually reach a native
window and report dimensions while interaction is disabled. Unmounting it or
waiting for load before attachment creates a measurement deadlock. Close retires
pending measurement ownership before awaiting candidate work. Once accepted,
layout owner bindings are rebound to the new runtime/page. Match native geometry
and wait for the normal exact GPU presentation receipt before enabling input.

<a id="预备重启测量预览版-52-适配器"></a>
### Prepared restart measurement (preview.5.2 adapters)

Player additionally requires the native adapter capability
`chrome.atomicLayout.preparedRestartMeasurement == "1.0"`. It is not implied by
ABI 1 or by core atomic-layout support. Older adapters explicitly fail negotiation.

Only the adapter's `prepareHostLayout` may carry `restartAttempt`:
`{schemaVersion:1,ownerId,attemptId,targetRoot,expectedAccepted}`. IDs remain exact
positive decimal strings; `expectedAccepted` must be explicitly present. The
adapter passively queries its own native journal, requiring a still-`prepared`
`load`/`applyDevPack` attempt classified as `restart`, with matching owner, target
root and acceptance CAS. It rechecks receipt and current state before returning.
`hostLayout` rejects this field, including null. This claim cannot commit layout,
acknowledge a frame or enable input.

A typed View-only fault may be measured for this verified restart while
AppService and navigation remain healthy, no navigation is pending, and native
input/presentation are disabled. Window metrics, actual native geometry,
surface generation, observation and accepted session/page must still match.
Ordinary navigation measurement keeps its existing health checks. Cancellation,
replacement, an expired receipt or a different native owner invalidates the claim.
The next accepted session still needs its own matching presentation receipt.

Journal queries in the mobile wrappers are passive: no native allocation,
event draining/replay, guest execution, renderer invalidation or presentation.
Native library producer `0.1.0-preview.5.1` is retained unchanged in the new
`0.1.0-preview.5.2` wrapper bundle; source and hashes identify each separately.

<a id="延迟导航"></a>
## Deferred navigation

Atomic mode emits `{type:"navigationLayout",request}` and exposes the same
request in `state.pendingNavigation`. A non-null `NavigationLayoutRequest`
contains an opaque ticket, session/root, target route, target chrome and an exact
Unix-nanosecond `deadlineNs` decimal string. Keep the deadline as a string
or parse it with arbitrary precision for timeout planning; JSON numbers cannot
represent its full precision. It is not a session or layout identity.
Measure the destination shell and submit
`completeNavigationLayout` with a newly observed complete layout. The navigation
queue preserves request ordering. No engine turn remains open while UI measures.

Before commit, changed source owner/root, timeout, cancellation or validation
failure rejects the request without publishing the destination environment.
Once commit/lifecycle effects begin, failures can be irreversible. They produce
a sticky navigation fault containing phase, actual committed stack/layout and
the original cause. Do not infer rollback, replay lifecycle, or rewrite accepted
state. Restart through a new validated candidate. Stale/duplicate tickets cannot
complete another navigation. A loaded/rendered response does not acknowledge
native presentation.

`presented` retains its existing `generation`/`revision` capture and additionally
carries the accepted layout's `ownerId`, `surfaceGeneration`, `observationId` and
`layoutRevision` in atomic mode. Capture before drawing; acknowledge only the
exact completed native frame. Input and presentation remain disabled while
measurement, navigation or execution faults make the shown picture ineligible.

<a id="尝试打包和响应丢失"></a>
## Pack attempts and response loss

Require `capabilities.pack.devReload.attemptJournal.protocolVersion == "1.0"`,
`terminalRetention:64` and `acceptedIdentity:true`. `acceptedPackIdentity`
returns null for an empty owner or `{root,acceptedPackRevision,sessionId}`.
Pack acceptance revision is separate from frame revision: business timers,
scrolling and resize can change a frame without changing the accepted pack.

1. `beginDevPackAttempt` accepts `{operation:"load"|"applyDevPack",packPath,
   expectedAccepted,route?,options?}`. `expectedAccepted` is required, explicitly
   null only for an empty owner. The SDK verifies the pack and issues an
   owner-scoped attempt ID and a `prepared` receipt.
2. `applyDevPackAttempt` accepts `{ownerId,attemptId,expectedAccepted,
   initialHostLayout?}`. Apply rechecks the acceptance CAS and target root.
   The exact apply payload binds that attempt. A conflicting reuse fails.
3. Query with `queryDevPackAttempt({ownerId,attemptId})` after response loss.
   Retained results are the receipt itself, with status `prepared`, `applying`,
   `accepted`, `rejected` or `cancelled`. Terminal receipts carry authoritative
   accepted identity and, when available, state/error. `devPackAttempt` events
   are notifications; they are not the only way to learn the result.
   `state` is optional even for `accepted`: `observationErrors`, when present,
   records `{phase:"state"|"postCommit",error}` separately from the execution
   result. An observer failure after publication cannot change `accepted` to
   `rejected`, lose the terminal receipt, or replay startup on a duplicate apply.
4. A missing result is `{schemaVersion:1,ownerId,attemptId,status,
   acceptedPackIdentity}`. `notRetained` means an issued receipt was evicted;
   `notSeen` means that owner has never issued the ID. Foreign owners and
   malformed IDs are errors. Missing receipt observations run no guest code.

The journal retains at most 64 terminal receipts and up to 256 prepared/applying
attempts. Its high watermark prevents evicted IDs from executing again. Applying
or cancelling an expired/unissued ID fails. `cancelDevPackAttempt` only cancels a
still-prepared attempt; it cannot reverse an applied commit. A caller timeout is
not cancellation and is not evidence of acceptance or rollback. Do not launch
a second storage writer to guess the result. After retention loss, inspect the
authoritative accepted identity and reconcile explicitly; an old ID is never a
new operation. Existing `load`/`applyDevPack` remain available to legacy callers.
Cancelled prepared attempts record the current accepted identity at cancellation.
Every retained terminal receipt is immutable; later queries or duplicate applies
return the original receipt even if the current session has changed or closed.

<a id="执行健康状况和测量工作量"></a>
## Execution health and measured work

`state.executionHealth` is a passive schema 1 observation with independent
`appServiceFault`, `viewFault`, `navigationFault` and `requiresRestart`. Faults
carry their original typed code/message, source-mapped View stack where available
and navigation transaction details. An interrupted View realm revokes input,
ACK, geometry and retained-frame authority while diagnostic pixels may remain.
Do not reset that realm in place, deliver synthetic touchcancel against its
failed graph, send `onHide`, or disable a healthy AppService's business timers.
The next accepted pack must create a new session even for an unchanged pack.

`executionHealth`, `navigationLayout`, `hostLayoutObservation`,
`hostLayoutAccepted`, `hostLayoutError` and `devPackAttempt` use the ordinary
bounded SDK event queue. Query current state/attempt after notification loss.

`state.viewExecutionMetrics` measures the latest preparation, render frontier
and scope release. It reports validation/encoding, provider and receipt stages,
success and immutable-cache hits. Preparation's `providerInitializationNs`
measures realm construction and bootstrap together; `validationEncodingNs`
excludes that cold initialization cost. Optional `providerStages` records measured
batch count and input encoding, VM input parsing, execution including lazy
compilation, VM output encoding and output decoding in nanoseconds. It is null
when no provider measurement is available. Native providers report `compileNs`
as null because lazy compilation and execution share a VM call; modern reply
encoding inside guest JS remains in execution time. `vmOutputEncodeNs` measures
only the intrinsic/string-copy boundary. Do not invent a separate compile or
transport cost from these totals. Timings are observations, not identity
tokens or a performance pass. Verified program cache reuse binds the full
manifest value and a retained immutable resource lease; source document encoding
reuse requires exact source equality. Stateful View functions still execute on
every submitted frontier. The default 50 ms View budget and shorter shared
outer deadlines remain in force.

<a id="验证和兼容性边界"></a>
## Validation and compatibility boundary

`node --test test/*.test.mjs` parses declarations with Node 24. When a TypeScript
compiler is installed, the additional semantic fixture checks exact string
identities, complete layouts and required CAS; it includes negative assignments
that must fail type checking. Without that optional compiler, that semantic
check is explicitly skipped. Tests use no private binary, source or network.

Passing declarations and local runtime tests does not establish platform GPU,
window, foldable/tablet, physical-device or performance acceptance. Native
adapters must propagate all negotiated fields and events, keep measurement
waits bounded/cancellable, and preserve actual owner/surface lifecycle. A runtime
remaining on preview.4 pins cannot be described as preview.5 validated merely
because the wrapper source declares these additions.

<a id="可选的-quickjs-输出清理诊断分解"></a>
### Optional QuickJS output/cleanup diagnostic breakdown

`providerStages.lastBatchBreakdown` is an independent closed schema 1. Its
engine/profile/operation/thread/sequence must match the adjacent `lastBatch`;
these identities do not establish a process epoch or a Player event causal join.
V8 and disabled/unsupported observation omit this optional field. Consumers may
also treat null as unavailable; neither representation reports measured zeros.

The fixed phases are `contextCall`, `jsonStringifyApi`, `utf8CopyApi`,
`finalDeadlineCheck` and `poisonDrop`. A null phase means it was not attempted,
is not applicable or has no supported measurement. A present phase's
`completed` means the wrapped API returned without an error, not that it met
the deadline or produced an accepted frame. Failed API returns still have
measurements. Each clock is an unsigned decimal u64 string or null; missing or
regressing clock pairs produce null elapsed values, never fabricated zeros.
`outputBytes` is the actual successfully extracted UTF-8 length or null.

The JSON stage includes QuickJS's public intrinsic wrapper and its input Value
release; it is not pure C serializer CPU. The UTF-8 stage includes conversion,
UTF-8 validation, Rust allocation/copy and native string release. Modern View's
private JSON writer remains in execution; its native JSON stage is null.
`contextCall` is a nested aggregate including runtime-lock acquisition, parse,
execution, output, native error mapping and local/guard destruction. Never sum
it with its contained stages or attribute residual wall time to GC or scheduling
without independent evidence. Poison drop contains Context/Runtime destruction,
including QuickJS's shutdown GC; it does not prove how much time GC consumed.

The existing `vmOutputEncodeNs` aggregate and closed `lastBatch` schema remain
unchanged. Raw stage samples allocate nothing and make no guest calls; wire
formatting happens only after the existing final deadline check and any poison
drop, retaining the original post-check destruction and formatting order. The
50 ms/shorter outer deadline policy is unchanged; these measurements do not add
budget or prove that diagnostic overhead fits within it.
This observation does not modify errors, cancellation, realm lifetime, result
caching or health decisions. Successful API measurements can accompany a final
timeout. These diagnostics alone are not a performance pass.
