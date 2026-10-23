/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import * as Y from "yjs";
import {
    ClientEvent,
    Direction,
    EventStatus,
    EventType,
    MatrixEventEvent,
    RelationType,
    RoomEvent,
    RoomMemberEvent,
    RoomStateEvent,
    SyncState,
    decodeBase64,
    encodeBase64,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    type IEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { decryptMatrixEventWithRetry } from "./encryption";

/** Encrypted timeline events carrying shared Markdown documents and their catalog. */
export const ROOM_DOC_EVENT = "com.matchahoneylatte.docs.update";
/** Leaves ample room for JSON, base64 and the Matrix encryption envelope below 64KiB. */
export const ROOM_DOC_CHUNK_BYTES = 16 * 1024;
const MAX_CHUNKS = 256;
const REMOTE_ORIGIN = {};

/** One immutable part of the document transport protocol. */
export interface RoomDocFrame {
    "version": 1;
    "doc": string;
    "update_id": string;
    "kind": "update" | "chunk" | "commit";
    "chunks": number;
    "chunk"?: number;
    "data"?: string;
    "m.relates_to": { rel_type: string; event_id: string };
}

/** Failures which must never be interpreted as an empty or successfully saved document. */
export type RoomDocError =
    | "load_error"
    | "decrypt_error"
    | "invalid_update"
    | "incomplete_update"
    | "permission_error"
    | "send_error"
    | "too_large_error"
    | "anchor_error";

/** Observable transport state, independent of an editor or preview component. */
export interface RoomDocumentState {
    ready: boolean;
    canEdit: boolean;
    sync: "loading" | "saved" | "saving" | "offline" | "error";
    pendingUpdates: number;
    error?: RoomDocError;
}

interface Packet {
    frames: RoomDocFrame[];
    transactionIds: string[];
    next: number;
}
interface IncomingPacket {
    count: number;
    committed: boolean;
    parts: Map<number, Uint8Array>;
}
class DocumentError extends Error {
    public constructor(public readonly code: RoomDocError) {
        super(code);
    }
}

/** Use normal room send permissions; document creation never needs state-event permissions. */
export function canEditRoomDocument(client: MatrixClient, room: Room): boolean {
    return (
        room.getMyMembership() === "join" &&
        room.currentState.maySendEvent(ROOM_DOC_EVENT, client.getSafeUserId()) &&
        (!room.hasEncryptionStateEvent() ||
            (!!client.getCrypto() &&
                room.currentState.maySendEvent(EventType.RoomMessageEncrypted, client.getSafeUserId())))
    );
}

/** Stable user-facing document identifiers; the reserved catalog is never an editor route. */
export function isRoomDocumentId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        (value === "main" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    );
}

function validateTransportDocumentId(id: string): void {
    if (id !== "catalog" && !isRoomDocumentId(id)) throw new DocumentError("invalid_update");
}

/** Split oversized binary updates and commit only after every part has been acknowledged. */
export function documentFrames(update: Uint8Array, anchor: string, id: string, docId = "main"): RoomDocFrame[] {
    validateTransportDocumentId(docId);
    const count = Math.ceil(update.length / ROOM_DOC_CHUNK_BYTES);
    if (count < 1 || count > MAX_CHUNKS) throw new DocumentError("too_large_error");
    const common = {
        "version": 1 as const,
        "doc": docId,
        "update_id": id,
        "chunks": count,
        "m.relates_to": { rel_type: RelationType.Reference, event_id: anchor },
    };
    const frames: RoomDocFrame[] = Array.from({ length: count }, (_, chunk) => ({
        ...common,
        kind: count === 1 ? "update" : "chunk",
        chunk,
        data: encodeBase64(update.subarray(chunk * ROOM_DOC_CHUNK_BYTES, (chunk + 1) * ROOM_DOC_CHUNK_BYTES)),
    }));
    if (count > 1) frames.push({ ...common, kind: "commit" });
    return frames;
}

