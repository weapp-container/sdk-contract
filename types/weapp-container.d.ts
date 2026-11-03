export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface HostInvokeOptions { timeout?: number; cancelToken?: string; }
export interface WeappContainerBridge {
  invoke(method: string, payload?: JsonValue, options?: HostInvokeOptions): Promise<JsonValue>;
  postMessage(payload: JsonValue): void;
  onMessage(listener: (payload: JsonValue) => void): void;
  offMessage(listener?: (payload: JsonValue) => void): void;
  readonly identity: {
    getState(): JsonValue;
    onChange(listener:(value:JsonValue)=>void):void;
    offChange(listener?:(value:JsonValue)=>void):void;
    logout(options?:HostInvokeOptions):Promise<JsonValue>;
  };
  readonly payment: { request(options: {orderId:string;idempotencyKey?:string;[key:string]:JsonValue|undefined}):Promise<JsonValue> };
}
declare global { const weappContainer: WeappContainerBridge; }

/** Additive SDK chrome contract, capability chrome.protocolVersion === "1.0". */
export interface ChromePage { id: number; route: string; }
export interface HostChromeGeometry {
  schemaVersion: 1;
  revision: number;
  /** Rectangles use actual current-screen logical pixels. */
  contentRect: { left: number; top: number; width: number; height: number };
  menuButtonRect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  sessionId?: string;
  pageId?: number;
}
export interface PageChrome {
  schemaVersion: 1;
  chromeRevision: number;
  sessionId: string | null;
  page: ChromePage | null;
  stack: ChromePage[];
  canGoBack: boolean;
  navigationStyle: "default" | "custom";
  title: string;
  backgroundColor: string;
  frontColor: "#000000" | "#ffffff";
  tabBar: {
    visible: boolean;
    custom: boolean;
    color: string;
    selectedColor: string;
    backgroundColor: string;
    borderStyle: string;
    selectedIndex: number | null;
    /** Dynamic indicators require matching runtime admission and an attached system presenter. */
    list: Array<{ pagePath: string; text: string; iconPath?: string; selectedIconPath?: string; badgeText?: string; redDot?: boolean }>;
  };
}
export interface ChromeCapabilities {
  protocolVersion: "1.0";
  geometry: true;
  inspectPack: true;
  occlusion: true;
  transactionalRestart: true;
  /** Optional additive preview.5 capability; absent on older ABI 1 runtimes. */
  atomicLayout?: AtomicHostLayoutCapabilities;
}

/** Canonical positive decimal u64 on the wire. Runtime also rejects 0, signs,
 * leading zeroes and values greater than u64::MAX. Never cast identity to Number. */
export type DecimalU64 = `${bigint}`;
export interface SdkError { code: string; message: string; }
/** Host-observed safe rectangle in the screen's portrait direction. */
export interface HostSafeArea {
  left: number; right: number; top: number; bottom: number; width: number; height: number;
}
export interface HostWindowMetrics {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  statusBarHeight: number;
  screenTop: number;
  safeArea?: HostSafeArea;
  deviceOrientation: "portrait" | "landscape";
}
export interface AtomicHostLayoutCapabilities {
  protocolVersion: "1.0";
  enabled: boolean;
  initialLayout: true;
  sdkObservationIdentity: true;
  /** Native adapter measurement protocol; not granted by the core alone. */
  preparedRestartMeasurement?: "1.0";
}
export interface HostLayoutConfig { protocolVersion: "1.0"; atomic: true; }
export interface HostSurfaceIdentity { ownerId: DecimalU64; surfaceGeneration: DecimalU64; }
/** Native observation is a staging receipt, never a committed JS environment. */
export interface HostLayoutObservation extends HostSurfaceIdentity {
  schemaVersion: 1;
  observationId: DecimalU64;
  windowMetrics: HostWindowMetrics;
  sessionId?: string;
  pageId?: number;
}
/** Entire environment is measured against one exact native observation. */
export interface HostLayout extends HostSurfaceIdentity {
  schemaVersion: 1;
  observationId: DecimalU64;
  layoutRevision: DecimalU64;
  windowMetrics: HostWindowMetrics;
  chrome: HostChromeGeometry;
}
export interface NavigationLayoutRequest {
  schemaVersion: 1;
  /** Opaque session-bound ticket, not an integer/frame revision. */
  ticket: string;
  sessionId: string;
  root: string;
  /** Exact Unix ns decimal string for timeout planning; never cast to Number. */
  deadlineNs: DecimalU64;
  targetRoute: string;
  chrome: PageChrome;
}
export interface AcceptedPackIdentity {
  root: string;
  acceptedPackRevision: DecimalU64;
  sessionId: string;
}
/** Frozen retiring owner; never an observation of the current accepted session.
 * Missing legacy origin must fail safe rather than infer ownership from current state. */
