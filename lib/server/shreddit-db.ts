import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  AccountSchedule,
  CleanupSettings,
  DEFAULT_STORE_DELETION_HISTORY,
  DeletedItemSnippet,
  LastRunSummary,
  PreviewItem,
  RunReport,
  ScheduledRunReasonCode,
  ScheduledRunStatus,
  ScheduledRunSummary,
  ShredRules,
  ThemePreference,
} from "@/lib/shreddit-types";
import { DEFAULT_THEME_PREFERENCE, normalizeThemePreference } from "@/lib/server/shreddit-theme";

export type PersistedRedditGrant = {
  accessToken: string;
  refreshToken: string;
  obtainedAt: number;
  expiresAt: number;
  scope: string[];
  username: string;
};

export type PersistedSessionRecord = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  oauthState: string | null;
  reddit: PersistedRedditGrant | null;
  activeJobId: string | null;
};

export type PersistedAccountAuth = {
  username: string;
  grant: PersistedRedditGrant | null;
  requiresReconnect: boolean;
  updatedAt: number;
};

export type PersistedAccountSettings = CleanupSettings & {
  username: string;
  updatedAt: number;
};

export type PersistedAccountPreferences = {
  username: string;
  theme: ThemePreference;
  updatedAt: number;
};

export type PersistedAccountSchedule = AccountSchedule & {
  username: string;
  updatedAt: number;
};

export type DeletedItemRecord = {
  deletedAt: number;
  runId: string;
  sessionId: string;
  jobId: string | null;
  username: string;
  item: PreviewItem;
  editedBeforeDelete: boolean;
  rules: ShredRules;
};

export type DeletedItemHistoryEntry = {
  id: number;
  deletedAt: number;
  runId: string | null;
  sessionId: string;
  jobId: string | null;
  username: string;
  item: PreviewItem;
  editedBeforeDelete: boolean;
  rules: Pick<ShredRules, "minAgeDays" | "maxScore">;
};

export type ScheduledRunRecord = {
  username: string;
  runId: string | null;
  status: ScheduledRunStatus;
  startedAt: number;
  finishedAt: number;
  message: string | null;
  reasonCode: ScheduledRunReasonCode | null;
  report: RunReport | null;
};

export type ManualRunRecord = {
  username: string;
  report: RunReport;
};

type SessionRow = {
  id: string;
  created_at: number;
  last_seen_at: number;
  oauth_state: string | null;
  reddit_grant_json: string | null;
  active_job_id: string | null;
};

type LegacyAccountPreferenceRow = {
  username: string;
  store_deletion_history: number;
  theme?: string | null;
  updated_at: number;
};

type AccountAuthRow = {
  username: string;
  reddit_grant_json: string | null;
  requires_reconnect: number;
  updated_at: number;
};

type AccountSettingsRow = {
  username: string;
  store_deletion_history: number;
  min_age_days: number;
  max_score: number;
  updated_at: number;
};

type AccountScheduleRow = {
  username: string;
  enabled: number;
  cadence: AccountSchedule["cadence"];
  minute_utc: number;
  hour_utc: number | null;
  weekday_utc: number | null;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_status: ScheduledRunStatus | null;
  last_run_message: string | null;
  updated_at: number;
};

type ScheduledRunRow = {
  id: number;
  username: string;
  run_id: string | null;
  status: ScheduledRunStatus;
  started_at: number;
  finished_at: number;
  message: string | null;
  reason_code: ScheduledRunReasonCode | null;
  report_json: string | null;
};

type ManualRunRow = {
  id: number;
  username: string;
  run_id: string;
  started_at: number;
  finished_at: number;
  report_json: string;
};

type GlobalWithDatabase = typeof globalThis & {
  __shredditDatabase?: DatabaseSync;
  __shredditDatabasePath?: string;
};

const DEFAULT_SQLITE_PATH = resolve(process.cwd(), "data", "shreddit.sqlite");
const ENCRYPTED_GRANT_PREFIX = "enc:v1:";

