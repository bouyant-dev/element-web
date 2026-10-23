/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MatrixEvent, MatrixEventEvent, type MatrixClient, type IEvent } from "matrix-js-sdk/src/matrix";

/** Retry cached failures from ciphertext; callers retain their own validation and failure policy. */
export async function decryptMatrixEventWithRetry(
    client: MatrixClient,
    event: MatrixEvent,
    raw?: Partial<IEvent>,
): Promise<MatrixEvent> {
    const retry = event.isDecryptionFailure();
    if (retry) {
        // SDK 44 does not retry cached m.bad.encrypted events through decryptEventIfNeeded.
        // Keep the cached model intact and retry its original ciphertext through the public API.
        event = new MatrixEvent(raw ?? { ...event.event, content: { ...event.getWireContent() } });
        client.reEmitter.reEmit(event, [MatrixEventEvent.Decrypted]);
    }
    await client.decryptEventIfNeeded(event, retry ? { isRetry: true } : undefined);
    return event;
}
