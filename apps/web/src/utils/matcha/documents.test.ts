/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
    EventStatus,
    EventType,
    MatrixEvent,
    MatrixEventEvent,
    Room,
    RoomEvent,
    type IEvent,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import {
    ROOM_DOC_EVENT,
    ROOM_DOC_CHUNK_BYTES,
    RoomDocumentSession,
    canEditRoomDocument,
    documentFrames,
    getRoomDocumentSession,
    type RoomDocFrame,
} from "./documents";

const roomId = "!docs:server";
const anchor = "$create";
let nextEvent = 0;
function wire(frame: RoomDocFrame, id = `$update${nextEvent++}`): IEvent {
    return {
        event_id: id,
        room_id: roomId,
        sender: "@alice:server",
        origin_server_ts: 1,
        type: ROOM_DOC_EVENT,
        content: frame,
        unsigned: {},
    };
}
// Vitest records only the last SDK overload (thread sends); validate the normal-send argument shape.
function documentCall(args: readonly unknown[]): { frame: RoomDocFrame; transactionId: string } {
    const content = args[2];
    const transactionId = args[3];
    if (
        args[1] !== ROOM_DOC_EVENT ||
        !content ||
        typeof content !== "object" ||
        !("version" in content) ||
        content.version !== 1 ||
        !("doc" in content) ||
        content.doc !== "main" ||
        !("kind" in content) ||
        typeof content.kind !== "string" ||
        !("update_id" in content) ||
        typeof content.update_id !== "string" ||
        typeof transactionId !== "string"
    )
        throw new Error("Expected a document event and explicit transaction ID");
    return { frame: content as RoomDocFrame, transactionId };
}
function updateFor(text: string): Uint8Array {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, text);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return update;
}

