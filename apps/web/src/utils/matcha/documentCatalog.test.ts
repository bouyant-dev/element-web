/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EventType, MatrixEvent, Room, RoomEvent, type IEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { documentFrames, ROOM_DOC_EVENT } from "./documents";
import { SpaceDocumentCatalog, validSpaceDocumentName } from "./documentCatalog";

const roomId = "!space:server";
const anchor = "$create";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

function catalogEvent(entries: Record<string, unknown>, eventId: string): IEvent {
    const doc = new Y.Doc();
    const map = doc.getMap("documents");
    for (const [id, value] of Object.entries(entries)) map.set(id, value);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return {
        event_id: eventId,
        room_id: roomId,
        sender: "@alice:server",
        origin_server_ts: 1,
        type: ROOM_DOC_EVENT,
        unsigned: {},
        content: documentFrames(update, anchor, eventId.slice(1), "catalog")[0],
    };
}

describe("encrypted Space document catalog", () => {
    let client: MatrixClient;
    let space: Room;
    const catalogs: SpaceDocumentCatalog[] = [];
    function open(): SpaceDocumentCatalog {
        const catalog = new SpaceDocumentCatalog(client, space);
        catalogs.push(catalog);
        return catalog;
    }

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        space = new Room(roomId, client, client.getSafeUserId());
        const create = new MatrixEvent({
            event_id: anchor,
            room_id: roomId,
            type: EventType.RoomCreate,
            state_key: "",
            content: { creator: "@owner:server", type: "m.space" },
        });
        space.currentState.setStateEvents([create]);
        vi.spyOn(space, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(space, "hasEncryptionStateEvent").mockReturnValue(true);
        vi.spyOn(space.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(client, "getCrypto").mockReturnValue({} as NonNullable<ReturnType<MatrixClient["getCrypto"]>>);
        vi.spyOn(client, "fetchRoomEvent").mockResolvedValue(create.event);
        client.fetchRelations = vi.fn<MatrixClient["fetchRelations"]>().mockResolvedValue({ chunk: [] });
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$sent" });
    });

    afterEach(async () => {
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$cleanup" });
        vi.mocked(space.getMyMembership).mockReturnValue(KnownMembership.Join);
        vi.mocked(space.currentState.maySendEvent).mockReturnValue(true);
        for (const catalog of catalogs.splice(0)) {
            await catalog.retry();
            catalog.release();
        }
        vi.restoreAllMocks();
    });

    it("retains the existing main document without writing anything and refuses plaintext creation", async () => {
        vi.mocked(space.hasEncryptionStateEvent).mockReturnValue(false);
        const catalog = open();
        await catalog.retry();
        expect(catalog.getState()).toMatchObject({
            ready: true,
            canEdit: false,
            documents: [{ id: "main", createdAt: 0 }],
        });
        await expect(catalog.create("Private title")).rejects.toThrow("permission_error");
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("replays paginated concurrent entries, deduplicates and discovers live creations", async () => {
        const first = catalogEvent({ [firstId]: { title: "First", createdAt: 10 } }, "$first");
        const second = catalogEvent({ [secondId]: { title: "Second", createdAt: 20 } }, "$second");
        vi.mocked(client.fetchRelations)
            .mockResolvedValueOnce({ chunk: [second], next_batch: "older" })
            .mockResolvedValueOnce({ chunk: [first, second] });
        const catalog = open();
        await catalog.retry();
        expect(catalog.getState().documents.map((entry) => entry.id)).toEqual(["main", firstId, secondId]);
        expect(catalog.getState().canEdit).toBe(true);
        expect(client.fetchRelations).toHaveBeenCalledTimes(2);
        const renamedMain = catalogEvent({ main: { title: "Welcome", createdAt: 0 } }, "$main");
        client.emit(RoomEvent.Timeline, new MatrixEvent(renamedMain), space, false, false, {
            timeline: space.getLiveTimeline(),
            liveEvent: true,
        });
        await vi.waitFor(() => expect(catalog.getState().documents[0].title).toBe("Welcome"));
    });

    it("waits for the create acknowledgement, shares titles between views, and preserves IDs on rename", async () => {
        const catalog = open();
        const otherView = open();
        await catalog.retry();
        let acknowledge!: (value: { event_id: string }) => void;
        vi.mocked(client.sendEvent).mockReturnValueOnce(
            new Promise((resolve) => {
                acknowledge = resolve;
            }),
        );
        let completed = false;
        const creation = catalog.create("  Project notes  ").then((id) => {
            completed = true;
            return id;
        });
        await vi.waitFor(() => expect(client.sendEvent).toHaveBeenCalledOnce());
        expect(completed).toBe(false);
        expect(catalog.getState().sync).toBe("saving");
        acknowledge({ event_id: "$new" });
        const id = await creation;
        expect(otherView.getState().documents.find((entry) => entry.id === id)?.title).toBe("Project notes");
        await catalog.rename(id, "Renamed notes");
        expect(otherView.getState().documents.find((entry) => entry.id === id)?.title).toBe("Renamed notes");
        expect(catalog.getState().documents).toHaveLength(2);
        expect(client.sendEvent).toHaveBeenCalledWith(
            roomId,
            ROOM_DOC_EVENT,
            expect.objectContaining({
                "doc": "catalog",
                "m.relates_to": { rel_type: "m.reference", event_id: anchor },
            }),
            expect.any(String),
        );
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("keeps failed catalog writes across navigation and retries the same transaction", async () => {
        const catalog = open();
        await catalog.retry();
        vi.mocked(client.sendEvent).mockRejectedValue(new Error("offline"));
        await expect(catalog.create("Keep this document")).rejects.toThrow("send_error");
        const firstSend = vi.mocked(client.sendEvent).mock.calls[0];
        catalog.release();
        const reopened = open();
        expect(reopened.getState().documents.some((entry) => entry.title === "Keep this document")).toBe(true);
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$retried" });
        await reopened.retry();
        expect(vi.mocked(client.sendEvent).mock.calls.at(-1)).toEqual(firstSend);
        expect(reopened.getState()).toMatchObject({ ready: true, sync: "saved", pendingUpdates: 0 });
    });

    it.each(["", "   ", "x".repeat(101)])(
        "rejects invalid names and unknown IDs before changing the catalog: %s",
        async (title) => {
            const catalog = open();
            await catalog.retry();
            expect(validSpaceDocumentName(title)).toBe(false);
            await expect(catalog.create(title)).rejects.toThrow("invalid_update");
            await expect(catalog.rename(firstId, "Unknown")).rejects.toThrow("invalid_update");
            expect(client.sendEvent).not.toHaveBeenCalled();
            expect(catalog.getState().documents).toEqual([{ id: "main", createdAt: 0 }]);
        },
    );

    it("fails closed for malformed metadata instead of enabling edits from a partial catalog", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [catalogEvent({ [firstId]: { title: "", createdAt: 1 } }, "$invalid")],
        });
        const catalog = open();
        await catalog.retry();
        expect(catalog.getState()).toMatchObject({ ready: false, canEdit: false, error: "invalid_update" });
        await expect(catalog.create("New")).rejects.toThrow("invalid_update");
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("does not interpret missing decryption keys as an empty catalog", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [catalogEvent({ [firstId]: { title: "Secret", createdAt: 1 } }, "$encrypted")],
        });
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
        });
        const catalog = open();
        await catalog.retry();
        expect(catalog.getState()).toMatchObject({ ready: false, canEdit: false, error: "decrypt_error" });
        await expect(catalog.create("New")).rejects.toThrow("decrypt_error");
        expect(client.sendEvent).not.toHaveBeenCalled();
    });
});