function getDatabasePath() {
  const configuredPath = process.env.SQLITE_PATH?.trim();
  return resolve(configuredPath || DEFAULT_SQLITE_PATH);
}

function getEncryptionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error("Missing SESSION_SECRET.");
  }

  return secret;
}

function getGrantEncryptionKey() {
  return Uint8Array.from(scryptSync(getEncryptionSecret(), "shredditweb.reddit-grant.v1", 32));
}

function encryptJson(value: unknown) {
  const iv = Uint8Array.from(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", getGrantEncryptionKey(), iv);
  const ciphertext = Uint8Array.from([
    ...cipher.update(JSON.stringify(value), "utf8"),
    ...cipher.final(),
  ]);
  const authTag = Uint8Array.from(cipher.getAuthTag());

  return `${ENCRYPTED_GRANT_PREFIX}${Buffer.from(iv).toString("base64url")}.${Buffer.from(authTag).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
}

function decryptJson<T>(value: string) {
  const encodedPayload = value.slice(ENCRYPTED_GRANT_PREFIX.length);
  const [ivValue, authTagValue, ciphertextValue] = encodedPayload.split(".", 3);

  if (!ivValue || !authTagValue || !ciphertextValue) {
    throw new Error("Stored encrypted grant is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getGrantEncryptionKey(),
    Uint8Array.from(Buffer.from(ivValue, "base64url")),
  );
  decipher.setAuthTag(Uint8Array.from(Buffer.from(authTagValue, "base64url")));

  const plaintext = Uint8Array.from([
    ...decipher.update(Uint8Array.from(Buffer.from(ciphertextValue, "base64url"))),
    ...decipher.final(),
  ]);

  return JSON.parse(Buffer.from(plaintext).toString("utf8")) as T;
}

function parseStoredGrant(value: string | null) {
  if (!value) {
    return {
      grant: null,
      wasLegacyPlaintext: false,
    };
  }

  if (value.startsWith(ENCRYPTED_GRANT_PREFIX)) {
    try {
      return {
        grant: decryptJson<PersistedRedditGrant>(value),
        wasLegacyPlaintext: false,
      };
    } catch {
      return {
        grant: null,
        wasLegacyPlaintext: false,
      };
    }
  }

  try {
    return {
      grant: JSON.parse(value) as PersistedRedditGrant,
      wasLegacyPlaintext: true,
    };
  } catch {
    return {
      grant: null,
      wasLegacyPlaintext: false,
    };
  }
}

function ensureColumnExists(database: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      oauth_state TEXT,
      reddit_grant_json TEXT,
      active_job_id TEXT
    );

    CREATE INDEX IF NOT EXISTS sessions_last_seen_at_idx
      ON sessions (last_seen_at);

    CREATE TABLE IF NOT EXISTS account_preferences (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      store_deletion_history INTEGER NOT NULL DEFAULT 1,
      theme TEXT NOT NULL DEFAULT 'dark',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reddit_accounts (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      reddit_grant_json TEXT,
      requires_reconnect INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_settings (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      store_deletion_history INTEGER NOT NULL DEFAULT 1,
      min_age_days INTEGER NOT NULL,
      max_score INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_schedules (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      enabled INTEGER NOT NULL DEFAULT 0,
      cadence TEXT NOT NULL,
      minute_utc INTEGER NOT NULL,
      hour_utc INTEGER,
      weekday_utc INTEGER,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_run_status TEXT,
      last_run_message TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS account_schedules_next_run_idx
      ON account_schedules (enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      run_id TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      message TEXT,
      reason_code TEXT,
      report_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS scheduled_runs_username_created_idx
      ON scheduled_runs (username, created_at DESC);

    CREATE TABLE IF NOT EXISTS manual_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      run_id TEXT NOT NULL UNIQUE,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      report_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS manual_runs_username_finished_idx
      ON manual_runs (username, finished_at DESC);

    CREATE TABLE IF NOT EXISTS deleted_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted_at INTEGER NOT NULL,
      run_id TEXT,
      session_id TEXT NOT NULL,
      job_id TEXT,
      username TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      thing_kind TEXT NOT NULL,
      content_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_utc INTEGER NOT NULL,
      subreddit TEXT NOT NULL,
      permalink TEXT NOT NULL,
      reason TEXT NOT NULL,
      edited_before_delete INTEGER NOT NULL,
      rules_min_age_days INTEGER NOT NULL,
      rules_max_score INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS deleted_items_deleted_at_idx
      ON deleted_items (deleted_at DESC);

    CREATE INDEX IF NOT EXISTS deleted_items_username_idx
      ON deleted_items (username, deleted_at DESC);
  `);

  ensureColumnExists(database, "account_preferences", "theme", "TEXT NOT NULL DEFAULT 'dark'");
  ensureColumnExists(database, "scheduled_runs", "run_id", "TEXT");
  ensureColumnExists(database, "deleted_items", "run_id", "TEXT");

  database.exec(`
    CREATE INDEX IF NOT EXISTS deleted_items_run_id_idx
      ON deleted_items (run_id, deleted_at DESC);
  `);
}

