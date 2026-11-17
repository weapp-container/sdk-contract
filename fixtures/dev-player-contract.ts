import type {
  AcceptedPackIdentity, ApplyDevPackAttempt, AtomicPresentationReceipt,
  DevPackAttemptObservationError, DevPackAttemptQuery, DevPackAttemptReceipt, DevPlayerCommandInputs, DevPlayerEvent, ExecutionHealth,
  HostLayout, HostLayoutObservation, HostSurfaceIdentity, NavigationLayoutRequest,
  PreparedRestartMeasurementAttempt, PrepareHostLayoutRequest,
  RuntimeDiagnosticsCapabilities, RuntimeRetirementErrorOrigin, ViewExecutionMetrics, ViewPreparationMetrics,
} from '../types/weapp-container.js';

const surface: HostSurfaceIdentity = { ownerId: '1', surfaceGeneration: '9007199254740993' };
const observation: HostLayoutObservation = {
  schemaVersion: 1, ...surface, observationId: '2',
  windowMetrics: {
    windowWidth: 375, windowHeight: 623, pixelRatio: 3,
    screenWidth: 375, screenHeight: 812, statusBarHeight: 44,
    screenTop: 44, deviceOrientation: 'portrait',
  },
};
const layout: HostLayout = {
  schemaVersion: 1, ...surface, observationId: observation.observationId,
  layoutRevision: '3', windowMetrics: observation.windowMetrics,
  chrome: {
    schemaVersion: 1, revision: 1,
    contentRect: { left: 0, top: 88, width: 375, height: 623 },
    menuButtonRect: { left: 280, right: 367, top: 48, bottom: 80, width: 87, height: 32 },
  },
};
const accepted: AcceptedPackIdentity = { root: 'a'.repeat(64), acceptedPackRevision: '4', sessionId: 'session:1' };
// Retirement origin stays bound to this old owner even after another acceptance.
const retirementOrigin: RuntimeRetirementErrorOrigin = {
  schemaVersion: 1, phase: 'retirement', operation: 'unload',
  sessionId: accepted.sessionId, acceptedPackIdentity: accepted,
};
const retirementEvent: DevPlayerEvent = {
  type: 'error', error: { code: 'ERR_TIMEOUT', message: 'retirement failed' }, origin: retirementOrigin,
};
// Legacy errors remain representable; consumers must not guess their owner.
const legacyError: DevPlayerEvent = { type: 'error', error: { code: 'ERR_ENGINE', message: 'legacy diagnostic' } };
const retirementCapabilities: RuntimeDiagnosticsCapabilities = { retirementErrorOrigin: { schemaVersion: 1 } };
const legacyCapabilities: RuntimeDiagnosticsCapabilities = {};
// @ts-expect-error An arbitrary call cannot be labeled as owner retirement.
const invalidRetirementOperation: RuntimeRetirementErrorOrigin = { ...retirementOrigin, operation: 'render' };
// @ts-expect-error Retirement origin cannot omit its frozen accepted identity.
const missingRetirementIdentity: RuntimeRetirementErrorOrigin = { schemaVersion: 1, phase: 'retirement', operation: 'cancelHostCalls', sessionId: accepted.sessionId };
// @ts-expect-error Origin is not a current frame or layout phase.
const invalidRetirementPhase: RuntimeRetirementErrorOrigin = { ...retirementOrigin, phase: 'current' };
// @ts-expect-error Unknown diagnostic schemas require separate negotiation.
const invalidRetirementSchema: RuntimeDiagnosticsCapabilities = { retirementErrorOrigin: { schemaVersion: 2 } };
void [retirementEvent, legacyError, retirementCapabilities, legacyCapabilities, invalidRetirementOperation, missingRetirementIdentity, invalidRetirementPhase, invalidRetirementSchema];
const restartMeasurement: PreparedRestartMeasurementAttempt = {
  schemaVersion: 1, ownerId: surface.ownerId, attemptId: '9007199254740999',
  targetRoot: 'b'.repeat(64), expectedAccepted: accepted,
};
const preparedMeasurement: PrepareHostLayoutRequest = {
  observation, chrome: layout.chrome, layoutRevision: '5',
  coordinateSpace: 'flutterClient', restartAttempt: restartMeasurement,
};
// @ts-expect-error Measurement cannot drop its acceptance CAS.
const noMeasurementCas: PreparedRestartMeasurementAttempt = { schemaVersion: 1, ownerId: '1', attemptId: '2', targetRoot: 'b'.repeat(64) };
// @ts-expect-error A recovery claim never belongs in a committed core layout.
const proofInCommit: HostLayout = { ...layout, restartAttempt: restartMeasurement };
// @ts-expect-error Attempt identity cannot be rounded through a JSON Number.
const numericMeasurement: PreparedRestartMeasurementAttempt = { ...restartMeasurement, attemptId: 9007199254740999 };
void [preparedMeasurement, noMeasurementCas, proofInCommit, numericMeasurement];
const begin: DevPlayerCommandInputs['beginDevPackAttempt'] = {
  operation: 'applyDevPack', packPath: '/verified/pack', expectedAccepted: accepted,
};
const apply: ApplyDevPackAttempt = {
  ownerId: surface.ownerId, attemptId: '5', expectedAccepted: accepted,
  initialHostLayout: layout,
};
// Publication remains accepted if the optional state observer fails. A client
// reconciles this authoritative identity without assuming state is available.
const acceptedWithoutState: DevPackAttemptReceipt = {
  schemaVersion: 1, ownerId: surface.ownerId, attemptId: '5', status: 'accepted',
  operation: 'applyDevPack', targetRoot: accepted.root, expectedAccepted: null,
  acceptedPackIdentity: accepted, reloadKind: 'restart',
  observationErrors: [{ phase: 'state', error: {
    code: 'ERR_INVALID_MANIFEST', message: 'State observation unavailable after publication',
  } }],
};
// @ts-expect-error An observation diagnostic cannot invent an execution phase.
const invalidObservationPhase: DevPackAttemptObservationError['phase'] = 'execute';
void [acceptedWithoutState, invalidObservationPhase];
const presented: AtomicPresentationReceipt = {
  ...surface, generation: 2, revision: 19,
  observationId: observation.observationId, layoutRevision: layout.layoutRevision,
};
const health: ExecutionHealth = {
  schemaVersion: 1, appServiceFault: null, navigationFault: null,
  viewFault: { domain: 'view', code: 'ERR_TIMEOUT', message: 'frontier interrupted', requiresRestart: true },
  requiresRestart: true,
};
const metrics: ViewExecutionMetrics = {
  preparation: { elapsedNs: 100, providerInitializationNs: 50, validationEncodingNs: 30,
    providerNs: 20, providerStages: null, cacheHit: false, succeeded: true },
  frontier: { elapsedNs: 80, documentValidationEncodingNs: 10, providerNs: 60,
    receiptValidationNs: 10, documentCacheHit: true, succeeded: true,
    providerStages: { batches: 1, elapsedNs: 60, inputEncodeNs: 5,
      vmInputParseNs: 5, executeIncludingLazyCompileNs: 40,
      vmOutputEncodeNs: 5, outputDecodeNs: 5, compileNs: null } },
  scopeRelease: { elapsedNs: 5, providerNs: 5, providerStages: null, succeeded: true },
};
const commands = {
  begin, apply, presented, health, metrics,
  layout: layout satisfies DevPlayerCommandInputs['hostLayout'],
  navigation: { ticket: 'session:1:navigation:1', layout } satisfies DevPlayerCommandInputs['completeNavigationLayout'],
};
const navigationDeadline: NavigationLayoutRequest['deadlineNs'] = '1793270000123456789';
// @ts-expect-error Epoch nanoseconds cannot round-trip through a JSON Number.
const numericNavigationDeadline: NavigationLayoutRequest['deadlineNs'] = 1793270000123456789;
void [navigationDeadline, numericNavigationDeadline];
void commands;

