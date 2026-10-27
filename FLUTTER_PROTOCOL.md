# Flutter plugin transport, preview 1

This is an internal contract shared by the five federated implementations.
Application code uses the typed Dart controller, widget, events and host calls.
No image bytes, Rust pointers or serialized bridge envelopes cross this channel.

## Engine and ownership

- Method channel: `dev.weapp.container/methods`.
- Event channel: `dev.weapp.container/events`.
- Linux encodes each method-argument map, successful non-null result and event
  as UTF-8 JSON in a `Uint8List` StandardMessageCodec value. This avoids the
  Linux embedder's NUL-terminated `FlValue` strings truncating JSON payloads.
  A void result can be native null or encoded JSON null. Method names and
  platform error code/message keep their standard channel representation.
  Other platforms use the ordinary structured StandardMessageCodec values.
- Mobile platform view type: `dev.weapp.container/view`, creation parameters
  `{id: integer}`. Android explicitly uses Hybrid Composition; iOS uses UiKitView.
- One native registry belongs to one Flutter engine. Session IDs monotonically
  increase within that registry. One session has at most one attached view or
  texture. Detached sessions remain available until explicit close.
- Before creating a session, Dart subscribes to events and calls
  `initialize({clientEpoch: string})`. A new Dart runtime generates a new epoch;
  a changed epoch drains/closes the previous runtime's sessions, flushes their
  storage and unregisters their textures before initialization completes.
  Repeating the same epoch is idempotent. Hot reload preserves the epoch.
- Engine detachment also cleans up its registry. Results for retired IDs or
  epochs cannot affect a new session. No operation enters Rust from a raster
  callback, a host callback or a background completion thread.
- Native callbacks are dispatched after runtime operations return. The native
  runtime owner thread handles commands, pumping and completion delivery.
  Android uses its SDK HandlerThread and marshals Flutter callbacks to the main
  thread; Apple and desktop plugins follow their native SDK thread contract.
  Completion pumping continues while rendering is hidden, subject to OS limits.

## Methods

All methods return an asynchronous platform result. Failures use the SDK error
code as the platform error code and preserve the message. Operations returning
no value return `null`. All methods except `initialize` and `create` require `id`.

| Method | Arguments beyond `id` | Result |
| --- | --- | --- |
| `initialize` | `clientEpoch` | `null` after retiring the previous epoch |
| `create` | `storageKey` (string; null explicitly selects memory), optional `sessionId` | `{id}` |
| `registerHostMethod` | `name` | `null`; before first load |
| `load` | `packPath`, optional `route`, `options` (map) | `null` after candidate activation |
| `navigate` | `route`, `query` (map), `replace` (bool) | `null` |
| `back` | none | `null` |
| `sendMessage` | `message` (JSON value) | `null` |
| `setForeground` | `foreground` (bool) | `null` |
| `flushStorage` | none | `null` after durable persistence |
| `close` | none | `null` after GPU/resource retirement and persistence; idempotent |
| `state` | none | native state map |
| `capabilities` | none | actual native capability map |
| `completeHostCall` | `callId`, exactly one of `result` or `error` | `null` |
| `attach` | complete initial metrics below | `{textureId}`; desktop only |
| `resize` | complete metrics below | `null`; desktop only |
| `detachView` | none | `null` after confirmed native View retirement; mobile only; used by widget disposal |
| `detach` | none | `null` after retiring the texture; desktop only |
| `input` | `events` (list of SDK input maps) | `null`; desktop only |

The host-call error shape is `{code, message, retryable}` using the shared
provider error codes. The native session validates generation and call identity;
the plugin never revives or retries a stale completion.

Desktop metrics use the shared flat HostWindowMetrics names: `windowWidth`,
`windowHeight`, `pixelRatio`, `screenWidth`, `screenHeight`, `statusBarHeight`,
`screenTop`, `deviceOrientation`, and optional `safeArea`. Logical viewport and
screen dimensions must be positive and measured. Physical texture dimensions
are the rounded logical viewport dimensions multiplied by pixelRatio. A pending
load waits for valid initial layout; plugins do not substitute an invented
viewport. Mobile views obtain their metrics directly from the embedding window.

The pack path is a verified local directory. The Dart package may offer asset
extraction convenience, but platform plugins do not implement a second pack
parser, runtime, page stack, persistence format or timer system.

## Events and rendering

Every event is `{id: integer, event: {type: string, ...fields}}`. Event fields
match the SDK contract (`ready`, `error`, `navigation`, `message`, `closed`,
`hostCall`, `hostCallCancelled`, `storageFlushed` and internal frame metadata).
The plugin settles pending flush/close method results before discarding their
session. A native host call becomes a typed Dart call with an observable
cancellation token; its asynchronous result returns through `completeHostCall`.

Windows/Linux texture callbacks only read an immutable completed native frame.
They retain the frame until Flutter releases it and never access the session.
macOS renders Metal into an IOSurface-backed CVPixelBuffer. A completion buffer
on the same Metal queue fences Skia work; only then does the plugin publish the
pixel buffer to Flutter. Readers retain published buffers independently of the
next frame, resize, view detachment or session shutdown. GPU failure retains
cleanup ownership, reports an error and never publishes an unfinished buffer.