function getDatabase() {
  const globalWithDatabase = globalThis as GlobalWithDatabase;
  const databasePath = getDatabasePath();

  if (
    globalWithDatabase.__shredditDatabase &&
    globalWithDatabase.__shredditDatabasePath &&
    globalWithDatabase.__shredditDatabasePath !== databasePath
  ) {
    globalWithDatabase.__shredditDatabase.close();
    globalWithDatabase.__shredditDatabase = undefined;
    globalWithDatabase.__shredditDatabasePath = undefined;
  }

  if (!globalWithDatabase.__shredditDatabase) {
    mkdirSync(dirname(databasePath), { recursive: true });

    const database = new DatabaseSync(databasePath);
    ensureSchema(database);
    globalWithDatabase.__shredditDatabase = database;
    globalWithDatabase.__shredditDatabasePath = databasePath;
  }

  return globalWithDatabase.__shredditDatabase;
}

function mapAccountSettingsRow(row: AccountSettingsRow): PersistedAccountSettings {
  return {
    username: row.username,
    storeDeletionHistory: row.store_deletion_history === 1,
    minAgeDays: row.min_age_days,
    maxScore: row.max_score,
    updatedAt: row.updated_at,
  };
}

function mapAccountPreferencesRow(row: LegacyAccountPreferenceRow): PersistedAccountPreferences {
  return {
    username: row.username,
    theme: normalizeThemePreference(row.theme),
    updatedAt: row.updated_at,
  };
}

function mapAccountScheduleRow(row: AccountScheduleRow): PersistedAccountSchedule {
  return {
    username: row.username,
    enabled: row.enabled === 1,
    cadence: row.cadence,
    minuteUtc: row.minute_utc,
    hourUtc: row.hour_utc,
    weekdayUtc: row.weekday_utc,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastRunMessage: row.last_run_message,
    updatedAt: row.updated_at,
  };
}

function mapScheduledRunRow(row: ScheduledRunRow): ScheduledRunSummary {
  return {
    id: row.id,
    username: row.username,
    runId: row.run_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.message,
    reasonCode: row.reason_code,
    report: row.report_json ? (JSON.parse(row.report_json) as RunReport) : null,
  };
}

function mapManualRunRow(row: ManualRunRow): LastRunSummary {
  return {
    source: "manual",
    report: JSON.parse(row.report_json) as RunReport,
  };
}

export function resetDatabaseForTests() {
  const globalWithDatabase = globalThis as GlobalWithDatabase;

  globalWithDatabase.__shredditDatabase?.close();
  globalWithDatabase.__shredditDatabase = undefined;
  globalWithDatabase.__shredditDatabasePath = undefined;
}

