/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { type Map as YMap } from "yjs";

import {
    getRoomDocumentSession,
    isRoomDocumentId,
    type RoomDocumentState,
    type RoomDocumentSession,
} from "./documents";

/** A shared document's stable identity and encrypted catalog metadata. */
export interface SpaceDocument {
    id: string;
    /** The original main document has no title until a member names it. */
    title?: string;
    createdAt: number;
}

/** Catalog readiness and save state use the same guarantees as document contents. */
export interface SpaceDocumentCatalogState extends RoomDocumentState {
    documents: SpaceDocument[];
}

/** Validate before creating or renaming; surrounding whitespace is not part of a name. */
export function validSpaceDocumentName(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100;
}

function isMetadata(value: unknown): value is { title: string; createdAt: number } {
    return (
        !!value &&
        typeof value === "object" &&
        "title" in value &&
        validSpaceDocumentName(value.title) &&
        "createdAt" in value &&
        typeof value.createdAt === "number" &&
        Number.isSafeInteger(value.createdAt) &&
        value.createdAt >= 0
    );
}

/** Multiple views retain one encrypted Yjs catalog, including failed writes across navigation. */
export class SpaceDocumentCatalog extends EventTarget {
    private readonly session: RoomDocumentSession;
    private readonly documents: YMap<unknown>;
    private released = false;

    public constructor(
        private readonly client: MatrixClient,
        private readonly space: Room,
    ) {
        super();
        if (!space.isSpaceRoom()) throw new Error("permission_error");
        this.session = getRoomDocumentSession(client, space, "catalog");
        this.documents = this.session.doc.getMap("documents");
        this.session.addEventListener("change", this.changed);
    }

    private changed = (): void => {
        this.dispatchEvent(new Event("change"));
    };

    public getState = (): SpaceDocumentCatalogState => {
        const state = this.session.getState();
        const documents: SpaceDocument[] = [];
        let invalid = false;
        for (const [id, metadata] of this.documents) {
            if (!isRoomDocumentId(id) || !isMetadata(metadata)) {
                invalid = true;
                continue;
            }
            documents.push({ id, title: metadata.title, createdAt: metadata.createdAt });
        }
        // Existing Spaces already have this document; its content never needs a migration or copy.
        if (!this.documents.has("main")) documents.push({ id: "main", createdAt: 0 });
        documents.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        return {
            ...state,
            documents,
            ready: state.ready && !invalid,
            canEdit:
                state.canEdit &&
                !invalid &&
                !this.released &&
                this.space.hasEncryptionStateEvent() &&
                !!this.client.getCrypto(),
            ...(invalid ? { error: "invalid_update" as const, sync: "error" as const } : {}),
        };
    };

    /** Publish a new named document and return its ID only after its catalog entry is acknowledged. */
    public create = async (title: string): Promise<string> => {
        this.checkWrite(title);
        const id = crypto.randomUUID();
        this.documents.set(id, { title: title.trim(), createdAt: Date.now() });
        await this.save();
        return id;
    };

    /** Rename the catalog entry without touching this document's Markdown or anyone else's document. */
    public rename = async (id: string, title: string): Promise<void> => {
        this.checkWrite(title);
        const entry = this.getState().documents.find((document) => document.id === id);
        if (!entry) throw new Error("invalid_update");
        if (entry.title !== title.trim()) this.documents.set(id, { title: title.trim(), createdAt: entry.createdAt });
        await this.save();
    };

    private checkWrite = (title: string): void => {
        if (!validSpaceDocumentName(title)) throw new Error("invalid_update");
        const state = this.getState();
        if (!state.canEdit) throw new Error(state.error ?? "permission_error");
    };

    private save = async (): Promise<void> => {
        await this.session.flush();
        const state = this.session.getState();
        if (state.error || state.pendingUpdates) throw new Error(state.error ?? "send_error");
    };

    /** Recover missing history/keys or retry the retained updates with their original transaction IDs. */
    public retry = async (): Promise<void> => {
        await this.session.retry();
        await this.session.flush();
    };

    /** Pending catalog changes remain in the shared transport until they are acknowledged. */
    public release = (): void => {
        if (this.released) return;
        this.released = true;
        this.session.removeEventListener("change", this.changed);
        this.session.release();
    };
}