export interface RuntimeRetirementErrorOrigin {
  schemaVersion: 1;
  phase: "retirement";
  operation: "unload" | "cancelNavigation" | "cancelHostCalls";
  sessionId: string;
  acceptedPackIdentity: AcceptedPackIdentity;
}
/** Additive diagnostics over C ABI 1. Require schemaVersion 1 before interpreting
 * an error origin; absence is legacy, not proof that an error belongs to current. */
export interface RuntimeDiagnosticsCapabilities {
  retirementErrorOrigin?: { schemaVersion: 1 };
}
/** A claim checked against the live native journal, never client authority. */
export interface PreparedRestartMeasurementAttempt {
  schemaVersion: 1;
  ownerId: DecimalU64;
  attemptId: DecimalU64;
  targetRoot: string;
  expectedAccepted: AcceptedPackIdentity | null;
}
/** Flutter/native measurement adapter, separate from the core hostLayout command. */
export interface PrepareHostLayoutRequest {
  observation: HostLayoutObservation;
  chrome: HostChromeGeometry;
  layoutRevision: DecimalU64;
  coordinateSpace: "flutterClient" | "screen";
  restartAttempt?: PreparedRestartMeasurementAttempt;
}
export type DevReloadKind = "inPlace" | "restart";
export type DevPackAttemptStatus = "prepared" | "applying" | "accepted" | "rejected" | "cancelled";
export interface DevPackAttemptObservationError {
  phase: "state" | "postCommit";
  error: SdkError;
}
export interface DevPackAttemptReceipt {
  schemaVersion: 1;
  ownerId: DecimalU64;
  attemptId: DecimalU64;
  status: DevPackAttemptStatus;
  operation: "load" | "applyDevPack";
  targetRoot: string;
  expectedAccepted: AcceptedPackIdentity | null;
  acceptedPackIdentity: AcceptedPackIdentity | null;
  reloadKind: DevReloadKind;
  state?: DevPlayerState;
  error?: SdkError;
  /** Optional observations cannot change execution status or replay a commit. */
  observationErrors?: DevPackAttemptObservationError[];
}
export interface BeginDevPackAttempt {
  operation: "load" | "applyDevPack";
  packPath: string;
  /** Required compare-and-swap; explicitly null only for an empty owner. */
  expectedAccepted: AcceptedPackIdentity | null;
  route?: string;
  options?: { [key: string]: JsonValue };
}
export interface ApplyDevPackAttempt {
  ownerId: DecimalU64;
  attemptId: DecimalU64;
  expectedAccepted: AcceptedPackIdentity | null;
  initialHostLayout?: HostLayout;
}
export interface DevAttemptIdentity { ownerId: DecimalU64; attemptId: DecimalU64; }
export type MissingDevPackAttempt = DevAttemptIdentity & {
  schemaVersion: 1;
  acceptedPackIdentity: AcceptedPackIdentity | null;
} & ({ status: "notRetained" } | { status: "notSeen" });
/** A missing/evicted receipt cannot be resubmitted as a fresh attempt. */
export type DevPackAttemptQuery = DevPackAttemptReceipt | MissingDevPackAttempt;
export interface AttemptJournalCapabilities {
  protocolVersion: "1.0";
  terminalRetention: 64;
  acceptedIdentity: true;
}
export interface ExecutionFault {
  domain: "appService" | "view" | "navigation";
  /** Original typed failure, not a parsed ERR_ENGINE wrapper. */
  code: string;
  message: string;
  stack?: string;
  requiresRestart: boolean;
  /** Navigation phase/committed-shape/original-error facts, when present. */
  details?: JsonValue;
}
export interface ExecutionHealth {
  schemaVersion: 1;
  appServiceFault: ExecutionFault | null;
  viewFault: ExecutionFault | null;
  navigationFault: ExecutionFault | null;
  requiresRestart: boolean;
}
/** Closed metadata for one native owner-thread call, not a process identity. */
export interface ViewBatchDiagnostics {
  schemaVersion: 1;
  engine: "quickjs" | "v8";
  modern: boolean;
  operation: "load" | "evaluate" | "render" | "registerDocuments" | "renderRegistered" | "releaseScopes" | "unknown";
  batchSequence: DecimalU64 | null;
  ownerThreadId: DecimalU64 | null;
  /** Unsigned decimal u64 clock strings; zero is a valid clock observation. */
  monotonicStartNs: string | null;
  monotonicEndNs: string | null;
  boottimeStartNs: string | null;
  boottimeEndNs: string | null;
  threadCpuStartNs: string | null;
  threadCpuEndNs: string | null;
  threadCpuElapsedNs: string | null;
  errorCode: string | null;
  androidTraceEnabled: boolean | null;
  androidTraceEmitted: boolean;
}
export interface ViewPhaseTiming {
  /** API returned without error; not a deadline or health acceptance. */
  completed: boolean;
  monotonicStartNs: string | null;
  monotonicEndNs: string | null;
  wallElapsedNs: string | null;
  threadCpuStartNs: string | null;
  threadCpuEndNs: string | null;
  threadCpuElapsedNs: string | null;
}
/** Optional QuickJS detail only; V8 reports null rather than invented costs. */
export interface ViewBatchBreakdown {
  schemaVersion: 1;
  engine: "quickjs";
  modern: boolean;
  operation: ViewBatchDiagnostics["operation"];
  batchSequence: DecimalU64 | null;
  ownerThreadId: DecimalU64 | null;
  phases: {
    /** Nested aggregate; do not add it to its contained stages. */
    contextCall: ViewPhaseTiming | null;
    jsonStringifyApi: ViewPhaseTiming | null;
    utf8CopyApi: ViewPhaseTiming | null;
    finalDeadlineCheck: ViewPhaseTiming | null;
    poisonDrop: ViewPhaseTiming | null;
    /** Unsigned decimal count, null when extraction did not succeed. */
    outputBytes: string | null;
  };
}
/** Observed native provider work; lazy compilation may share an execution call. */
export interface ViewProviderStages {
  batches: number;
  elapsedNs: number;
  inputEncodeNs: number;
  vmInputParseNs: number;
  executeIncludingLazyCompileNs: number;
  vmOutputEncodeNs: number;
  outputDecodeNs: number;
  /** Null when the provider cannot independently measure compilation. */
  compileNs: number | null;
  inputBytes?: number;
  documentRegistrations?: number;
  registeredRenderBatches?: number;
  lastBatch?: ViewBatchDiagnostics | null;
  lastBatchBreakdown?: ViewBatchBreakdown | null;
}
export interface ViewPreparationMetrics {
  elapsedNs: number;
  /** Measured realm construction and bootstrap; excluded from validation encoding. */
  providerInitializationNs: number;
  validationEncodingNs: number;
  providerNs: number;
  providerStages: ViewProviderStages | null;
  cacheHit: boolean;
  succeeded: boolean;
}
export interface ViewFrontierMetrics {
  elapsedNs: number;
  documentValidationEncodingNs: number;
  providerNs: number;
  providerStages: ViewProviderStages | null;
  receiptValidationNs: number;
  documentCacheHit: boolean;
  succeeded: boolean;
}
export interface ViewExecutionMetrics {
  preparation: ViewPreparationMetrics;
  frontier: ViewFrontierMetrics;
  scopeRelease: { elapsedNs: number; providerNs: number; providerStages: ViewProviderStages | null; succeeded: boolean };
}
/** Additive state fields for adapters negotiating the preview.5 protocols.
 * Pack acceptance, layout, frame and presentation are independent identities. */