export function upsertPersistedSession(session: PersistedSessionRecord) {
  getDatabase()
    .prepare(`
      INSERT INTO sessions (
        id,
        created_at,
        last_seen_at,
        oauth_state,
        reddit_grant_json,
        active_job_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        oauth_state = excluded.oauth_state,
        reddit_grant_json = excluded.reddit_grant_json,
        active_job_id = excluded.active_job_id
    `)
    .run(
      session.id,
      session.createdAt,
      session.lastSeenAt,
      session.oauthState,
      session.reddit ? encryptJson(session.reddit) : null,
      session.activeJobId,
    );
}

export function loadPersistedSession(sessionId: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        id,
        created_at,
        last_seen_at,
        oauth_state,
        reddit_grant_json,
        active_job_id
      FROM sessions
      WHERE id = ?
    `)
    .get(sessionId) as SessionRow | undefined;

  if (!row) {
    return null;
  }

  const { grant, wasLegacyPlaintext } = parseStoredGrant(row.reddit_grant_json);
  const session = {
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    oauthState: row.oauth_state,
    reddit: grant,
    activeJobId: row.active_job_id,
  } satisfies PersistedSessionRecord;

  if (wasLegacyPlaintext && session.reddit) {
    upsertPersistedSession(session);
  }

  return session;
}

export function deletePersistedSession(sessionId: string) {
  getDatabase().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function deleteExpiredPersistedSessions(expireBefore: number) {
  const expiredRows = getDatabase()
    .prepare("SELECT id FROM sessions WHERE last_seen_at < ?")
    .all(expireBefore) as Array<{ id: string }>;

  if (expiredRows.length === 0) {
    return [];
  }

  getDatabase().prepare("DELETE FROM sessions WHERE last_seen_at < ?").run(expireBefore);
  return expiredRows.map((row) => row.id);
}

export function upsertPersistedAccountGrant(grant: PersistedRedditGrant) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO reddit_accounts (
        username,
        reddit_grant_json,
        requires_reconnect,
        updated_at
      ) VALUES (?, ?, 0, ?)
      ON CONFLICT(username) DO UPDATE SET
        reddit_grant_json = excluded.reddit_grant_json,
        requires_reconnect = 0,
        updated_at = excluded.updated_at
    `)
    .run(grant.username, encryptJson(grant), updatedAt);

  return {
    username: grant.username,
    grant,
    requiresReconnect: false,
    updatedAt,
  } satisfies PersistedAccountAuth;
}

export function loadPersistedAccountAuth(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        username,
        reddit_grant_json,
        requires_reconnect,
        updated_at
      FROM reddit_accounts
      WHERE username = ?
    `)
    .get(username) as AccountAuthRow | undefined;

  if (!row) {
    return null;
  }

  const { grant } = parseStoredGrant(row.reddit_grant_json);

  return {
    username: row.username,
    grant,
    requiresReconnect: row.requires_reconnect === 1,
    updatedAt: row.updated_at,
  } satisfies PersistedAccountAuth;
}

export function clearPersistedAccountGrant(username: string, requiresReconnect = false) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO reddit_accounts (
        username,
        reddit_grant_json,
        requires_reconnect,
        updated_at
      ) VALUES (?, NULL, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        reddit_grant_json = NULL,
        requires_reconnect = excluded.requires_reconnect,
        updated_at = excluded.updated_at
    `)
    .run(username, requiresReconnect ? 1 : 0, updatedAt);

  return {
    username,
    grant: null,
    requiresReconnect,
    updatedAt,
  } satisfies PersistedAccountAuth;
}

function loadLegacyAccountPreference(username: string) {
  return getDatabase()
    .prepare(`
      SELECT
        username,
        store_deletion_history,
        theme,
        updated_at
      FROM account_preferences
      WHERE username = ?
    `)
    .get(username) as LegacyAccountPreferenceRow | undefined;
}

export function loadAccountPreferences(username: string) {
  const row = loadLegacyAccountPreference(username);
  return row ? mapAccountPreferencesRow(row) : null;
}

