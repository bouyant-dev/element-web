/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { MatrixClient } from "matrix-bot-sdk";
import type { SendMessage } from "./ReminderService.ts";

/** Uses the SDK's encryption path with a persisted transaction ID for retry deduplication. */
export function matrixSender(client: Pick<MatrixClient, "crypto" | "doRequest" | "getRoomStateEvent">): SendMessage {
    return async (roomId, content, transactionId) => {
        if (!client.crypto) throw new Error("The reminder bot requires persistent encryption support");
        let type = "m.room.message";
        let payload: unknown = content;
        let encrypted = await client.crypto.isRoomEncrypted(roomId);
        if (!encrypted) {
            // The SDK treats every state-fetch failure as unencrypted; only M_NOT_FOUND establishes that safely.
            try {
                await client.getRoomStateEvent(roomId, "m.room.encryption", "");
                encrypted = true;
            } catch (error) {
                if (
                    typeof error !== "object" ||
                    error === null ||
                    !("errcode" in error) ||
                    error.errcode !== "M_NOT_FOUND"
                )
                    throw error;
            }
        }
        if (encrypted) {
            payload = await client.crypto.encryptRoomEvent(roomId, type, content);
            type = "m.room.encrypted";
        }
        const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/${encodeURIComponent(transactionId)}`;
        const result = await client.doRequest("PUT", path, null, payload, 30_000);
        if (typeof result?.event_id !== "string") throw new Error("Matrix did not return a delivery event ID");
        return result.event_id;
    };
}

/** Joins only rooms explicitly invited by a configured user. */
export async function acceptInvite(
    client: Pick<MatrixClient, "joinRoom">,
    allowedInviters: ReadonlySet<string>,
    botUserId: string,
    roomId: string,
    event: { sender?: string; state_key?: string; content?: { membership?: string } },
    admitRoom: () => Promise<void>,
): Promise<boolean> {
    if (
        event.content?.membership !== "invite" ||
        event.state_key !== botUserId ||
        !allowedInviters.has(event.sender ?? "")
    )
        return false;
    await admitRoom();
    await client.joinRoom(roomId);
    return true;
}