function readFrame(event: MatrixEvent, roomId: string, anchor: string, docId: string): RoomDocFrame | undefined {
    if (event.getRoomId() !== roomId || event.getType() !== ROOM_DOC_EVENT) return;
    const value = event.getContent();
    if (value.doc !== docId) return;
    if (
        event.isRedacted() ||
        value.version !== 1 ||
        typeof value.update_id !== "string" ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(value.update_id) ||
        !Number.isInteger(value.chunks) ||
        value.chunks < 1 ||
        value.chunks > MAX_CHUNKS ||
        !["update", "chunk", "commit"].includes(value.kind) ||
        !event.getSender() ||
        event.getRelation()?.rel_type !== RelationType.Reference ||
        event.getRelation()?.event_id !== anchor
    ) {
        throw new DocumentError("invalid_update");
    }
    if (value.kind === "commit") {
        if (value.data !== undefined || value.chunk !== undefined || value.chunks < 2)
            throw new DocumentError("invalid_update");
    } else if (
        !Number.isInteger(value.chunk) ||
        value.chunk < 0 ||
        value.chunk >= value.chunks ||
        typeof value.data !== "string" ||
        !value.data.length ||
        value.data.length > Math.ceil(ROOM_DOC_CHUNK_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data) ||
        (value.kind === "update" && (value.chunks !== 1 || value.chunk !== 0)) ||
        (value.kind === "chunk" && value.chunks < 2)
    )
        throw new DocumentError("invalid_update");
    return value as RoomDocFrame;
}

/** Retained editor session: failed/unacknowledged changes outlive a view unmount. */
export class RoomDocumentSession extends EventTarget {
    public readonly doc = new Y.Doc();
    public readonly text = this.doc.getText("markdown");
    private refs = 1;
    private disposed = false;
    private anchor?: string;
    private ready = false;
    private historyComplete = false;
    private loading = false;
    private error?: RoomDocError;
    private buffered: Uint8Array[] = [];
    private packets: Packet[] = [];
    private incoming = new Map<string, IncomingPacket>();
    private applied = new Set<string>();
    private seenEvents = new Set<string>();
    private liveQueue: MatrixEvent[] = [];
    private liveTask: Promise<void> = Promise.resolve();
    private loadTask?: Promise<void>;
    private flushTask?: Promise<void>;
    private timer?: ReturnType<typeof setTimeout>;

    public constructor(
        private readonly client: MatrixClient,
        private readonly room: Room,
        private readonly onUnused: () => void = () => {},
        private readonly docId = "main",
    ) {
        super();
        validateTransportDocumentId(docId);
        this.doc.on("update", this.onUpdate);
        client.on(RoomEvent.Timeline, this.onTimeline);
        client.on(MatrixEventEvent.Decrypted, this.onDecrypted);
        client.on(RoomStateEvent.Events, this.onState);
        client.on(RoomMemberEvent.Membership, this.onMembership);
        client.on(ClientEvent.Sync, this.onSync);
        window.addEventListener("beforeunload", this.beforeUnload);
    }

    /** Current permission, integrity, save state and unsent batch count. */
    public getState = (): RoomDocumentState => {
        const pendingUpdates = this.buffered.length + this.packets.length;
        const sync = this.loading
            ? "loading"
            : this.error
              ? this.error === "send_error" && this.client.getSyncState() === SyncState.Error
                  ? "offline"
                  : "error"
              : pendingUpdates > 0
                ? "saving"
                : "saved";
        return {
            ready: this.ready,
            canEdit: this.ready && !this.error && canEditRoomDocument(this.client, this.room),
            sync,
            pendingUpdates,
            error: this.error,
        };
    };