export function ensureAccountPreferences(username: string) {
  const existing = loadAccountPreferences(username);

  if (existing) {
    return existing;
  }

  return upsertAccountThemePreference(username, DEFAULT_THEME_PREFERENCE);
}

export function upsertAccountThemePreference(username: string, theme: ThemePreference) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO account_preferences (
        username,
        store_deletion_history,
        theme,
        updated_at
      ) VALUES (?, 1, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        theme = excluded.theme,
        updated_at = excluded.updated_at
    `)
    .run(username, theme, updatedAt);

  return {
    username,
    theme,
    updatedAt,
  } satisfies PersistedAccountPreferences;
}

export function loadAccountSettings(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        username,
        store_deletion_history,
        min_age_days,
        max_score,
        updated_at
      FROM account_settings
      WHERE username = ?
    `)
    .get(username) as AccountSettingsRow | undefined;

  return row ? mapAccountSettingsRow(row) : null;
}

export function ensureAccountSettings(username: string, defaults: CleanupSettings) {
  const existing = loadAccountSettings(username);

  if (existing) {
    return existing;
  }

  const legacy = loadLegacyAccountPreference(username);
  const seeded = {
    storeDeletionHistory: legacy
      ? legacy.store_deletion_history === 1
      : defaults.storeDeletionHistory ?? DEFAULT_STORE_DELETION_HISTORY,
    minAgeDays: defaults.minAgeDays,
    maxScore: defaults.maxScore,
  } satisfies CleanupSettings;

  return upsertAccountSettings(username, seeded);
}

export function upsertAccountSettings(username: string, settings: CleanupSettings) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO account_settings (
        username,
        store_deletion_history,
        min_age_days,
        max_score,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        store_deletion_history = excluded.store_deletion_history,
        min_age_days = excluded.min_age_days,
        max_score = excluded.max_score,
        updated_at = excluded.updated_at
    `)
    .run(
      username,
      settings.storeDeletionHistory ? 1 : 0,
      settings.minAgeDays,
      settings.maxScore,
      updatedAt,
    );

  return {
    username,
    ...settings,
    updatedAt,
  } satisfies PersistedAccountSettings;
}

export function getStoreDeletionHistoryPreference(username: string) {
  const settings = loadAccountSettings(username);

  if (settings) {
    return settings.storeDeletionHistory;
  }

  const legacy = loadLegacyAccountPreference(username);
  return legacy ? legacy.store_deletion_history === 1 : DEFAULT_STORE_DELETION_HISTORY;
}

export function setStoreDeletionHistoryPreference(
  username: string,
  storeDeletionHistory: boolean,
  defaults: CleanupSettings,
) {
  const current = loadAccountSettings(username) ?? ensureAccountSettings(username, defaults);

  return upsertAccountSettings(username, {
    ...current,
    storeDeletionHistory,
  });
}

export function loadAccountSchedule(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        username,
        enabled,
        cadence,
        minute_utc,
        hour_utc,
        weekday_utc,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_message,
        updated_at
      FROM account_schedules
      WHERE username = ?
    `)
    .get(username) as AccountScheduleRow | undefined;

  return row ? mapAccountScheduleRow(row) : null;
}

