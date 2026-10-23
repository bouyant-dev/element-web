/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MatrixClient } from "matrix-bot-sdk";

/** Commits the sync position only after listeners have durably recorded each command. */
export class DurableMatrixClient extends MatrixClient {
    protected override persistTokenAfterSync = true;

    protected override async processSync(raw: unknown): Promise<void> {
        await super.processSync(raw, async (name: string, ...args: unknown[]) => {
            try {
                for (const listener of this.rawListeners(name)) await Promise.resolve(listener.apply(this, args));
            } catch {
                // The SDK advances its in-memory sync token on errors; restart from the saved token instead.
                this.stop();
                const error = new Error("Matrix event processing failed before its sync position was saved");
                this.emit("error", error);
                throw error;
            }
        });
    }
}