function observeQuery(result: DevPackAttemptQuery): string {
  if (result.status === 'notRetained' || result.status === 'notSeen') {
    return result.acceptedPackIdentity?.root ?? 'empty';
  }
  // Narrowing preserves the distinction between missing observation and a
  // terminal receipt; a missing result is not a rejected/accepted attempt.
  return result.targetRoot;
}
void observeQuery;

// @ts-expect-error Identity may not pass through an imprecise JSON Number.
const numericOwner: HostSurfaceIdentity = { ownerId: 1, surfaceGeneration: '2' };
// @ts-expect-error CAS is mandatory, including an explicit null for initial load.
const noCas: ApplyDevPackAttempt = { ownerId: '1', attemptId: '2' };
// @ts-expect-error Half a layout is not a complete publication.
const halfLayout: HostLayout = { schemaVersion: 1, ...surface, observationId: '2', layoutRevision: '3', chrome: layout.chrome };
// @ts-expect-error Frame revisions are not accepted-pack revisions.
const confusedIdentity: AcceptedPackIdentity = { root: accepted.root, sessionId: accepted.sessionId, acceptedPackRevision: presented.revision };
// @ts-expect-error Cold initialization must remain an explicit measured stage.
const missingInitialization: ViewPreparationMetrics = { elapsedNs: 100, validationEncodingNs: 30, providerNs: 20, providerStages: null, cacheHit: false, succeeded: true };
void [numericOwner, noCas, halfLayout, confusedIdentity, missingInitialization];