export function upsertAccountSchedule(
  username: string,
  schedule: Omit<PersistedAccountSchedule, "username" | "updatedAt">,
) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO account_schedules (
        username,
        enabled,
        cadence,
        minute_utc,
        hour_utc,
        weekday_utc,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_message,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        enabled = excluded.enabled,
        cadence = excluded.cadence,
        minute_utc = excluded.minute_utc,
        hour_utc = excluded.hour_utc,
        weekday_utc = excluded.weekday_utc,
        next_run_at = excluded.next_run_at,
        last_run_at = excluded.last_run_at,
        last_run_status = excluded.last_run_status,
        last_run_message = excluded.last_run_message,
        updated_at = excluded.updated_at
    `)
    .run(
      username,
      schedule.enabled ? 1 : 0,
      schedule.cadence,
      schedule.minuteUtc,
      schedule.hourUtc,
      schedule.weekdayUtc,
      schedule.nextRunAt,
      schedule.lastRunAt,
      schedule.lastRunStatus,
      schedule.lastRunMessage,
      updatedAt,
    );

  return {
    username,
    ...schedule,
    updatedAt,
  } satisfies PersistedAccountSchedule;
}

export function updateAccountScheduleRunState(
  username: string,
  updates: Pick<AccountSchedule, "enabled" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "lastRunMessage">,
) {
  const current = loadAccountSchedule(username);

  if (!current) {
    return null;
  }

  return upsertAccountSchedule(username, {
    ...current,
    ...updates,
  });
}

export function disableAccountSchedule(username: string, message: string, lastRunStatus: ScheduledRunStatus = "stopped") {
  const current = loadAccountSchedule(username);

  if (!current) {
    return null;
  }

  return upsertAccountSchedule(username, {
    ...current,
    enabled: false,
    nextRunAt: null,
    lastRunAt: Date.now(),
    lastRunStatus,
    lastRunMessage: message,
  });
}

export function listDueSchedules(now: number) {
  const rows = getDatabase()
    .prepare(`
      SELECT
        username,
        enabled,
        cadence,
        minute_utc,
        hour_utc,
        weekday_utc,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_message,
        updated_at
      FROM account_schedules
      WHERE enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `)
    .all(now) as AccountScheduleRow[];

  return rows.map(mapAccountScheduleRow);
}

export function insertScheduledRun(record: ScheduledRunRecord) {
  const createdAt = Date.now();
  const result = getDatabase()
    .prepare(`
      INSERT INTO scheduled_runs (
        username,
        run_id,
        status,
        started_at,
        finished_at,
        message,
        reason_code,
        report_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      record.username,
      record.runId,
      record.status,
      record.startedAt,
      record.finishedAt,
      record.message,
      record.reasonCode,
      record.report ? JSON.stringify(record.report) : null,
      createdAt,
    );

  return Number(result.lastInsertRowid);
}

export function insertManualRun(record: ManualRunRecord) {
  const createdAt = Date.now();
  const result = getDatabase()
    .prepare(`
      INSERT INTO manual_runs (
        username,
        run_id,
        started_at,
        finished_at,
        report_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      record.username,
      record.report.runId,
      record.report.startedAt,
      record.report.finishedAt,
      JSON.stringify(record.report),
      createdAt,
    );

  return Number(result.lastInsertRowid);
}

export function listScheduledRunsForUsername(username: string, limit = 20) {
  const rows = getDatabase()
    .prepare(`
      SELECT
        id,
        username,
        run_id,
        status,
        started_at,
        finished_at,
        message,
        reason_code,
        report_json
      FROM scheduled_runs
      WHERE username = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(username, limit) as ScheduledRunRow[];

  return rows.map(mapScheduledRunRow);
}

export function getLatestScheduledRunForUsername(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        id,
        username,
        run_id,
        status,
        started_at,
        finished_at,
        message,
        reason_code,
        report_json
      FROM scheduled_runs
      WHERE username = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(username) as ScheduledRunRow | undefined;

  return row ? mapScheduledRunRow(row) : null;
}

export function getLatestExecutedScheduledRunForUsername(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        id,
        username,
        run_id,
        status,
        started_at,
        finished_at,
        message,
        reason_code,
        report_json
      FROM scheduled_runs
      WHERE username = ?
        AND report_json IS NOT NULL
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    `)
    .get(username) as ScheduledRunRow | undefined;

  return row
    ? ({
        source: "scheduled",
        report: JSON.parse(row.report_json ?? "null") as RunReport,
      } satisfies LastRunSummary)
    : null;
}

export function getLatestManualRunForUsername(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        id,
        username,
        run_id,
        started_at,
        finished_at,
        report_json
      FROM manual_runs
      WHERE username = ?
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    `)
    .get(username) as ManualRunRow | undefined;

  return row ? mapManualRunRow(row) : null;
}

