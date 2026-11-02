# Host services 1.0 — preview.6.0

This extension adds JSON commands/events to C ABI 1. It requires newly matched
preview.6.0 runtime and wrapper artifacts. The historical runtime lock and ORIGIN
remain historical; they do not supply these capabilities. Require
`capabilities.hostServices.protocolVersion === "1.0"` before configuration.
An unknown command or unavailable capability is an error, never sandbox success.

`configureHostServices` binds a host-authenticated installation and host account
before guest startup. Content integrity is separate from publisher authentication.
`registerApiHandler` accepts only host-owned names from the locked 3.17.3 catalog;
`registerHostMethod` remains the application-specific business extension channel.
Navigation, layout and storage transaction ownership remain inside the runtime.

Each native call receives the accepted installation, principal/epoch, internal
session incarnation, native call ID, exact decimal deadline and cancellation token.
Transport IDs may differ from native call IDs; wrappers preserve the context.
Component contexts additionally contain a runtime-resolved `componentTarget`.
The guest cannot select another page/scope by providing a forged native node.

All u64 values are decimal strings in the public JSON transport. Do not coerce
epochs, deadlines, page IDs or sequences through JavaScript number.
`HostApiFailure.details` carries original public `errCode`, `errMsg` and extensions;
it must contain no host bearer, private file path or merchant secret.

Synchronous snapshots, synchronous local operations, asynchronous calls, tasks,
subscriptions and long-lived objects have distinct execution contracts. A sync
operation cannot wait for native UI or return success before durable work ends.
Native FileSystemManager sync operations use a separately bound local provider;
unbound sync methods fail. Browser async persistence does not advertise sync writes.

Events and binary handles are owned by session/epoch. Producers enqueue bounded
messages; only the runtime's owning thread enters JS. Sequence numbers suppress
stale deliveries. Overload closes lossless producers or coalesces latest-value
streams. Binary references transfer one retain on accepted materialization and
consume none on validation failure; release, expiry and revocation invalidate them.
Callback, complete and Promise settle once, including abort and terminal events.

`switchAccount` first advances the shared epoch and blocks every associated owner.
It stops devices/subscriptions/network work, drains GPU ownership, flushes storage,
releases locks, then constructs a fresh owner with new host-provided launch data.
The public controller stays stable. New page/query/JS state is not inherited.
Only successful new presentation restores input. A failed switch stays blocked;
query/cancel/close/recovery remain available. The latest epoch supersedes older work.

`acknowledgeAccountCleanup` requires the exact current operation and detached old
surface. Toolkits await custom asynchronous cleanup before ACK; a failure requires
explicit retry. `prepareAccountHostServiceSnapshots` accepts only that current
unacknowledged operation so new modules can synchronously read fresh identity.
Closing also awaits custom resources; failed close remains blocked and retryable.

`managedFileScope` is native-only and returns the core-held file lease, user root,
auxiliary native root and scope ID. Its namespace excludes version and epoch and
includes host/tenant, app/environment and principal. Private host paths never enter
guest JS. A common OS lock serializes sync/async file transactions. Deletion needs
all old owners to release principal/scope locks and additionally requires backend
grant revocation. Legacy storage imports require an explicit migration command.

Identity snapshots use `{hostLoggedIn, appLoggedIn, profileAuthorized,
phoneAuthorized}`; onChange uses the same schema. Host login does not grant profile
or phone consent. `wx.login` returns an app-specific one-use code for that app's
confidential backend. Reference IDs are not WeChat openid/session_key. Phone access
uses the real button authorization event; there is no invented wx.getPhoneNumber.
Application logout revokes only that app and rebuilds all its owners.

Payment requests should use `weappContainer.payment.request({orderId})`. The host
fetches a trusted launch bound to app/principal/epoch/idempotency, then selects an
explicitly configured channel. WeChat mini-program, App, JSAPI, H5 and QR signatures
are not interchangeable. Cancellation only ends waiting, not the transaction.
The backend verifies notifications/queries and owns final financial state. A native
SDK callback cannot authorize fulfillment, retry debit or silently change channels.

The seven-platform catalog distinguishes source presence from environment/device
acceptance. Compiling a wrapper, using a protocol fixture or completing a local
reference payment is not physical-device or merchant acceptance.
