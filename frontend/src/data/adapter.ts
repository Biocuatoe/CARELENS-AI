import type {
  Alert,
  AlertActionInput,
  AlertDetail,
  AlertQuery,
  BackendDeviceState,
  CareEvent,
  CareNote,
  Device,
  EventQuery,
  ExportJob,
  HistoryItem,
  HistoryQuery,
  Household,
  HouseholdMember,
  Grant,
  Invitation,
  Measurement,
  NotificationDelivery,
  NotificationSettings,
  Page,
  PairingChallenge,
  PatchSession,
  Product,
  RecipientContext,
  RecipientSummary,
  ReportSummary,
  ServiceDiagnostics,
  Session,
  StreamHint,
  TimeRange,
} from "./contracts";
export type { BackendDeviceState, BackendLatestData } from "./contracts";

/** Forces esbuild to emit this module at runtime (esbuild strips pure-type modules in dev mode). */
export const _ADAPTER_VERSION = "1.0";

export interface Overview {
  openAlerts: Alert[];
  latestEvent: CareEvent | null;
  latestMeasurement: Measurement | null;
  activePatch: PatchSession | null;
  pendingInvitationCount: number | null;
  recent: HistoryItem[];
  /** ISO8601 timestamp of the most recent backend state update received via SSE.
   *  Present only in demo mode (set by DemoAdapter when Telegram command updates state.json). */
  backendUpdatedAt: string | null;
}

export interface MeasurementSeries {
  items: Measurement[];
  latest: Measurement | null;
  expectedIntervalMinutes: number;
  from: string;
  to: string;
}

export interface AccessOverview {
  grants: Grant[];
  invitations: Invitation[];
  householdMembers: HouseholdMember[];
  householdName: string;
}

export interface StreamHandlers {
  onHint: (hint: StreamHint) => void;
  /** Server đóng stream, ví dụ khi quyền bị thu hồi hoặc phiên hết hạn. */
  onClose: (reason: "revoked" | "session_expired" | "error") => void;
}

/**
 * Hợp đồng dữ liệu duy nhất mà UI dùng (ARCHITECTURE §7.1).
 * httpAdapter (M1) và demoAdapter phải cùng tuân theo interface này.
 */
export interface DataAdapter {
  readonly mode: "demo" | "http";

  // Auth
  getSession(): Promise<Session>;
  login(input: { username: string; password: string }): Promise<Session>;
  /** Google sign-in runs on the server (OIDC code flow); the browser only learns whether it is configured, where to start, and finally trades a one-time code for a session. */
  getGoogleSignIn(): Promise<{ enabled: boolean; startUrl: string }>;
  completeGoogleSignIn(code: string): Promise<Session>;
  logout(): Promise<void>;

  // Recipients
  listRecipients(): Promise<RecipientSummary[]>;
  getRecipientContext(recipientId: string): Promise<RecipientContext>;
  listManagedHouseholds(): Promise<Household[]>;
  createRecipient(input: {
    householdId: string | null;
    newHouseholdName: string | null;
    displayName: string;
    products: Product[];
  }): Promise<RecipientSummary>;

  // Overview & sources
  getOverview(recipientId: string): Promise<Overview>;
  listEvents(recipientId: string, query: EventQuery): Promise<Page<CareEvent>>;
  getEvent(recipientId: string, eventId: string): Promise<CareEvent>;
  listMeasurements(recipientId: string, query: { metric: "heart_rate" | "spo2"; range: TimeRange }): Promise<MeasurementSeries>;

  // Alerts
  listAlerts(recipientId: string, query: AlertQuery): Promise<Page<Alert>>;
  getAlert(recipientId: string, alertId: string): Promise<AlertDetail>;
  actOnAlert(recipientId: string, alertId: string, input: AlertActionInput): Promise<AlertDetail>;

  // Devices & patches
  listDevices(recipientId: string): Promise<Device[]>;
  checkDevice(recipientId: string, deviceId: string): Promise<Device>;
  startPairing(recipientId: string, input: { product: Product; serial: string }): Promise<PairingChallenge>;
  confirmPairing(recipientId: string, challengeId: string, code: string): Promise<Device>;
  unassignDevice(recipientId: string, deviceId: string): Promise<void>;
  listPatchSessions(recipientId: string): Promise<PatchSession[]>;
  replacePatch(
    recipientId: string,
    coreDeviceId: string,
    input: { startedAt: string; lotCode: string | null; expectedReplaceAt: string | null; idempotencyKey: string },
  ): Promise<PatchSession>;

  // History & notes
  listHistory(recipientId: string, query: HistoryQuery): Promise<Page<HistoryItem>>;
  addNote(recipientId: string, body: string): Promise<CareNote>;

  // Reports & exports
  getReport(recipientId: string, input: { from: string; to: string; products: Product[] }): Promise<ReportSummary>;
  createExport(
    recipientId: string,
    input: { from: string; to: string; products: Product[]; idempotencyKey: string },
  ): Promise<ExportJob>;
  getExport(recipientId: string, exportId: string): Promise<ExportJob>;
  downloadExport(recipientId: string, exportId: string): Promise<{ filename: string; content: string }>;

  // Sharing
  getAccess(recipientId: string): Promise<AccessOverview>;
  createInvitation(recipientId: string, input: { email: string; role: "caregiver" | "viewer" }): Promise<Invitation>;
  cancelInvitation(recipientId: string, invitationId: string): Promise<void>;
  revokeGrant(recipientId: string, grantId: string): Promise<void>;

  // Notifications & account
  getNotificationSettings(): Promise<NotificationSettings>;
  updateNotificationSettings(input: { backupUserId: string | null; reminderMinutes: number | null }): Promise<NotificationSettings>;
  sendTestNotification(): Promise<NotificationDelivery>;
  listNotificationSink(): Promise<NotificationDelivery[]>;

  // Operations
  getDiagnostics(): Promise<ServiceDiagnostics>;

  // Stream (ADR-010)
  subscribe(recipientId: string, handlers: StreamHandlers, lastSeq?: number): () => void;

  /**
   * Returns the current backend device states for a recipient.
   * In demo mode this reflects the last SSE state_update received from the FastAPI backend.
   * Only meaningful for the LIVESHOWCASE dynamic persona.
   * Returns an empty record for static personas or when no SSE data has been received.
   */
  getBackendDevices(recipientId: string): Record<string, BackendDeviceState>;
}

export interface DemoPersona {
  id: string;
  displayName: string;
  description: string;
}

/** Điều khiển chỉ có trong chế độ demo. Không tồn tại ở httpAdapter. */
export interface DemoControls {
  listPersonas(): DemoPersona[];
  enterDemo(personaId: string): Promise<Session>;
  emitCareEvent(recipientId: string): Promise<string>;
  simulateOtherCaregiverClaim(recipientId: string): Promise<string>;
  toggleHubConnection(recipientId: string): Promise<string>;
  sendLateMeasurement(recipientId: string): Promise<string>;
  expireSession(): void;
  reset(): void;
}
