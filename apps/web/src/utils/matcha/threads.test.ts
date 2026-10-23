/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
    MatrixEvent,
    Room,
    RelationType,
    EventType,
    type IEvent,
    MatrixClient,
    type Thread,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { mkDecryptionFailureMatrixEvent } from "matrix-js-sdk/src/testing";
import { DecryptionFailureCode } from "matrix-js-sdk/src/crypto-api";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import {
    THREAD_ARCHIVE_EVENT,
    THREAD_METADATA_EVENT,
    canManageThreads,
    createNamedThread,
    readThreadMetadata,
    resolveThreadRoot,
    updateThreadMetadata,
    ThreadMetadataReadError,
    threadMetadataErrorKind,
} from "./threads";

const roomId = "!room:server";
function wire(id: string, type: string, content: Record<string, unknown>, timestamp = 1): IEvent {
    return {
        event_id: id,
        type,
        content,
        room_id: roomId,
        sender: "@alice:server",
        origin_server_ts: timestamp,
        unsigned: {},
    };
}
function revision(id: string, fields: Record<string, unknown>, timestamp = 1): IEvent {
    return wire(
        id,
        THREAD_METADATA_EVENT,
        { "version": 1, ...fields, "m.relates_to": { rel_type: RelationType.Reference, event_id: "$root" } },
        timestamp,
    );
}