    private changed = (): void => {
        if (!this.disposed) this.dispatchEvent(new Event("change"));
    };
    private beforeUnload = (event: BeforeUnloadEvent): void => {
        if (this.buffered.length || this.packets.length) {
            event.preventDefault();
            event.returnValue = "";
        }
    };
    private onUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin !== REMOTE_ORIGIN) {
            this.buffered.push(update.slice());
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                void this.flush();
            }, 500);
        }
        this.changed();
    };
    private onTimeline = (event: MatrixEvent): void => {
        if (
            this.disposed ||
            event.getRoomId() !== this.room.roomId ||
            event.status ||
            event.getRelation()?.rel_type !== RelationType.Reference ||
            event.getRelation()?.event_id !== this.anchor
        )
            return;
        if (this.loading) this.liveQueue.push(event);
        else
            this.liveTask = this.liveTask
                .then(async () => {
                    await this.ingest(event);
                    if (this.hasMissingUpdates() && (!this.error || this.error === "incomplete_update")) {
                        this.error = "incomplete_update";
                        this.ready = false;
                    }
                    if (this.error === "incomplete_update" && !this.hasMissingUpdates() && this.historyComplete) {
                        this.error = undefined;
                        this.ready = true;
                    }
                    this.changed();
                })
                .catch((error) => this.fail(error));
    };
    private onDecrypted = (event: MatrixEvent): void => {
        // Fetching history itself decrypts events; it must not start another history load.
        if (this.loading || this.disposed || event.getRoomId() !== this.room.roomId) return;
        if (this.error === "decrypt_error") void this.retry();
        else this.onTimeline(event);
    };
    private onState = (event: MatrixEvent): void => {
        if (event.getRoomId() === this.room.roomId) this.permissionsChanged();
    };
    private onMembership = (_event: MatrixEvent, member: RoomMember): void => {
        if (member.roomId === this.room.roomId && member.userId === this.client.getSafeUserId())
            this.permissionsChanged();
    };
    private permissionsChanged = (): void => {
        if (!canEditRoomDocument(this.client, this.room) && (this.packets.length || this.buffered.length))
            this.error = "permission_error";
        this.changed();
    };
    private onSync = (state: SyncState, previous: SyncState | null): void => {
        if (
            (state === SyncState.Syncing || state === SyncState.Prepared) &&
            state !== previous &&
            this.error === "send_error"
        )
            void this.retry();
    };
    private fail = (error: unknown): void => {
        if (this.disposed) return;
        logger.warn("Unable to synchronize room document", error);
        this.error = error instanceof DocumentError ? error.code : "load_error";
        this.ready = false;
        this.changed();
    };

    private hasMissingUpdates = (): boolean =>
        // Yjs queues valid updates whose causal predecessors are absent. Never present that partial state as complete.
        this.doc.store.pendingStructs !== null ||
        this.doc.store.pendingDs !== null ||
        [...this.incoming.values()].some((packet) => packet.committed && packet.parts.size !== packet.count);

    private ingest = async (event: MatrixEvent, raw?: Partial<IEvent>): Promise<void> => {
        const id = event.getId();
        if (this.disposed || (id && this.seenEvents.has(id))) return;
        event = await decryptMatrixEventWithRetry(this.client, event, raw);
        if (this.disposed) return;
        if (event.isDecryptionFailure()) throw new DocumentError("decrypt_error");
        const frame = readFrame(event, this.room.roomId, this.anchor!, this.docId);
        if (!frame) {
            if (id) this.seenEvents.add(id);
            return;
        }
        const key = event.getSender() + ":" + frame.update_id;
        if (this.applied.has(key)) {
            if (id) this.seenEvents.add(id);
            return;
        }
        const packet = this.incoming.get(key) ?? {
            count: frame.chunks,
            committed: false,
            parts: new Map<number, Uint8Array>(),
        };
        if (packet.count !== frame.chunks) throw new DocumentError("invalid_update");
        if (frame.kind === "commit" || frame.kind === "update") packet.committed = true;
        if (frame.data !== undefined) {
            const bytes = decodeBase64(frame.data);
            if (!bytes.length || bytes.length > ROOM_DOC_CHUNK_BYTES) throw new DocumentError("invalid_update");
            const previous = packet.parts.get(frame.chunk!);
            if (
                previous &&
                (previous.length !== bytes.length || previous.some((value, index) => value !== bytes[index]))
            )
                throw new DocumentError("invalid_update");
            packet.parts.set(frame.chunk!, bytes);
        }
        this.incoming.set(key, packet);
        if (packet.committed && packet.parts.size === packet.count) {
            const size = [...packet.parts.values()].reduce((sum, part) => sum + part.length, 0);
            const update = new Uint8Array(size);
            let offset = 0;
            for (let index = 0; index < packet.count; index++) {
                const part = packet.parts.get(index)!;
                update.set(part, offset);
                offset += part.length;
            }
            const probe = new Y.Doc();
            try {
                probe.getText("markdown");
                Y.applyUpdate(probe, Y.encodeStateAsUpdate(this.doc));
                Y.applyUpdate(probe, update);
            } catch {
                throw new DocumentError("invalid_update");
            } finally {
                probe.destroy();
            }
            Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
            this.applied.add(key);
            this.incoming.delete(key);
        }
        if (id) this.seenEvents.add(id);
    };

    /** Replay every accessible document relation before enabling edits, retaining local unsent changes. */
    public retry = (): Promise<void> => {
        if (this.disposed) return Promise.resolve();
        if (this.loadTask) return this.loadTask;
        this.loading = true;
        this.ready = false;
        this.error = undefined;
        this.changed();
        this.loadTask = this.load().finally(() => {
            this.loadTask = undefined;
        });
        return this.loadTask;
    };
    private load = async (): Promise<void> => {
        try {
            await this.liveTask;
            if (this.room.getMyMembership() !== "join") throw new DocumentError("permission_error");
            const anchor = this.room.currentState.getStateEvents(EventType.RoomCreate, "")?.getId();
            if (!anchor) throw new DocumentError("anchor_error");
            this.anchor = anchor;
            const parent = await this.client.fetchRoomEvent(this.room.roomId, anchor);
            if (parent.type !== EventType.RoomCreate || (parent.room_id && parent.room_id !== this.room.roomId))
                throw new DocumentError("anchor_error");
            let from: string | undefined;
            const tokens = new Set<string>();
            do {
                if (this.disposed) return;
                if (this.room.getMyMembership() !== "join") throw new DocumentError("permission_error");
                const response = await this.client.fetchRelations(
                    this.room.roomId,
                    anchor,
                    RelationType.Reference,
                    null,
                    { dir: Direction.Backward, limit: 100, from },
                );
                for (const raw of response.chunk) {
                    if (raw.room_id && raw.room_id !== this.room.roomId) continue;
                    const wire = { ...raw, room_id: this.room.roomId };
                    await this.ingest(this.client.getEventMapper()(wire), wire);
                }
                from = response.next_batch;
                if (from && tokens.has(from)) throw new DocumentError("load_error");
                if (from) tokens.add(from);
            } while (from);
            while (this.liveQueue.length && !this.disposed) await this.ingest(this.liveQueue.shift()!);
            this.historyComplete = true;
            if (this.hasMissingUpdates()) throw new DocumentError("incomplete_update");
            this.ready = true;
        } catch (error) {
            this.fail(error);
        } finally {
            this.loading = false;
            this.changed();
            if (this.ready && (this.buffered.length || this.packets.length)) void this.flush();
            this.disposeIfUnused();
        }
    };

    /** Flush local changes; failures retain all frames and retry the same Matrix transaction IDs. */
    public flush = (): Promise<void> => {
        clearTimeout(this.timer);
        if (this.disposed || !this.ready || this.loading) return Promise.resolve();
        if (this.flushTask) return this.flushTask;
        this.flushTask = this.sendPending().finally(() => {
            this.flushTask = undefined;
            this.disposeIfUnused();
        });
        return this.flushTask;
    };
    private sendPending = async (): Promise<void> => {
        try {
            if (!canEditRoomDocument(this.client, this.room)) {
                if (this.buffered.length || this.packets.length) throw new DocumentError("permission_error");
                return;
            }
            this.error = undefined;
            while ((this.buffered.length || this.packets.length) && !this.disposed) {
                if (!this.packets.length) {
                    const update = Y.mergeUpdates(this.buffered);
                    const id = crypto.randomUUID();
                    const frames = documentFrames(update, this.anchor!, id, this.docId);
                    this.packets.push({
                        frames,
                        transactionIds: frames.map((_, index) => `matcha-doc.${id}.${index}`),
                        next: 0,
                    });
                    this.buffered = [];
                }
                const packet = this.packets[0];
                while (packet.next < packet.frames.length) {
                    if (!canEditRoomDocument(this.client, this.room)) throw new DocumentError("permission_error");
                    const txn = packet.transactionIds[packet.next];
                    let pending: MatrixEvent | undefined;
                    try {
                        pending = this.room.getPendingEvents().find((event) => event.getTxnId() === txn);
                    } catch {
                        pending = this.room
                            .getLiveTimeline()
                            .getEvents()
                            .find((event) => event.getTxnId() === txn);
                    }
                    if (
                        pending?.status === EventStatus.SENT ||
                        (pending && !pending.status && pending.getId()?.startsWith("$"))
                    ) {
                        // A prior attempt received a server acknowledgement before the caller resumed.
                    } else if (pending) await this.client.resendEvent(pending, this.room);
                    else await this.client.sendEvent(this.room.roomId, ROOM_DOC_EVENT, packet.frames[packet.next], txn);
                    packet.next++;
                }
                this.packets.shift();
                this.changed();
            }
        } catch (error) {
            logger.warn("Room document changes remain unsent", error);
            this.error = error instanceof DocumentError ? error.code : "send_error";
        } finally {
            this.changed();
        }
    };

    /** Acquire an existing room session while another view is closing or a retry is pending. */
    public retain = (): void => {
        this.refs++;
    };
    /** Flush on navigation; retain unsent work instead of destroying it with the editor. */
    public release = (): void => {
        this.refs = Math.max(0, this.refs - 1);
        void this.flush();
        this.disposeIfUnused();
    };
    private disposeIfUnused = (): void => {
        if (this.refs || this.buffered.length || this.packets.length || this.flushTask || this.disposed) return;
        this.disposed = true;
        clearTimeout(this.timer);
        this.client.off(RoomEvent.Timeline, this.onTimeline);
        this.client.off(MatrixEventEvent.Decrypted, this.onDecrypted);
        this.client.off(RoomStateEvent.Events, this.onState);
        this.client.off(RoomMemberEvent.Membership, this.onMembership);
        this.client.off(ClientEvent.Sync, this.onSync);
        window.removeEventListener("beforeunload", this.beforeUnload);
        this.doc.off("update", this.onUpdate);
        this.doc.destroy();
        this.onUnused();
    };
}

const sessions = new WeakMap<MatrixClient, Map<string, RoomDocumentSession>>();
/** Reuse pending sessions across editor unmounts without persisting document plaintext to disk. */
export function getRoomDocumentSession(client: MatrixClient, room: Room, docId = "main"): RoomDocumentSession {
    validateTransportDocumentId(docId);
    let rooms = sessions.get(client);
    if (!rooms) {
        rooms = new Map();
        sessions.set(client, rooms);
    }
    const key = JSON.stringify([room.roomId, docId]);
    let session = rooms.get(key);
    if (session) session.retain();
    else {
        session = new RoomDocumentSession(client, room, () => rooms.delete(key), docId);
        rooms.set(key, session);
        void session.retry();
    }
    return session;
}
