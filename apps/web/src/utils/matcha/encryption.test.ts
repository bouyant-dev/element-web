/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { MatrixClient, MatrixEvent, MatrixEventEvent } from "matrix-js-sdk/src/matrix";
import { DecryptionFailureCode } from "matrix-js-sdk/src/crypto-api";
import { mkDecryptionFailureMatrixEvent } from "matrix-js-sdk/src/testing";

import { decryptMatrixEventWithRetry } from "./encryption";

async function failedEvent(): Promise<MatrixEvent> {
    const event = await mkDecryptionFailureMatrixEvent({
        roomId: "!test:server",
        sender: "@alice:server",
        eventId: "$failed",
        code: DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP,
        msg: "Synthetic missing key",
    });
    event.event.content = { ...event.getWireContent(), ciphertext: "original-ciphertext" };
    return event;
}

describe("decryptMatrixEventWithRetry", () => {
    it("retries the actual SDK cached failure through ciphertext and forwards successful recovery", async () => {
        const event = await failedEvent();
        const client = new MatrixClient({ baseUrl: "https://server", userId: "@alice:server" });
        const decrypt = vi.fn(async () => ({ clearEvent: { type: "test.metadata", content: { value: "Recovered" } } }));
        // SDK backend injection belongs only to this lifecycle test, never the application helper.
        Reflect.set(client, "cryptoBackend", { decryptEvent: decrypt });
        const onDecrypted = vi.fn();
        client.on(MatrixEventEvent.Decrypted, onDecrypted);
        await client.decryptEventIfNeeded(event);
        expect(decrypt).not.toHaveBeenCalled();
        const recovered = await decryptMatrixEventWithRetry(client, event);
        expect(decrypt).toHaveBeenCalledOnce();
        expect(recovered).not.toBe(event);
        expect(recovered.getWireContent().ciphertext).toBe("original-ciphertext");
        expect(recovered.getContent()).toEqual({ value: "Recovered" });
        expect(event.isDecryptionFailure()).toBe(true);
        expect(onDecrypted).toHaveBeenCalledWith(recovered, undefined, recovered);
    });

    it("uses a fresh homeserver wire response instead of stale cached encrypted content", async () => {
        const event = await failedEvent();
        const client = new MatrixClient({ baseUrl: "https://server" });
        const decrypt = vi.fn(async (candidate: MatrixEvent) => {
            expect(candidate.getWireContent().ciphertext).toBe("server-ciphertext");
            return { clearEvent: { type: "test.metadata", content: {} } };
        });
        Reflect.set(client, "cryptoBackend", { decryptEvent: decrypt });
        const raw = { ...event.event, content: { ...event.getWireContent(), ciphertext: "server-ciphertext" } };
        const recovered = await decryptMatrixEventWithRetry(client, event, raw);
        expect(recovered.isDecryptionFailure()).toBe(false);
        expect(event.getWireContent().ciphertext).toBe("original-ciphertext");
    });

    it("returns a failed result when keys remain unavailable so consumers can keep their safeguards", async () => {
        const event = await failedEvent();
        const client = new MatrixClient({ baseUrl: "https://server" });
        const decrypt = vi.fn(async () => {
            throw new Error("Still unavailable");
        });
        Reflect.set(client, "cryptoBackend", { decryptEvent: decrypt });
        const retried = await decryptMatrixEventWithRetry(client, event);
        expect(decrypt).toHaveBeenCalledOnce();
        expect(retried.isDecryptionFailure()).toBe(true);
        expect(retried.getWireContent().ciphertext).toBe("original-ciphertext");
    });

    it("preserves a normal readable event and does not invoke decryption", async () => {
        const event = new MatrixEvent({ type: "test.metadata", content: { value: "Plain" } });
        const client = new MatrixClient({ baseUrl: "https://server" });
        const decrypt = vi.fn();
        Reflect.set(client, "cryptoBackend", { decryptEvent: decrypt });
        expect(await decryptMatrixEventWithRetry(client, event)).toBe(event);
        expect(event.getContent()).toEqual({ value: "Plain" });
        expect(decrypt).not.toHaveBeenCalled();
    });
});