export interface DevPlayerState {
  schemaVersion: 1;
  status: "empty" | "ready" | "identitySwitching" | "closing" | "closed";
  ownerId: DecimalU64;
  sessionId: string | null;
  generation: number;
  frameRevision: number;
  foreground: boolean;
  acceptedPackIdentity: AcceptedPackIdentity | null;
  hostSurface: HostSurfaceIdentity | null;
  acceptedLayout: HostLayout | null;
  pendingHostLayout: HostLayoutObservation | null;
  pendingNavigation: NavigationLayoutRequest | null;
  executionHealth: ExecutionHealth | null;
  viewExecutionMetrics: ViewExecutionMetrics | null;
  presentationRequired: boolean;
  presentationEnabled: boolean;
  inputEnabled: boolean;
  chromeGeometryReady: boolean;
  previewOccluded: boolean;
}
/** Extra exact-layout binding on the existing native presented command. */
export interface AtomicPresentationReceipt extends HostSurfaceIdentity {
  generation: number;
  revision: number;
  observationId: DecimalU64;
  layoutRevision: DecimalU64;
}
/** Internal adapter command shapes; not methods added to the guest JS bridge. */
export interface DevPlayerCommandInputs {
  hostSurface: { action: "attach" } | ({ action: "detach" } & HostSurfaceIdentity);
  observeHostLayout: HostSurfaceIdentity & { schemaVersion: 1; windowMetrics: HostWindowMetrics };
  hostLayout: HostLayout;
  completeNavigationLayout: { ticket: string; layout: HostLayout };
  cancelNavigation: { ticket: string };
  beginDevPackAttempt: BeginDevPackAttempt;
  applyDevPackAttempt: ApplyDevPackAttempt;
  queryDevPackAttempt: DevAttemptIdentity;
  cancelDevPackAttempt: DevAttemptIdentity;
  acceptedPackIdentity: Record<string, never>;
  presented: AtomicPresentationReceipt;
  configureHostServices: HostServicesConfig;
  registerApiHandler: {name:string};
  hostApiEvent: HostApiEvent;
  hostComponentFrame: HostComponentFrame;
  hostComponentEvent: HostComponentEvent;
  hostComponents: Record<string, never>;
  managedFileScope: Record<string, never>;
  authorizeInstalledPack: TrustedApplication;
  migrateLegacyStorage: {sourceKey:string};
  deleteAccountData: {principalId:string};
  prepareAccountHostServiceSnapshots: {operationId:string;values:Record<string,JsonValue>};
  updateHostServiceSnapshots: {values:Record<string,JsonValue>;context?:HostSnapshotOwnerContext};
  switchAccount: {account:HostAccount;launches?:Record<string,HostAccountLaunch>};
  queryAccountSwitch: {operationId?:string};
  updateAccountSwitchLaunch: {options:HostAccountLaunch};
  acknowledgeAccountCleanup:{operationId:string};
  retryAccountSwitch: {options?:HostAccountLaunch};
  cancelAccountSwitch: {operationId:string};
  createHostBinary:{bytes:number[]};
  readHostBinary:{id:string;offset:number;length:number};
  retainHostBinary:{id:string};
  releaseHostBinary:{id:string};
}

