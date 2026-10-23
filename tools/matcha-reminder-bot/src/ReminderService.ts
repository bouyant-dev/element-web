/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

interface MessageEvent {
    event_id?: string;
    sender?: string;
    room_id?: string;
    type?: string;
    origin_server_ts?: number;
    content?: { "msgtype"?: string; "body"?: string; "m.relates_to"?: { rel_type?: string } };
}

/** Matrix message content sent through the encrypted, idempotent transport. */
export interface MessageContent {
    "msgtype": "m.notice" | "m.text";
    "body": string;
    "m.mentions"?: { user_ids: string[] };
}

/** Sends a Matrix message using the supplied stable transaction ID. */
export type SendMessage = (roomId: string, content: MessageContent, transactionId: string) => Promise<string>;

const MAX_DELAY = 365 * 24 * 60 * 60 * 1000;
const USAGE = "Use !remind 10m Message, !remind list, or !remind cancel <id>. Delays: s, m, h, d; maximum 365 days.";

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/** Persists commands before acknowledging them and retries delivery after crashes. Run one process per database. */
export class ReminderService {
    private readonly db: DatabaseSync;
    private readonly send: SendMessage;
    private readonly botUserId: string;
    private readonly now: () => number;
    private readonly onFailure: () => void;
    private queue: Promise<void> = Promise.resolve();
    private tickQueued = false;

