/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    Direction,
    EventType,
    type MatrixEvent,
    MsgType,
    RelationType,
    type MatrixClient,
    type Room,
} from "matrix-js-sdk/src/matrix";

/** Legacy state events remain readable; new revisions use encrypted timeline events. */
export const THREAD_ARCHIVE_EVENT = "com.matchahoneylatte.thread_archive";
/** Shared thread name/archive patches related to their native thread root. */
export const THREAD_METADATA_EVENT = "com.matchahoneylatte.thread.metadata";
/** Maximum user-provided thread name length. */
export const THREAD_NAME_LIMIT = 100;

/** Independently updated fields prevent renaming from overwriting an archive action. */
export interface ThreadMetadataPatch {
    name?: string;
    archived?: boolean;
}

/** Resolved thread metadata, including legacy defaults when no revision exists. */
export interface ThreadMetadata {
    name: string;
    archived: boolean;
}

/** Normal joined members can manage metadata when their room permits these events. */
export function canManageThreads(client: MatrixClient, room: Room): boolean {
    return (
        room.getMyMembership() === "join" &&
        room.currentState.maySendEvent(THREAD_METADATA_EVENT, client.getSafeUserId()) &&
        (!room.hasEncryptionStateEvent() ||
            (!!client.getCrypto() &&
                room.currentState.maySendEvent(EventType.RoomMessageEncrypted, client.getSafeUserId())))
    );
}

/** Validate names at the persistence boundary as well as in the input dialog. */
export function validThreadName(name: unknown): name is string {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= THREAD_NAME_LIMIT;
}

/** Resolve only same-room native thread roots, including server threads not locally loaded. */
export async function resolveThreadRoot(client: MatrixClient, room: Room, id: string): Promise<MatrixEvent> {
    if (!id.startsWith("$") || room.getMyMembership() !== "join") throw new Error("Thread unavailable");
    let root = room.getThread(id)?.rootEvent ?? room.findEventById(id);
    if (!root) {
        const raw = await client.fetchRoomEvent(room.roomId, id);
        if (raw.room_id && raw.room_id !== room.roomId) throw new Error("Thread belongs to another room");
        root = client.getEventMapper()({ ...raw, room_id: room.roomId });
    }
    await client.decryptEventIfNeeded(root);
    if (
        root.getRoomId() !== room.roomId ||
        root.getId() !== id ||
        root.isState() ||
        (root.threadRootId && root.threadRootId !== id)
    )
        throw new Error("Not a thread root");
    if (room.getThread(id) || root.isThreadRoot) return root;
    const replies = await client.fetchRelations(room.roomId, id, RelationType.Thread, null, {
        dir: Direction.Backward,
        limit: 1,
    });
    if (
        !replies.chunk.some(
            (reply) =>
                reply.content?.["m.relates_to"]?.event_id === id &&
                reply.content?.["m.relates_to"]?.rel_type === RelationType.Thread,
        )
    )
        throw new Error("Not a thread root");
    return root;
}

/** Read bounded, server-ordered revisions; refuse to silently guess when history or keys are missing. */
export async function readThreadMetadata(client: MatrixClient, room: Room, root: MatrixEvent): Promise<ThreadMetadata> {
    const id = root.getId();
    if (!id || root.getRoomId() !== room.roomId) throw new Error("Thread belongs to another room");
    await client.decryptEventIfNeeded(root);
    if (root.isDecryptionFailure()) throw new Error("Thread name could not be decrypted");
    const body = root.getContent().body;
    const fallback =
        typeof body === "string" && body.trim() ? body.replace(/\s+/g, " ").slice(0, THREAD_NAME_LIMIT) : id;
    let name: string | undefined;
    let archived: boolean | undefined;
    let from: string | undefined;
    for (let page = 0; page < 3; page++) {
        if (room.getMyMembership() !== "join") throw new Error("Thread unavailable");
        const response = await client.fetchRelations(room.roomId, id, RelationType.Reference, null, {
            dir: Direction.Backward,
            limit: 100,
            from,
        });
        for (const raw of response.chunk) {
            if (raw.room_id && raw.room_id !== room.roomId) continue;
            const event = client.getEventMapper()({ ...raw, room_id: room.roomId });
            await client.decryptEventIfNeeded(event);
            if (event.isDecryptionFailure()) throw new Error("Thread metadata could not be decrypted");
            const content = event.getContent();
            if (
                event.isRedacted() ||
                event.getType() !== THREAD_METADATA_EVENT ||
                content.version !== 1 ||
                event.getRelation()?.rel_type !== RelationType.Reference ||
                event.getRelation()?.event_id !== id
            )
                continue;
            if (name === undefined && validThreadName(content.name)) name = content.name.trim();
            if (archived === undefined && typeof content.archived === "boolean") archived = content.archived;
            if (name !== undefined && archived !== undefined) return { name, archived };
        }
        if (!response.next_batch)
            return {
                name: name ?? fallback,
                archived:
                    archived ??
                    room.currentState.getStateEvents(THREAD_ARCHIVE_EVENT, id)?.getContent().archived === true,
            };
        if (response.next_batch === from) throw new Error("Thread metadata pagination did not advance");
        from = response.next_batch;
    }
    throw new Error("Thread metadata history is incomplete; refresh before managing this thread");
}

/** Persist only the requested fields; Matrix transparently encrypts metadata in encrypted rooms. */
export async function updateThreadMetadata(
    client: MatrixClient,
    room: Room,
    root: MatrixEvent,
    patch: ThreadMetadataPatch,
): Promise<void> {
    if (!canManageThreads(client, room) || root.getRoomId() !== room.roomId || !root.getId())
        throw new Error("Cannot manage this thread");
    if (
        (patch.name !== undefined && !validThreadName(patch.name)) ||
        (patch.archived !== undefined && typeof patch.archived !== "boolean") ||
        (patch.name === undefined && patch.archived === undefined)
    )
        throw new Error("Invalid thread metadata");
    await client.sendEvent(room.roomId, THREAD_METADATA_EVENT, {
        "version": 1,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        "m.relates_to": { rel_type: RelationType.Reference, event_id: root.getId() },
    });
}

/** Create a discoverable native thread without adding a duplicate visible starter message. */
export async function createNamedThread(client: MatrixClient, room: Room, name: string): Promise<MatrixEvent> {
    if (!validThreadName(name) || !canManageThreads(client, room) || !room.maySendMessage())
        throw new Error("Cannot create thread");
    const { event_id: id } = await client.sendMessage(room.roomId, { msgtype: MsgType.Text, body: name.trim() });
    const raw = await client.fetchRoomEvent(room.roomId, id);
    const root = client.getEventMapper()({ ...raw, room_id: room.roomId });
    await client.decryptEventIfNeeded(root);
    try {
        // A zero-reply thread is only local SDK state; this hidden native reply survives a client reload.
        await client.sendEvent(room.roomId, id, THREAD_METADATA_EVENT, {
            version: 1,
            name: name.trim(),
            archived: false,
        });
    } catch {
        throw new Error("The first message was sent, but thread setup failed. Open it in General and reply in thread.");
    }
    if (!room.getThread(id)) room.createThread(id, root, [root], true);
    return root;
}
