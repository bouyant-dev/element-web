/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { ReminderService, type MessageContent, type SendMessage } from "./ReminderService.ts";

const ROOM = "!test:example.org";
const USER = "@user:example.org";
const BOT = "@bot:example.org";

interface Fixture {
    sent: { room: string; content: MessageContent; txn: string }[];
    db: DatabaseSync;
    service: ReminderService;
    now: number;
    advance(ms: number): void;
    restart(): Promise<void>;
    event(body: string, extra?: Record<string, unknown>): Parameters<ReminderService["handleMessage"]>[1];
}

async function fixture(t: TestContext, transport?: SendMessage): Promise<Fixture> {
    const directory = mkdtempSync(path.join(tmpdir(), "matcha-reminders-"));
    const databasePath = path.join(directory, "reminders.sqlite");
    let now = 1_800_000_000_000;
    let counter = 0;
    const sent: { room: string; content: MessageContent; txn: string }[] = [];
    const send: SendMessage =
        transport ??
        (async (room, content, txn) => {
            sent.push({ room, content, txn });
            return `$delivery${sent.length}`;
        });
    let service = new ReminderService(
        databasePath,
        BOT,
        send,
        () => now,
        () => {},
    );
    await service.allowRoom(ROOM, now);
    const db = new DatabaseSync(databasePath);
    t.after(async () => {
        await service.close();
        db.close();
        rmSync(directory, { recursive: true, force: true });
    });
    return {
        sent,
        db,
        get service() {
            return service;
        },
        get now() {
            return now;
        },
        advance(ms: number) {
            now += ms;
        },
        async restart() {
            await service.close();
            service = new ReminderService(
                databasePath,
                BOT,
                send,
                () => now,
                () => {},
            );
        },
        event(body: string, extra: Record<string, unknown> = {}) {
            return {
                event_id: `$command${++counter}`,
                sender: USER,
                type: "m.room.message",
                origin_server_ts: now,
                content: { msgtype: "m.text", body },
                ...extra,
            };
        },
    };
}

void test("persists schedules and acknowledgements across restart, deduplicates replay, and sends a mention once", async (t) => {
    const f = await fixture(t);
    const event = f.event("!remind 10m Check the build");
    await f.service.handleMessage(ROOM, event);
    await f.restart();
    await f.service.handleMessage(ROOM, event);
    await f.service.tick();
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].content.body, /Scheduled r-[a-f0-9]{16}/);
    f.advance(600_000);
    await f.restart();
    await f.service.tick();
    await f.service.tick();
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1].room, ROOM);
    assert.equal(f.sent[1].content.body, `Reminder for ${USER}: Check the build`);
    assert.deepEqual(f.sent[1].content["m.mentions"], { user_ids: [USER] });
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE status = 'sent'").get()?.n, 1);
});

void test("uses the message timestamp and rejects commands whose due time already passed", async (t) => {
    const f = await fixture(t);
    const original = f.now;
    f.advance(60_000);
    await f.service.handleMessage(ROOM, f.event("!remind 10m Original time", { origin_server_ts: original }));
    assert.equal(f.db.prepare("SELECT due_at FROM reminders").get()?.due_at, original + 600_000);
    await f.service.handleMessage(ROOM, f.event("!remind 1s Too late", { origin_server_ts: original }));
    await f.service.tick();
    assert.match(f.sent[1].content.body, /already passed/);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 1);
});

void test("persists an exact UTC deadline across restart and keeps relative commands compatible", async (t) => {
    const f = await fixture(t);
    const at = f.now + 90_123;
    const event = f.event(`!remind at ${new Date(at).toISOString()} Exact deadline`);
    await f.service.handleMessage(ROOM, event);
    assert.equal(f.db.prepare("SELECT due_at FROM reminders").get()?.due_at, at);
    await f.restart();
    await f.service.handleMessage(ROOM, event);
    await f.service.handleMessage(ROOM, f.event("!remind 2m Relative still works"));
    await f.service.tick();
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 2);
    assert.match(f.sent[0].content.body, new RegExp(new Date(at).toISOString().replaceAll(".", "\\.")));
    f.advance(90_123);
    await f.restart();
    await f.service.tick();
    assert.equal(f.sent.at(-1)?.content.body, `Reminder for ${USER}: Exact deadline`);
    assert.equal(f.sent.at(-1)?.room, ROOM);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE status = 'sent'").get()?.n, 1);
});

void test("accepts UTC seconds and rejects ambiguous, normalized, past and excessive exact dates", async (t) => {
    const f = await fixture(t);
    const valid = new Date(f.now + 60_000).toISOString().replace(".000Z", "Z");
    await f.service.handleMessage(ROOM, f.event(`!remind at ${valid} Whole seconds`));
    for (const iso of [
        "2027-02-30T09:00:00Z",
        "2027-01-01T24:00:00Z",
        "2027-01-01T09:00:00",
        "2027-01-01T09:00:00+07:00",
        "tomorrow",
        new Date(f.now - 1).toISOString(),
        new Date(f.now + 366 * 86400_000).toISOString(),
    ])
        await f.service.handleMessage(ROOM, f.event(`!remind at ${iso} Invalid`));
    await f.service.handleMessage(ROOM, f.event(`!remind at ${valid} ${"x".repeat(2001)}`));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 1);
    assert.equal(f.db.prepare("SELECT due_at FROM reminders").get()?.due_at, f.now + 60_000);
});

