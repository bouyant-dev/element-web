/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import assert from "node:assert/strict";
import { test } from "node:test";
import type { MatrixClient } from "matrix-bot-sdk";
import { acceptInvite, matrixSender } from "./matrix.ts";
import { DurableMatrixClient } from "./DurableMatrixClient.ts";

void test("encrypts notices and reminders before PUT and preserves the supplied transaction ID", async () => {
    const requests: unknown[][] = [];
    const encrypted: unknown[][] = [];
    const client = {
        crypto: {
            isRoomEncrypted: async () => true,
            encryptRoomEvent: async (...args: unknown[]) => {
                encrypted.push(args);
                return { ciphertext: "encrypted" };
            },
        },
        doRequest: async (...args: unknown[]) => {
            requests.push(args);
            return { event_id: "$sent" };
        },
    } as unknown as Pick<MatrixClient, "crypto" | "doRequest" | "getRoomStateEvent">;
    const send = matrixSender(client);
    for (const msgtype of ["m.notice", "m.text"] as const) {
        await send("!room:example.org", { msgtype, body: "secret" }, "stable-id");
    }
    assert.equal(encrypted.length, 2);
    assert.equal(encrypted[0][1], "m.room.message");
    assert.equal(requests[0][0], "PUT");
    assert.match(String(requests[0][1]), /\/send\/m.room.encrypted\/stable-id$/);
    assert.deepEqual(requests[0][3], { ciphertext: "encrypted" });
    assert.deepEqual(requests[0], requests[1]);
});

void test("never falls back to plaintext after an encryption error", async () => {
    let requests = 0;
    const client = {
        crypto: {
            isRoomEncrypted: async () => true,
            encryptRoomEvent: async () => {
                throw new Error("no keys");
            },
        },
        doRequest: async () => {
            requests++;
        },
    } as unknown as Pick<MatrixClient, "crypto" | "doRequest" | "getRoomStateEvent">;
    await assert.rejects(matrixSender(client)("!room:example.org", { msgtype: "m.text", body: "secret" }, "same-id"));
    assert.equal(requests, 0);
});

void test("does not trust the SDK's unencrypted fallback on a state-fetch failure", async () => {
    let requests = 0;
    const client = {
        crypto: { isRoomEncrypted: async () => false },
        getRoomStateEvent: async () => {
            throw { errcode: "M_FORBIDDEN" };
        },
        doRequest: async () => {
            requests++;
        },
    } as unknown as Pick<MatrixClient, "crypto" | "doRequest" | "getRoomStateEvent">;
    await assert.rejects(matrixSender(client)("!room:example.org", { msgtype: "m.text", body: "secret" }, "id"));
    assert.equal(requests, 0);
});

void test("permits plaintext only when the homeserver confirms no room encryption state", async () => {
    const requests: unknown[][] = [];
    const client = {
        crypto: { isRoomEncrypted: async () => false },
        getRoomStateEvent: async () => {
            throw { errcode: "M_NOT_FOUND" };
        },
        doRequest: async (...args: unknown[]) => {
            requests.push(args);
            return { event_id: "$plain" };
        },
    } as unknown as Pick<MatrixClient, "crypto" | "doRequest" | "getRoomStateEvent">;
    assert.equal(
        await matrixSender(client)("!room:example.org", { msgtype: "m.text", body: "plain room" }, "id"),
        "$plain",
    );
    assert.match(String(requests[0][1]), /\/send\/m.room.message\/id$/);
});

void test("joins only an invitation addressed to the bot from an allowlisted inviter", async () => {
    const joined: string[] = [];
    const client = {
        joinRoom: async (id: string) => {
            joined.push(id);
            return id;
        },
    };
    const allowed = new Set(["@owner:example.org"]);
    const event = { sender: "@owner:example.org", state_key: "@bot:example.org", content: { membership: "invite" } };
    const admit = async (): Promise<void> => {
        joined.push("admitted");
    };
    assert.equal(
        await acceptInvite(
            client,
            allowed,
            "@bot:example.org",
            "!room:example.org",
            { ...event, sender: "@stranger:example.org" },
            admit,
        ),
        false,
    );
    assert.equal(
        await acceptInvite(
            client,
            allowed,
            "@bot:example.org",
            "!room:example.org",
            { ...event, state_key: "@other:example.org" },
            admit,
        ),
        false,
    );
    assert.equal(await acceptInvite(client, allowed, "@bot:example.org", "!room:example.org", event, admit), true);
    assert.deepEqual(joined, ["admitted", "!room:example.org"]);
});

class TestClient extends DurableMatrixClient {
    public runSync(raw: unknown): Promise<void> {
        return this.processSync(raw);
    }
    public savesAfterProcessing(): boolean {
        return this.persistTokenAfterSync;
    }
}

void test("awaits durable async command handling before completing sync", async () => {
    const client = new TestClient("https://example.invalid", "unused");
    let done = false;
    client.on("room.message", async () => {
        await Promise.resolve();
        done = true;
    });
    await client.runSync({
        rooms: {
            join: {
                "!room:example.org": {
                    timeline: { events: [{ type: "m.room.message", content: { msgtype: "m.text", body: "test" } }] },
                },
            },
        },
    });
    assert.equal(done, true);
    assert.equal(client.savesAfterProcessing(), true);
});

void test("reports a fatal processing error so the process restarts from its saved sync token", async () => {
    const client = new TestClient("https://example.invalid", "unused");
    let errorRaised = false;
    client.on("error", () => {
        errorRaised = true;
    });
    client.on("room.message", async () => {
        throw new Error("disk full");
    });
    await assert.rejects(
        client.runSync({
            rooms: {
                join: { "!room:example.org": { timeline: { events: [{ type: "m.room.message", content: {} }] } } },
            },
        }),
    );
    assert.equal(errorRaised, true);
});