    public constructor(
        databasePath: string,
        botUserId: string,
        send: SendMessage,
        now: () => number = Date.now,
        onFailure: () => void = () => console.error("Reminder delivery failed; retry remains scheduled"),
    ) {
        this.db = new DatabaseSync(databasePath);
        this.send = send;
        this.botUserId = botUserId;
        this.now = now;
        this.onFailure = onFailure;
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS reminders (
                id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender TEXT NOT NULL,
                text TEXT NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                retry_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
                delivered_event_id TEXT
            ) STRICT;
            CREATE INDEX IF NOT EXISTS reminder_due ON reminders(status, due_at, retry_at);
            CREATE INDEX IF NOT EXISTS reminder_owner ON reminders(room_id, sender, status);
            CREATE TABLE IF NOT EXISTS commands (
                event_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender TEXT NOT NULL,
                body TEXT NOT NULL, created_at INTEGER NOT NULL,
                retry_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
                delivered_event_id TEXT
            ) STRICT;
            CREATE INDEX IF NOT EXISTS command_rate ON commands(room_id, sender, created_at);
            CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY, since_at INTEGER NOT NULL) STRICT;
        `);
    }

    /** Persists the invitation cutoff so initial sync and old joined-room history cannot create reminders. */
    public allowRoom(roomId: string, sinceAt: number): Promise<void> {
        return this.serial(() => {
            if (!roomId.startsWith("!") || !Number.isSafeInteger(sinceAt) || sinceAt <= 0)
                throw new Error("Invalid room admission");
            this.db
                .prepare(
                    "INSERT INTO rooms (room_id, since_at) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET since_at = MAX(rooms.since_at, excluded.since_at)",
                )
                .run(roomId, sinceAt);
        });
    }

    private serial(work: () => void | Promise<void>): Promise<void> {
        const result = this.queue.then(work);
        this.queue = result.catch(() => {});
        return result;
    }

    /** Accepts decrypted Matrix room messages; routing and sender identity come from the homeserver. */
    public handleMessage(roomId: string, event: MessageEvent): Promise<void> {
        return this.serial(() => {
            const body = event.content?.body;
            if (
                event.type !== "m.room.message" ||
                event.content?.msgtype !== "m.text" ||
                event.content?.["m.relates_to"]?.rel_type === "m.replace" ||
                typeof body !== "string" ||
                !/^!remind(?:\s|$)/i.test(body.trim()) ||
                !roomId.startsWith("!") ||
                roomId.length > 512 ||
                (event.room_id !== undefined && event.room_id !== roomId) ||
                typeof event.event_id !== "string" ||
                !event.event_id.startsWith("$") ||
                event.event_id.length > 512 ||
                typeof event.sender !== "string" ||
                !event.sender.startsWith("@") ||
                event.sender.length > 512 ||
                event.sender === this.botUserId
            ) {
                return;
            }
            const room = this.db.prepare("SELECT since_at FROM rooms WHERE room_id = ?").get(roomId);
            if (
                !room ||
                !Number.isSafeInteger(event.origin_server_ts) ||
                Number(event.origin_server_ts) < Number(room.since_at)
            )
                return;
            if (this.db.prepare("SELECT 1 FROM commands WHERE event_id = ?").get(event.event_id)) return;
            const timestamp = this.now();
            const recent = this.db
                .prepare("SELECT COUNT(*) AS count FROM commands WHERE room_id = ? AND sender = ? AND created_at > ?")
                .get(roomId, event.sender, timestamp - 60_000);
            // Ignore excess commands without creating an unlimited acknowledgement backlog.
            if (Number(recent?.count) >= 30) return;

            this.db.exec("BEGIN IMMEDIATE");
            try {
                const reply = this.command(roomId, event.sender, event.event_id, body.trim(), event.origin_server_ts);
                this.db
                    .prepare(
                        "INSERT INTO commands (event_id, room_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)",
                    )
                    .run(event.event_id, roomId, event.sender, reply, timestamp);
                this.db.exec("COMMIT");
            } catch (error) {
                this.db.exec("ROLLBACK");
                throw error;
            }
        });
    }

    private command(roomId: string, sender: string, eventId: string, body: string, timestamp?: number): string {
        if (/^!remind\s+list$/i.test(body)) {
            const reminders = this.db
                .prepare(
                    "SELECT id, due_at, text FROM reminders WHERE room_id = ? AND sender = ? AND status = 'pending' ORDER BY due_at LIMIT 20",
                )
                .all(roomId, sender);
            if (reminders.length === 0) return "You have no pending reminders in this room.";
            return (
                "Your next pending reminders in this room (up to 20):\n" +
                reminders
                    .map(
                        (row) =>
                            `${row.id} — ${new Date(Number(row.due_at)).toISOString()} — ${String(row.text).slice(0, 120)}`,
                    )
                    .join("\n")
            );
        }

        const cancel = /^!remind\s+cancel\s+(r-[a-f0-9]{16})$/i.exec(body);
        if (cancel) {
            const result = this.db
                .prepare(
                    "UPDATE reminders SET status = 'cancelled' WHERE id = ? AND room_id = ? AND sender = ? AND status = 'pending'",
                )
                .run(cancel[1].toLowerCase(), roomId, sender);
            return result.changes === 1
                ? `Cancelled reminder ${cancel[1]}.`
                : "No pending reminder with that ID in this room belongs to you.";
        }

        const create = /^!remind\s+([1-9][0-9]{0,8})([smhd])\s+([\s\S]+)$/i.exec(body);
        if (!create) return USAGE;
        const text = create[3].trim();
        if (text.length === 0 || text.length > 2000) return "A reminder must contain between 1 and 2,000 characters.";
        const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        const delay = Number(create[1]) * units[create[2].toLowerCase()];
        if (delay > MAX_DELAY) return "The longest reminder delay is 365 days.";
        if (!Number.isSafeInteger(timestamp) || Number(timestamp) <= 0 || Number(timestamp) > this.now() + 300_000) {
            return "This command has an invalid message timestamp. Send a new reminder.";
        }
        const dueAt = Number(timestamp) + delay;
        if (dueAt <= this.now())
            return "That reminder time has already passed. Send a new reminder with a future delay.";
        const counts = this.db
            .prepare(`
            SELECT COUNT(*) AS total,
                COUNT(CASE WHEN room_id = ? THEN 1 END) AS room,
                COUNT(CASE WHEN room_id = ? AND sender = ? THEN 1 END) AS person
            FROM reminders WHERE status = 'pending'
        `)
            .get(roomId, roomId, sender);
        if (Number(counts?.person) >= 100 || Number(counts?.room) >= 1000 || Number(counts?.total) >= 10_000) {
            return "The pending reminder limit has been reached. Cancel an existing reminder before adding another.";
        }
        const id = `r-${hash(eventId).slice(0, 16)}`;
        this.db
            .prepare("INSERT INTO reminders (id, room_id, sender, text, due_at) VALUES (?, ?, ?, ?, ?)")
            .run(id, roomId, sender, text, dueAt);
        return `Scheduled ${id} for ${new Date(dueAt).toISOString()}. Cancel with !remind cancel ${id}.`;
    }

    /** Sends due reminders and acknowledgements serially so cancellation cannot race a delivery. */
    public tick(): Promise<void> {
        if (this.tickQueued) return Promise.resolve();
        this.tickQueued = true;
        return this.serial(async () => {
            const replies = this.db
                .prepare(
                    "SELECT * FROM commands WHERE delivered_event_id IS NULL AND retry_at <= ? ORDER BY created_at LIMIT 20",
                )
                .all(this.now());
            for (const row of replies) {
                try {
                    const eventId = await this.send(
                        String(row.room_id),
                        { msgtype: "m.notice", body: String(row.body) },
                        `reply-${hash(String(row.event_id))}`,
                    );
                    this.db
                        .prepare("UPDATE commands SET delivered_event_id = ? WHERE event_id = ?")
                        .run(eventId, row.event_id);
                } catch {
                    this.db
                        .prepare("UPDATE commands SET failures = failures + 1, retry_at = ? WHERE event_id = ?")
                        .run(this.retryAt(Number(row.failures)), row.event_id);
                    this.onFailure();
                }
            }
            const due = this.db
                .prepare(
                    "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? AND retry_at <= ? ORDER BY due_at LIMIT 20",
                )
                .all(this.now(), this.now());
            for (const row of due) {
                try {
                    const eventId = await this.send(
                        String(row.room_id),
                        {
                            "msgtype": "m.text",
                            "body": `Reminder for ${row.sender}: ${row.text}`,
                            "m.mentions": { user_ids: [String(row.sender)] },
                        },
                        `reminder-${row.id}`,
                    );
                    this.db
                        .prepare("UPDATE reminders SET status = 'sent', delivered_event_id = ? WHERE id = ?")
                        .run(eventId, row.id);
                } catch {
                    this.db
                        .prepare("UPDATE reminders SET failures = failures + 1, retry_at = ? WHERE id = ?")
                        .run(this.retryAt(Number(row.failures)), row.id);
                    this.onFailure();
                }
            }
        }).finally(() => {
            this.tickQueued = false;
        });
    }

    private retryAt(failures: number): number {
        return this.now() + Math.min(300_000, 1000 * 2 ** Math.min(failures, 9));
    }

    /** Finishes the current operation before closing persistent storage. */
    public async close(): Promise<void> {
        await this.queue;
        this.db.close();
    }
}
