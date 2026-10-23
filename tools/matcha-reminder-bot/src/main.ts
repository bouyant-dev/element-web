/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { mkdirSync } from "node:fs";
import path from "node:path";
import { LogLevel, LogService, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { DurableMatrixClient } from "./DurableMatrixClient.ts";
import { ReminderService } from "./ReminderService.ts";
import { acceptInvite, matrixSender } from "./matrix.ts";

async function main(): Promise<void> {
    process.umask(0o077);
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const dataDir = process.env.DATA_DIR;
    const allowedInviters = new Set(
        (process.env.ALLOWED_INVITERS ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
    );
    if (!homeserver || !accessToken || !dataDir || !path.isAbsolute(dataDir) || allowedInviters.size === 0) {
        throw new Error("Set MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, absolute DATA_DIR, and ALLOWED_INVITERS");
    }
    const url = new URL(homeserver);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS homeserver URL");
    if ([...allowedInviters].some((id) => !/^@[^:\s]+:[^\s]+$/.test(id)))
        throw new Error("Invalid ALLOWED_INVITERS user ID");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    LogService.setLevel(LogLevel.WARN);
    // SDK error objects can contain request bodies and authorization headers.
    LogService.setLogger({
        trace() {},
        debug() {},
        info() {},
        warn() {
            console.warn("Matrix SDK warning");
        },
        error() {
            console.error("Matrix SDK error; request details suppressed");
        },
    });
    const client = new DurableMatrixClient(
        homeserver,
        accessToken,
        new SimpleFsStorageProvider(path.join(dataDir, "sync.json")),
        new RustSdkCryptoStorageProvider(path.join(dataDir, "crypto"), StoreType.Sqlite),
    );
    const botUserId = await client.getUserId();
    const service = new ReminderService(path.join(dataDir, "reminders.sqlite"), botUserId, matrixSender(client));
    let stopping = false;
    client.on("room.invite", async (roomId, event) => {
        const sinceAt = Date.now();
        await acceptInvite(client, allowedInviters, botUserId, roomId, event, () => service.allowRoom(roomId, sinceAt));
    });
    client.on("room.message", (roomId, event) => (stopping ? undefined : service.handleMessage(roomId, event)));
    client.on("error", () => {
        console.error("Matrix event processing failed; restarting from the saved sync position");
        // oxlint-disable-next-line unicorn/no-process-exit -- stop the SDK before it advances an uncommitted sync token
        process.exit(1);
    });
    await client.start();
    const timer = setInterval(
        () => void service.tick().catch(() => console.error("Reminder worker failed; data retained")),
        1000,
    );
    console.info("Reminder bot started with persistent storage and encrypted room support");
    const shutdown = async (): Promise<void> => {
        if (stopping) return;
        stopping = true;
        clearInterval(timer);
        client.stop();
        await service.close();
        // oxlint-disable-next-line unicorn/no-process-exit -- the SDK long-poll remains alive after stop()
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
}

void main().catch(() => {
    console.error(
        "Reminder bot startup failed; check configuration, credentials, storage, and homeserver connectivity",
    );
    // oxlint-disable-next-line unicorn/no-process-exit -- terminate any SDK resources opened during failed startup
    process.exit(1);
});