describe("shared thread metadata", () => {
    let client: MatrixClient;
    let room: Room;
    let root: MatrixEvent;
    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(roomId, client, client.getSafeUserId());
        root = new MatrixEvent({
            ...wire("$root", EventType.RoomMessage, { msgtype: "m.text", body: "Original name" }),
            unsigned: { "m.relations": { "m.thread": { count: 1 } } },
        });
        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(room, "maySendMessage").mockReturnValue(true);
        vi.spyOn(room.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(room.currentState, "maySendStateEvent").mockReturnValue(false);
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        client.fetchRelations = vi.fn<MatrixClient["fetchRelations"]>().mockResolvedValue({ chunk: [] });
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$metadata" });
        vi.spyOn(room, "findEventById").mockImplementation((id) => (id === "$root" ? root : undefined));
    });
    afterEach(() => vi.restoreAllMocks());

    it("lets ordinary members rename/archive without state permission or plaintext state writes", async () => {
        expect(canManageThreads(client, room)).toBe(true);
        await updateThreadMetadata(client, room, root, { archived: true });
        await updateThreadMetadata(client, room, root, { name: "  Release planning  " });
        expect(client.sendEvent).toHaveBeenNthCalledWith(1, roomId, THREAD_METADATA_EVENT, {
            "version": 1,
            "archived": true,
            "m.relates_to": { rel_type: RelationType.Reference, event_id: "$root" },
        });
        expect(client.sendEvent).toHaveBeenNthCalledWith(2, roomId, THREAD_METADATA_EVENT, {
            "version": 1,
            "name": "Release planning",
            "m.relates_to": { rel_type: RelationType.Reference, event_id: "$root" },
        });
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(client.redactEvent).not.toHaveBeenCalled();
    });

    it.each([true, false])("preserves an explicit legacy archive decision %s", async (archived) => {
        room.currentState.setStateEvents([
            new MatrixEvent({ ...wire("$legacy", THREAD_ARCHIVE_EVENT, { archived }), state_key: "$root" }),
        ]);
        expect(await readThreadMetadata(client, room, root)).toEqual({
            name: "Original name",
            archived,
            archiveExplicit: true,
        });
    });

    it("distinguishes a shared restore from the default active state", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [revision("$restore", { archived: false })] });
        expect(await readThreadMetadata(client, room, root)).toEqual({
            name: "Original name",
            archived: false,
            archiveExplicit: true,
        });
    });

    it("combines latest independent fields across server-ordered pages rather than sender timestamps", async () => {
        vi.mocked(client.fetchRelations)
            .mockResolvedValueOnce({ chunk: [revision("$new-name", { name: "Renamed" }, 1)], next_batch: "older" })
            .mockResolvedValueOnce({
                chunk: [revision("$old-name", { name: "Stale" }, 999), revision("$archive", { archived: true })],
            });
        expect(await readThreadMetadata(client, room, root)).toEqual({
            name: "Renamed",
            archived: true,
            archiveExplicit: true,
        });
        expect(client.fetchRelations).toHaveBeenCalledTimes(2);
        expect(client.fetchRelations).toHaveBeenLastCalledWith(
            roomId,
            "$root",
            RelationType.Reference,
            null,
            expect.objectContaining({ from: "older" }),
        );
    });

    it("rejects incomplete or undecryptable history instead of guessing an older archive flag", async () => {
        vi.mocked(client.fetchRelations).mockImplementation(async (_room, _root, _relation, _type, options) => ({
            chunk: [revision("$name", { name: "Recent" })],
            next_batch: (options?.from ?? "") + "x",
        }));
        await expect(readThreadMetadata(client, room, root)).rejects.toThrow("incomplete");
        expect(client.fetchRelations).toHaveBeenCalledTimes(3);
        vi.mocked(client.fetchRelations).mockResolvedValue({ chunk: [revision("$unreadable", { archived: true })] });
        vi.mocked(client.decryptEventIfNeeded).mockResolvedValueOnce().mockRejectedValueOnce(new Error("Missing keys"));
        await expect(readThreadMetadata(client, room, root)).rejects.toThrow("Missing keys");
    });

    it("ignores malformed/unrelated metadata without executing its content", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [
                revision("$bad-name", { name: " ", archived: "yes" }),
                wire("$other", THREAD_METADATA_EVENT, {
                    "version": 1,
                    "name": "Unrelated",
                    "archived": true,
                    "m.relates_to": { rel_type: RelationType.Reference, event_id: "$other-root" },
                }),
            ],
        });
        expect(await readThreadMetadata(client, room, root)).toEqual({ name: "Original name", archived: false });
    });

    it("retries actual SDK cached failed roots and metadata using original ciphertext after keys become available", async () => {
        const cachedRoot = await mkDecryptionFailureMatrixEvent({
            roomId,
            sender: "@alice:server",
            eventId: "$root",
            code: DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP,
            msg: "Missing historical key",
        });
        const cachedMetadata = await mkDecryptionFailureMatrixEvent({
            roomId,
            sender: "@alice:server",
            eventId: "$metadata",
            code: DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP,
            msg: "Missing historical key",
        });
        cachedRoot.event.content = { ...cachedRoot.getWireContent(), ciphertext: "root-ciphertext" };
        cachedMetadata.event.content = {
            ...cachedMetadata.getWireContent(),
            "m.relates_to": { rel_type: RelationType.Reference, event_id: "$root" },
        };
        const rawMetadata = {
            ...cachedMetadata.event,
            content: { ...cachedMetadata.getWireContent(), ciphertext: "fresh-metadata-ciphertext" },
        };
        const sdk = new MatrixClient({ baseUrl: "https://server", userId: "@alice:server" });
        let keysAvailable = false;
        const decrypt = vi.fn(async (event: MatrixEvent) => {
            if (!keysAvailable) throw new Error("Key remains unavailable");
            return {
                clearEvent:
                    event.getId() === "$root"
                        ? { type: EventType.RoomMessage, content: { msgtype: "m.text", body: "Original title" } }
                        : {
                              type: THREAD_METADATA_EVENT,
                              content: revision("$metadata", { name: "Recovered", archived: true }).content,
                          },
            };
        });
        // Inject only the backend in this SDK lifecycle test; application code never accesses it.
        Reflect.set(sdk, "cryptoBackend", { decryptEvent: decrypt });
        vi.spyOn(sdk, "getRoom").mockReturnValue(room);
        vi.mocked(room.findEventById).mockImplementation((id) => (id === "$root" ? cachedRoot : cachedMetadata));
        vi.spyOn(sdk, "fetchRelations").mockResolvedValue({ chunk: [rawMetadata as IEvent] });
        expect(sdk.getEventMapper()({ ...rawMetadata, room_id: roomId })).toBe(cachedMetadata);
        await sdk.decryptEventIfNeeded(cachedRoot);
        expect(decrypt).not.toHaveBeenCalled();
        expect(cachedRoot.shouldAttemptDecryption()).toBe(false);

        await expect(readThreadMetadata(sdk, room, cachedRoot)).rejects.toMatchObject({ kind: "decryption" });
        expect(sdk.fetchRelations).not.toHaveBeenCalled();
        expect(decrypt).toHaveBeenCalledTimes(1);
        vi.spyOn(room, "getThread").mockReturnValue({ id: "$root", rootEvent: cachedRoot } as Thread);
        expect((await resolveThreadRoot(sdk, room, "$root")).isDecryptionFailure()).toBe(true);
        expect(decrypt).toHaveBeenCalledTimes(2);
        keysAvailable = true;

        expect(await readThreadMetadata(sdk, room, cachedRoot)).toEqual({
            name: "Recovered",
            archived: true,
            archiveExplicit: true,
        });
        expect(decrypt).toHaveBeenCalledTimes(4);
        expect(decrypt.mock.calls[3][0].getWireContent().ciphertext).toBe("fresh-metadata-ciphertext");
        expect(cachedRoot.isDecryptionFailure()).toBe(true);
        expect(cachedMetadata.isDecryptionFailure()).toBe(true);
    });

    it("keeps missing keys, failed decryption, history limits, access and network errors distinct", () => {
        expect(threadMetadataErrorKind(new ThreadMetadataReadError("keys", "Unavailable"))).toBe("keys");
        expect(threadMetadataErrorKind(new ThreadMetadataReadError("decryption", "Untrusted"))).toBe("decryption");
        expect(threadMetadataErrorKind(new ThreadMetadataReadError("history", "Incomplete"))).toBe("history");
        expect(threadMetadataErrorKind({ errcode: "M_FORBIDDEN" })).toBe("access");
        expect(threadMetadataErrorKind({ httpStatus: 404 })).toBe("access");
        expect(threadMetadataErrorKind(new Error("Offline"))).toBe("network");
    });

    it("validates actual same-room roots and rejects ordinary unthreaded messages", async () => {
        expect(await resolveThreadRoot(client, room, "$root")).toBe(root);
        vi.mocked(room.findEventById).mockReturnValue(
            new MatrixEvent(wire("$root", EventType.RoomMessage, { body: "Not a thread" })),
        );
        await expect(resolveThreadRoot(client, room, "$root")).rejects.toThrow("Not a thread root");
        vi.mocked(room.findEventById).mockReturnValue(new MatrixEvent({ ...root.event, room_id: "!elsewhere:server" }));
        await expect(resolveThreadRoot(client, room, "$root")).rejects.toThrow("Not a thread root");
    });

    it("refuses writes when membership, encryption readiness, names or event permissions disallow them", async () => {
        await expect(updateThreadMetadata(client, room, root, { name: " " })).rejects.toThrow("Invalid");
        vi.spyOn(room, "hasEncryptionStateEvent").mockReturnValue(true);
        vi.spyOn(client, "getCrypto").mockReturnValue(undefined);
        expect(canManageThreads(client, room)).toBe(false);
        await expect(updateThreadMetadata(client, room, root, { archived: true })).rejects.toThrow("Cannot manage");
        vi.mocked(room.getMyMembership).mockReturnValue(KnownMembership.Leave);
        await expect(resolveThreadRoot(client, room, "$root")).rejects.toThrow("unavailable");
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("creates one named root and one hidden native threaded event so the server can list it", async () => {
        vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$created" });
        vi.mocked(client.fetchRoomEvent).mockResolvedValue(
            wire("$created", EventType.RoomMessage, { msgtype: "m.text", body: "Launch" }),
        );
        vi.spyOn(room, "createThread").mockReturnValue({ id: "$created" } as Thread);
        const created = await createNamedThread(client, room, " Launch ");
        expect(created.getId()).toBe("$created");
        expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith(roomId, { msgtype: "m.text", body: "Launch" });
        expect(client.sendEvent).toHaveBeenCalledExactlyOnceWith(roomId, "$created", THREAD_METADATA_EVENT, {
            version: 1,
            name: "Launch",
            archived: false,
        });
        expect(room.createThread).toHaveBeenCalled();
    });
});