/** Host-only trusted installation record. A digest proves integrity; the host
 * authenticates publisher/install policy before binding this record to bytes. */
export interface TrustedApplication {
  hostAppId:string;tenantId:string;publisherId:string;appId:string;
  environment:"develop"|"trial"|"release";version:string;packRoot:string;
}
export interface HostAccount {principalId:string|null;epoch:DecimalU64;}
export interface HostServicesConfig {
  application:TrustedApplication;account:HostAccount;
  apis?:string[];syncValues?:Record<string,JsonValue>;
}
/** Freeze from native state before async work; not a pending guest API call. */
export interface HostSnapshotOwnerContext {
  application:TrustedApplication;account:HostAccount;sessionId:string;
}
export interface HostApiCallContext extends HostSnapshotOwnerContext {
  callId:string;api:string;deadlineNs:DecimalU64|null;cancelToken:string|null;
  componentTarget?:{pageId:DecimalU64;nodeId:string;ownerScopeId:string|null};
}
/** Native-only paths; never expose this record or host credentials to guest JS. */
export interface ManagedFileScope {
  root:string;auxiliaryRoot:string;scopeId:string;
  application:TrustedApplication;account:HostAccount;
}
export type HostApiKind="syncSnapshot"|"syncLocal"|"async"|"task"|"subscription"|"object";
export interface HostApiFailure {
  code:"invalid_request"|"permission_denied"|"timeout"|"cancelled"|"unsupported";
  message:string;retryable?:boolean;
  /** Preserved verbatim as public API failure fields. Never put secrets here. */
  details?:Record<string,JsonValue> & {errCode?:number|string;errMsg?:string};
}
export interface HostApiEvent {
  sessionId:string;accountEpoch:DecimalU64;subscriptionId:string;
  sequence:DecimalU64;value:JsonValue;objectId?:string|null;event?:string|null;
}
export interface HostComponentEvent {
  sessionId:string;accountEpoch:DecimalU64;nodeId:string;event:string;
  sequence:DecimalU64;value:JsonValue;
}
export interface HostBinaryHandle {id:string;byteLength:number;sessionId:string;accountEpoch:DecimalU64;}
/** One retain reference transfers on successful materialization of a payload.
 * Failed validation consumes none. Revocation invalidates every owned handle. */