export function getLatestRunForUsername(username: string) {
  const latestManual = getLatestManualRunForUsername(username);
  const latestScheduled = getLatestExecutedScheduledRunForUsername(username);

  if (!latestManual) {
    return latestScheduled;
  }

  if (!latestScheduled) {
    return latestManual;
  }

  return latestManual.report.finishedAt >= latestScheduled.report.finishedAt ? latestManual : latestScheduled;
}

export function insertDeletedItem(record: DeletedItemRecord) {
  getDatabase()
    .prepare(`
      INSERT INTO deleted_items (
        deleted_at,
        run_id,
        session_id,
        job_id,
        username,
        item_id,
        item_name,
        thing_kind,
        content_kind,
        title,
        body,
        score,
        created_utc,
        subreddit,
        permalink,
        reason,
        edited_before_delete,
        rules_min_age_days,
        rules_max_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      record.deletedAt,
      record.runId,
      record.sessionId,
      record.jobId,
      record.username,
      record.item.id,
      record.item.name,
      record.item.thingKind,
      record.item.contentKind,
      record.item.title,
      record.item.body,
      record.item.score,
      record.item.createdUtc,
      record.item.subreddit,
      record.item.permalink,
      record.item.reason,
      record.editedBeforeDelete ? 1 : 0,
      record.rules.minAgeDays,
      record.rules.maxScore,
    );
}

export function listDeletedItemsForUsername(username: string, limit = 100) {
  const rows = getDatabase()
    .prepare(`
      SELECT
        id,
        deleted_at,
        run_id,
        session_id,
        job_id,
        username,
        item_id,
        item_name,
        thing_kind,
        content_kind,
        title,
        body,
        score,
        created_utc,
        subreddit,
        permalink,
        reason,
        edited_before_delete,
        rules_min_age_days,
        rules_max_score
      FROM deleted_items
      WHERE username = ?
      ORDER BY deleted_at DESC
      LIMIT ?
    `)
    .all(username, limit) as Array<{
    id: number;
    deleted_at: number;
    run_id: string | null;
    session_id: string;
    job_id: string | null;
    username: string;
    item_id: string;
    item_name: string;
    thing_kind: string;
    content_kind: PreviewItem["contentKind"];
    title: string;
    body: string;
    score: number;
    created_utc: number;
    subreddit: string;
    permalink: string;
    reason: string;
    edited_before_delete: number;
    rules_min_age_days: number;
    rules_max_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    deletedAt: row.deleted_at,
    runId: row.run_id,
    sessionId: row.session_id,
    jobId: row.job_id,
    username: row.username,
    item: {
      id: row.item_id,
      name: row.item_name,
      thingKind: row.thing_kind,
      contentKind: row.content_kind,
      title: row.title,
      body: row.body,
      score: row.score,
      createdUtc: row.created_utc,
      subreddit: row.subreddit,
      permalink: row.permalink,
      eligible: true,
      reason: row.reason,
    },
    editedBeforeDelete: row.edited_before_delete === 1,
    rules: {
      minAgeDays: row.rules_min_age_days,
      maxScore: row.rules_max_score,
    },
  })) satisfies DeletedItemHistoryEntry[];
}

export function listDeletedItemSnippetsForRunId(runId: string, limit = 3) {
  const rows = getDatabase()
    .prepare(`
      SELECT
        id,
        deleted_at,
        content_kind,
        title,
        body,
        subreddit,
        permalink
      FROM deleted_items
      WHERE run_id = ?
      ORDER BY deleted_at DESC, id DESC
      LIMIT ?
    `)
    .all(runId, limit) as Array<{
    id: number;
    deleted_at: number;
    content_kind: PreviewItem["contentKind"];
    title: string;
    body: string;
    subreddit: string;
    permalink: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    deletedAt: row.deleted_at,
    contentKind: row.content_kind,
    title: row.title,
    body: row.body,
    subreddit: row.subreddit,
    permalink: row.permalink,
  })) satisfies DeletedItemSnippet[];
}
