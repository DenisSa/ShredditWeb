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
  DEFAULT_STORE_DELETION_HISTORY,
  PreviewItem,
  ShredRules,
} from "@/lib/shreddit-types";

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

export type DeletedItemRecord = {
  deletedAt: number;
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
  sessionId: string;
  jobId: string | null;
  username: string;
  item: PreviewItem;
  editedBeforeDelete: boolean;
  rules: Pick<ShredRules, "minAgeDays" | "maxScore">;
};

type SessionRow = {
  id: string;
  created_at: number;
  last_seen_at: number;
  oauth_state: string | null;
  reddit_grant_json: string | null;
  active_job_id: string | null;
};

type AccountPreferenceRow = {
  username: string;
  store_deletion_history: number;
  updated_at: number;
};

type GlobalWithDatabase = typeof globalThis & {
  __shredditDatabase?: DatabaseSync;
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
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted_at INTEGER NOT NULL,
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
}

function getDatabase() {
  const globalWithDatabase = globalThis as GlobalWithDatabase;

  if (!globalWithDatabase.__shredditDatabase) {
    const databasePath = getDatabasePath();
    mkdirSync(dirname(databasePath), { recursive: true });

    const database = new DatabaseSync(databasePath);
    ensureSchema(database);
    globalWithDatabase.__shredditDatabase = database;
  }

  return globalWithDatabase.__shredditDatabase;
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

export function getStoreDeletionHistoryPreference(username: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        username,
        store_deletion_history,
        updated_at
      FROM account_preferences
      WHERE username = ?
    `)
    .get(username) as AccountPreferenceRow | undefined;

  if (!row) {
    return DEFAULT_STORE_DELETION_HISTORY;
  }

  return row.store_deletion_history === 1;
}

export function setStoreDeletionHistoryPreference(username: string, storeDeletionHistory: boolean) {
  const updatedAt = Date.now();

  getDatabase()
    .prepare(`
      INSERT INTO account_preferences (
        username,
        store_deletion_history,
        updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        store_deletion_history = excluded.store_deletion_history,
        updated_at = excluded.updated_at
    `)
    .run(username, storeDeletionHistory ? 1 : 0, updatedAt);

  return {
    username,
    storeDeletionHistory,
    updatedAt,
  };
}

export function insertDeletedItem(record: DeletedItemRecord) {
  getDatabase()
    .prepare(`
      INSERT INTO deleted_items (
        deleted_at,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      record.deletedAt,
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

export function listDeletedItemsForSession(sessionId: string, limit = 100) {
  const rows = getDatabase()
    .prepare(`
      SELECT
        id,
        deleted_at,
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
      WHERE session_id = ?
      ORDER BY deleted_at DESC
      LIMIT ?
    `)
    .all(sessionId, limit) as Array<{
    id: number;
    deleted_at: number;
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