describe("room document transport", () => {
    let client: MatrixClient;
    let room: Room;
    let session: RoomDocumentSession;
    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(roomId, client, client.getSafeUserId());
        const create = new MatrixEvent({
            ...wire(documentFrames(updateFor(""), anchor, "unused")[0], anchor),
            type: EventType.RoomCreate,
            state_key: "",
            content: { creator: "@owner:server" },
        });
        room.currentState.setStateEvents([create]);
        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(room.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(room.currentState, "maySendStateEvent").mockReturnValue(false);
        vi.spyOn(client, "fetchRoomEvent").mockResolvedValue(create.event);
        client.fetchRelations = vi.fn<MatrixClient["fetchRelations"]>().mockResolvedValue({ chunk: [] });
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$sent" });
        session = new RoomDocumentSession(client, room);
    });
    afterEach(async () => {
        vi.mocked(room.getMyMembership).mockReturnValue(KnownMembership.Join);
        vi.mocked(room.currentState.maySendEvent).mockReturnValue(true);
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [] });
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$cleanup" });
        await session.flush();
        session.release();
        vi.restoreAllMocks();
    });

    it("replays every page, merges concurrent updates and ignores duplicate/unrelated events", async () => {
        const a = documentFrames(updateFor("Alice"), anchor, "a")[0];
        const b = documentFrames(updateFor("Bob"), anchor, "b")[0];
        const first = wire(a);
        vi.mocked(client.fetchRelations)
            .mockResolvedValueOnce({ chunk: [wire(b), first], next_batch: "older" })
            .mockResolvedValueOnce({ chunk: [first, { ...wire(a), type: "other.event" }] });
        await session.retry();
        expect(session.text.toJSON()).toContain("Alice");
        expect(session.text.toJSON()).toContain("Bob");
        expect(session.text.length).toBe(8);
        expect(session.getState()).toMatchObject({ ready: true, canEdit: true, sync: "saved", pendingUpdates: 0 });
        expect(client.fetchRelations).toHaveBeenCalledTimes(2);
        expect(client.fetchRelations).toHaveBeenLastCalledWith(roomId, anchor, "m.reference", null, {
            dir: "b",
            limit: 100,
            from: "older",
        });
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("does not allow editing before the final history page is available", async () => {
        let finish!: (value: { chunk: IEvent[] }) => void;
        vi.mocked(client.fetchRelations).mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        const loading = session.retry();
        await vi.waitFor(() => expect(client.fetchRelations).toHaveBeenCalledOnce());
        expect(session.getState()).toMatchObject({ ready: false, canEdit: false, sync: "loading" });
        finish({ chunk: [] });
        await loading;
        expect(session.getState().canEdit).toBe(true);
    });

    it("uses normal encrypted send permissions and never needs room state permission", async () => {
        await session.retry();
        expect(canEditRoomDocument(client, room)).toBe(true);
        session.text.insert(0, "Shared draft");
        await session.flush();
        expect(client.sendEvent).toHaveBeenCalledWith(
            roomId,
            ROOM_DOC_EVENT,
            expect.objectContaining({
                "version": 1,
                "doc": "main",
                "kind": "update",
                "m.relates_to": { rel_type: "m.reference", event_id: anchor },
            }),
            expect.stringMatching(/^matcha-doc\./),
        );
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(session.getState().pendingUpdates).toBe(0);
        vi.spyOn(room, "hasEncryptionStateEvent").mockReturnValue(true);
        vi.spyOn(client, "getCrypto").mockReturnValue(undefined);
        expect(canEditRoomDocument(client, room)).toBe(false);
    });

    it("retains failed changes and retries the exact Matrix transaction ID", async () => {
        await session.retry();
        vi.mocked(client.sendEvent).mockRejectedValueOnce(new Error("offline"));
        session.text.insert(0, "Do not lose this");
        await session.flush();
        expect(session.getState()).toMatchObject({ sync: "error", pendingUpdates: 1, error: "send_error" });
        const first = vi.mocked(client.sendEvent).mock.calls[0];
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await session.flush();
        expect(vi.mocked(client.sendEvent).mock.calls[1]).toEqual(first);
        expect(session.text.toJSON()).toBe("Do not lose this");
        expect(session.getState()).toMatchObject({ sync: "saved", pendingUpdates: 0 });
    });

    it("resends an SDK pending event instead of creating a duplicate local echo", async () => {
        await session.retry();
        vi.mocked(client.sendEvent).mockRejectedValueOnce(new Error("timeout"));
        session.text.insert(0, "Retry me");
        await session.flush();
        const call = documentCall(vi.mocked(client.sendEvent).mock.calls[0]);
        const pending = new MatrixEvent(wire(call.frame));
        pending.setTxnId(call.transactionId);
        pending.setStatus(EventStatus.NOT_SENT);
        vi.spyOn(room, "getPendingEvents").mockReturnValue([pending]);
        const resend = vi.spyOn(client, "resendEvent").mockResolvedValue({ event_id: "$retry" });
        await session.flush();
        expect(resend).toHaveBeenCalledWith(pending, room);
        expect(client.sendEvent).toHaveBeenCalledOnce();
        expect(session.getState().pendingUpdates).toBe(0);
    });

    it("keeps a pending session across navigation and releases it only after acknowledgement", async () => {
        session.release();
        session = getRoomDocumentSession(client, room);
        await session.retry();
        vi.mocked(client.sendEvent).mockRejectedValue(new Error("offline"));
        session.text.insert(0, "Retained across navigation");
        session.release();
        await session.flush();
        const reopened = getRoomDocumentSession(client, room);
        expect(reopened).toBe(session);
        expect(reopened.text.toJSON()).toBe("Retained across navigation");
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$recovered" });
        await reopened.flush();
        expect(reopened.getState().sync).toBe("saved");
    });

    it("keeps malformed updates from partially mutating the live document", async () => {
        const good = wire(documentFrames(updateFor("Safe original"), anchor, "good")[0]);
        const bad = wire(documentFrames(new Uint8Array([255, 255, 255]), anchor, "bad")[0]);
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [good, bad] });
        await session.retry();
        expect(session.text.toJSON()).toBe("Safe original");
        expect(session.getState()).toMatchObject({ ready: false, canEdit: false, error: "invalid_update" });
    });

    it("blocks editing on missing encryption keys rather than treating history as empty", async () => {
        const raw = wire(documentFrames(updateFor("Private"), anchor, "a")[0]);
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [raw] });
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
        });
        await session.retry();
        expect(session.text.toJSON()).toBe("");
        expect(session.getState()).toMatchObject({ ready: false, canEdit: false, error: "decrypt_error" });
    });

    it("ignores unfinished chunk uploads, then blocks a commit until all parts arrive", async () => {
        const body = "z".repeat(ROOM_DOC_CHUNK_BYTES * 2);
        const frames = documentFrames(updateFor(body), anchor, "large");
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [wire(frames[0])] });
        await session.retry();
        expect(session.getState().ready).toBe(true);
        expect(session.text.length).toBe(0);
        const emit = (frame: RoomDocFrame) =>
            client.emit(RoomEvent.Timeline, new MatrixEvent(wire(frame)), room, false, false, {
                timeline: room.getLiveTimeline(),
                liveEvent: true,
            });
        emit(frames.at(-1)!);
        await vi.waitFor(() => expect(session.getState().error).toBe("incomplete_update"));
        expect(session.getState().canEdit).toBe(false);
        for (const frame of frames.slice(1, -1)) emit(frame);
        await vi.waitFor(() => expect(session.text.toJSON()).toBe(body));
        expect(session.getState()).toMatchObject({ ready: true, canEdit: true, error: undefined });
    });

    it("writes a large update as bounded parts followed by a commit, retaining partial sends", async () => {
        await session.retry();
        vi.mocked(client.sendEvent)
            .mockResolvedValueOnce({ event_id: "$first" })
            .mockRejectedValueOnce(new Error("offline"));
        session.text.insert(0, "a".repeat(ROOM_DOC_CHUNK_BYTES * 2));
        await session.flush();
        expect(client.sendEvent).toHaveBeenCalledTimes(2);
        expect(session.getState().pendingUpdates).toBe(1);
        await session.flush();
        const calls = vi.mocked(client.sendEvent).mock.calls;
        expect(calls[1]).toEqual(calls[2]);
        expect(documentCall(calls.at(-1)!).frame.kind).toBe("commit");
        expect(calls.every((call) => JSON.stringify(documentCall(call).frame).length < 24000)).toBe(true);
        expect(session.getState().pendingUpdates).toBe(0);
    });

    it("does not restart history when its own decryption emits a callback", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [wire(documentFrames(updateFor("Once"), anchor, "one")[0])],
        });
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            client.emit(MatrixEventEvent.Decrypted, event);
        });
        await session.retry();
        expect(client.fetchRelations).toHaveBeenCalledOnce();
        expect(session.text.toJSON()).toBe("Once");
    });

    it("blocks edits when a complete Yjs update depends on missing history, then recovers when it arrives", async () => {
        const author = new Y.Doc();
        const updates: Uint8Array[] = [];
        author.on("update", (update: Uint8Array) => updates.push(update));
        author.getText("markdown").insert(0, "First");
        author.getText("markdown").insert(5, " and second");
        const first = wire(documentFrames(updates[0], anchor, "first")[0]);
        const second = wire(documentFrames(updates[1], anchor, "second")[0]);
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [second] });
        await session.retry();
        expect(session.text.toJSON()).toBe("");
        expect(session.getState()).toMatchObject({ ready: false, canEdit: false, error: "incomplete_update" });
        client.emit(RoomEvent.Timeline, new MatrixEvent(first), room, false, false, {
            timeline: room.getLiveTimeline(),
            liveEvent: true,
        });
        await vi.waitFor(() => expect(session.text.toJSON()).toBe("First and second"));
        expect(session.getState()).toMatchObject({ ready: true, canEdit: true, error: undefined });
        author.destroy();
    });

    it("keeps unsent edits recoverable when write permission is revoked", async () => {
        await session.retry();
        session.text.insert(0, "Recover this");
        vi.mocked(room.currentState.maySendEvent).mockReturnValue(false);
        await session.flush();
        expect(session.getState()).toMatchObject({ canEdit: false, error: "permission_error", pendingUpdates: 1 });
        expect(session.text.toJSON()).toBe("Recover this");
        expect(client.sendEvent).not.toHaveBeenCalled();
    });
});