void test("rejects old room history, unknown rooms, self messages, edits, and mismatched routing", async (t) => {
    const f = await fixture(t);
    await f.service.handleMessage(ROOM, f.event("!remind 1h history", { origin_server_ts: f.now - 1 }));
    await f.service.handleMessage("!unknown:example.org", f.event("!remind 1h unknown"));
    await f.service.handleMessage(ROOM, f.event("!remind 1h self", { sender: BOT }));
    await f.service.handleMessage(ROOM, f.event("!remind 1h mismatch", { room_id: "!other:example.org" }));
    await f.service.handleMessage(
        ROOM,
        f.event("ignored", {
            content: { "msgtype": "m.text", "body": "!remind 1h edit", "m.relates_to": { rel_type: "m.replace" } },
        }),
    );
    await f.service.tick();
    assert.equal(f.sent.length, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 0);
});

void test("validates delays, content length, and future timestamp before persistence", async (t) => {
    const f = await fixture(t);
    for (const body of [
        "!remind 0m no",
        "!remind -1m no",
        "!remind 1.5h no",
        "!remind 366d no",
        "!remind 10m",
        `!remind 1h ${"x".repeat(2001)}`,
    ]) {
        await f.service.handleMessage(ROOM, f.event(body));
    }
    await f.service.handleMessage(ROOM, f.event("!remind 1m future", { origin_server_ts: f.now + 300_001 }));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM commands").get()?.n, 7);
});

void test("cancellation and lists are restricted to the original requester and room", async (t) => {
    const f = await fixture(t);
    await f.service.allowRoom("!other:example.org", f.now);
    await f.service.handleMessage(ROOM, f.event("!remind 1m Secret in this room"));
    const id = String(f.db.prepare("SELECT id FROM reminders").get()?.id);
    await f.service.handleMessage(ROOM, f.event(`!remind cancel ${id}`, { sender: "@other:example.org" }));
    await f.service.handleMessage("!other:example.org", f.event(`!remind cancel ${id}`));
    await f.service.handleMessage(ROOM, f.event("!remind list", { sender: "@other:example.org" }));
    assert.equal(f.db.prepare("SELECT status FROM reminders").get()?.status, "pending");
    await f.service.tick();
    assert.match(f.sent.at(-1)!.content.body, /no pending reminders/);
    await f.service.handleMessage(ROOM, f.event(`!remind cancel ${id}`));
    f.advance(60_000);
    await f.service.tick();
    assert.equal(f.db.prepare("SELECT status FROM reminders").get()?.status, "cancelled");
    assert.equal(f.sent.filter((message) => message.content.msgtype === "m.text").length, 0);
});

void test("retains failed deliveries and retries the same transaction after an uncertain send and restart", async (t) => {
    const delivered = new Map<string, string>();
    const attempts: string[] = [];
    let failOnce = true;
    const f = await fixture(t, async (_room, _content, txn) => {
        const id = delivered.get(txn) ?? `$server-${delivered.size}`;
        delivered.set(txn, id);
        if (txn.startsWith("reminder-")) {
            attempts.push(txn);
            if (failOnce) {
                failOnce = false;
                throw new Error("response lost after server accepted event");
            }
        }
        return id;
    });
    await f.service.handleMessage(ROOM, f.event("!remind 1s Retry safely"));
    await f.service.tick();
    f.advance(1000);
    await f.service.tick();
    assert.equal(f.db.prepare("SELECT status FROM reminders").get()?.status, "pending");
    await f.restart();
    await f.service.tick();
    assert.equal(attempts.length, 1);
    f.advance(1000);
    await f.service.tick();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    assert.equal(delivered.size, 2); // one acknowledgement and one reminder
    assert.equal(f.db.prepare("SELECT status FROM reminders").get()?.status, "sent");
});

void test("caps command floods and pending reminders without discarding accepted schedules", async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < 40; i++) await f.service.handleMessage(ROOM, f.event("!remind nonsense"));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM commands").get()?.n, 30);
    for (let i = 0; i < 101; i++) {
        if (i % 20 === 0) f.advance(61_000);
        await f.service.handleMessage(ROOM, f.event(`!remind 1d Reminder ${i}`));
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reminders").get()?.n, 100);
    assert.match(
        String(f.db.prepare("SELECT body FROM commands ORDER BY rowid DESC LIMIT 1").get()?.body),
        /limit has been reached/,
    );
});

void test("serializes a cancellation behind an in-flight delivery and never falsely claims it cancelled", async (t) => {
    let release: (() => void) | undefined;
    let begin: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
        begin = resolve;
    });
    const f = await fixture(t, async (_room, _content, txn) => {
        if (txn.startsWith("reminder-")) {
            begin!();
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }
        return `$${txn}`;
    });
    await f.service.handleMessage(ROOM, f.event("!remind 1s Race"));
    await f.service.tick();
    f.advance(1000);
    const tick = f.service.tick();
    await started;
    const id = String(f.db.prepare("SELECT id FROM reminders").get()?.id);
    const cancel = f.service.handleMessage(ROOM, f.event(`!remind cancel ${id}`));
    release!();
    await Promise.all([tick, cancel]);
    assert.equal(f.db.prepare("SELECT status FROM reminders").get()?.status, "sent");
    assert.match(
        String(f.db.prepare("SELECT body FROM commands ORDER BY rowid DESC LIMIT 1").get()?.body),
        /No pending reminder/,
    );
});