export interface HostBinaryReference {__weappBinary:{handle:string};}
export interface HostAccountLaunch {route?:string;options?:Record<string,JsonValue>;initialHostChrome?:HostChromeGeometry;initialHostLayout?:HostLayout;}
export interface AccountSwitchReceipt {
  operationId:string;epoch:DecimalU64;
  phase:"revoking"|"stoppingResources"|"waitingForSurface"|"flushingStorage"|"starting"|"awaitingPresentation"|"complete"|"failed"|"superseded";
  sessionId:string|null;error:SdkError|null;
}
export interface HostServicesCapabilities {
  protocolVersion:"1.0";enabled:boolean;registeredApis:string[]|null;
  trustedContext:true;events:true;accountSwitch:true;binaryHandles:true;
}
export type DevPlayerEvent =
  | { type: "error"; error: SdkError; origin?: RuntimeRetirementErrorOrigin }
  | { type: "hostLayoutObservation"; observation: HostLayoutObservation }
  | { type: "hostLayoutAccepted"; acceptedLayout: HostLayout }
  | { type: "hostLayoutError"; observation: HostLayoutObservation | null; error: SdkError }
  | { type: "navigationLayout"; request: NavigationLayoutRequest | null }
  | { type: "executionHealth"; schemaVersion: 1; sessionId: string | null; generation: number; health: ExecutionHealth | null }
  | { type: "devPackAttempt"; receipt: DevPackAttemptReceipt };

/** Native preview frame in the accepted component's normal paint order. */
export interface HostComponentFrame {
  sessionId:string;accountEpoch:DecimalU64;pageId:DecimalU64;nodeId:string;sequence:DecimalU64;
  width:number;height:number;format:'rgba8';pixels:number[];
}
