/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MatrixEvent,
    Room,
    RelationType,
    RoomMemberEvent,
    ClientEvent,
    MatrixEventEvent,
    type MatrixClient,
    type RoomMember,
    type IEvent,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { KanbanBoardViewModel, KANBAN_STATE_EVENT, KANBAN_CARD_EVENT, KANBAN_ROOT_EVENT } from "./KanbanBoardViewModel";
import Modal from "../../Modal";
import dispatcher from "../../dispatcher/dispatcher";

describe("KanbanBoardViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let vm: KanbanBoardViewModel | undefined;
    let events: IEvent[];

    const revision = (
        id: string,
        title: string,
        changes: Record<string, unknown> = {},
        roomId = "!room:server",
    ): IEvent => ({
        event_id: "$" + id + title,
        sender: "@user:server",
        origin_server_ts: 1,
        unsigned: {},
        room_id: roomId,
        type: KANBAN_CARD_EVENT,
        content: {
            "version": 1,
            "card_id": id,
            title,
            "description": "",
            "column": "todo",
            "archived": false,
            "m.relates_to": { rel_type: RelationType.Reference, event_id: "$board" },
            ...changes,
        },
    });

    function makeRoom(id = "!room:server"): Room {
        const result = new Room(id, client, client.getSafeUserId());
        result.name = "Project chat";
        vi.spyOn(result, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(result.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(result.currentState, "maySendStateEvent").mockReturnValue(true);
        result.currentState.setStateEvents([
            new MatrixEvent({
                room_id: id,
                type: KANBAN_STATE_EVENT,
                state_key: "",
                content: { version: 1, event_id: "$board" },
            }),
        ]);
        return result;
    }

    beforeEach(() => {
        client = stubClient();
        room = makeRoom();
        events = [revision("one", "Plan release")];
        vi.mocked(client.getRooms).mockReturnValue([room]);
        vi.mocked(client.getRoom).mockImplementation((id) => (id === room.roomId ? room : null));
        client.fetchRelations = vi.fn().mockImplementation(async () => ({ chunk: events }));
        client.getStateEvent = vi.fn().mockResolvedValue({ version: 1, event_id: "$board" });
        vi.spyOn(client, "getEventMapper").mockReturnValue((raw) => new MatrixEvent(raw));
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.mocked(client.sendEvent).mockImplementation(async (roomId, type, content) => {
            events.unshift({
                room_id: roomId,
                event_id: "$new",
                sender: "@user:server",
                origin_server_ts: 2,
                unsigned: {},
                type: String(type),
                content: typeof content === "object" ? content : {},
            });
            return { event_id: "$new" };
        });
    });

    afterEach(() => {
        vm?.dispose();
        vm = undefined;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("loads newest server-ordered card revisions and paginates without replacing them with older values", async () => {
        vi.mocked(client.fetchRelations).mockImplementation(async (_room, _root, _relation, _type, options) =>
            options?.from
                ? { chunk: [revision("one", "Old title"), revision("two", "Older card")] }
                : { chunk: [revision("one", "Latest", { column: "doing" })], next_batch: "older" },
        );
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({
            hasMore: true,
            cards: [{ id: "one", title: "Latest", column: "doing" }],
        });
        await vm.loadMore();
        expect(vm.getSnapshot().cards.map((card) => card.title)).toEqual(["Latest", "Older card"]);
        expect(vm.getSnapshot().hasMore).toBe(false);
    });

    it("creates, edits, moves, archives and restores through timeline events without card content in room state", async () => {
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        vm.edit();
        vm.setTitle("  New card  ");
        vm.setDescription("Private description");
        await vm.save();
        expect(client.sendEvent).toHaveBeenLastCalledWith(
            room.roomId,
            KANBAN_CARD_EVENT,
            expect.objectContaining({
                "title": "New card",
                "description": "Private description",
                "column": "todo",
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$board" },
            }),
        );
        expect(vm.getSnapshot().editor).toBeUndefined();
        const card = vm.getSnapshot().cards.find((card) => card.title === "New card")!;
        vm.edit(card);
        vm.setTitle("Updated");
        await vm.save();
        await vm.move(card, "doing");
        expect(client.sendEvent).toHaveBeenLastCalledWith(
            room.roomId,
            KANBAN_CARD_EVENT,
            expect.objectContaining({ title: "Updated", column: "doing" }),
        );
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([true]),
            close: vi.fn(),
        } as ReturnType<typeof Modal.createDialog>);
        await vm.archive(card, true);
        expect(vm.getSnapshot().cards.find((item) => item.id === card.id)?.archived).toBe(true);
        await vm.archive(card, false);
        expect(vm.getSnapshot().cards.find((item) => item.id === card.id)?.archived).toBe(false);
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(client.redactEvent).not.toHaveBeenCalled();
    });

    it("only writes an identifier to room state when creating the board", async () => {
        vi.spyOn(room.currentState, "getStateEvents").mockReturnValue(null);
        vi.mocked(client.sendStateEvent).mockResolvedValue({ event_id: "$state" });
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        await vm.createBoard();
        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, KANBAN_ROOT_EVENT, { version: 1 });
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            room.roomId,
            KANBAN_STATE_EVENT,
            { version: 1, event_id: "$new" },
            "",
        );
        expect(vm.getSnapshot().initialized).toBe(true);
    });

    it("uses SDK decryption before reading custom card data and disables encrypted writes without crypto", async () => {
        vi.spyOn(room, "hasEncryptionStateEvent").mockReturnValue(true);
        events = [
            {
                event_id: "$encrypted",
                sender: "@user:server",
                origin_server_ts: 3,
                unsigned: {},
                room_id: room.roomId,
                type: "m.room.encrypted",
                content: { ciphertext: "encrypted" },
            },
        ];
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            vi.spyOn(event, "getType").mockReturnValue(KANBAN_CARD_EVENT);
            vi.spyOn(event, "getContent").mockReturnValue(revision("one", "Decrypted").content!);
            vi.spyOn(event, "getRelation").mockReturnValue({ rel_type: RelationType.Reference, event_id: "$board" });
        });
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards[0].title).toBe("Decrypted");
        vi.mocked(client.getCrypto).mockReturnValue(undefined);
        await vm.move(vm.getSnapshot().cards[0], "done");
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("warns when encrypted revisions are unreadable, and skips invalid or unrelated content", async () => {
        events = [
            revision("one", "", {}),
            revision("two", "Other board", {
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$other" },
            }),
            revision("three", "Broken", { column: "unknown" }),
            revision("four", "Encrypted failure"),
        ];
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            if (event.getContent().card_id === "four") vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
        });
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ cards: [], unreadable: true });
    });

    it("includes only joined rooms in the recap and removes a room immediately after leaving", async () => {
        const left = makeRoom("!left:server");
        vi.mocked(left.getMyMembership).mockReturnValue(KnownMembership.Leave);
        vi.mocked(client.getRooms).mockReturnValue([room, left]);
        vm = new KanbanBoardViewModel({ client });
        await vm.reload();
        expect(client.fetchRelations).not.toHaveBeenCalledWith(
            left.roomId,
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
        expect(vm.getSnapshot().cards).toHaveLength(1);
        vi.mocked(room.getMyMembership).mockReturnValue(KnownMembership.Leave);
        client.emit(
            RoomMemberEvent.Membership,
            new MatrixEvent({}),
            { userId: client.getSafeUserId() } as RoomMember,
            KnownMembership.Join,
        );
        expect(vm.getSnapshot().cards).toEqual([]);
        const dispatch = vi.spyOn(dispatcher, "dispatch");
        vm.openRoom(left.roomId);
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("checks permission again before writes and retains drafts after failures", async () => {
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        vm.edit();
        vm.setTitle("Keep this draft");
        vi.mocked(client.getStateEvent).mockRejectedValue(new Error("offline"));
        await vm.save();
        expect(vm.getSnapshot()).toMatchObject({ editor: { title: "Keep this draft" }, error: expect.any(String) });
        vi.mocked(room.currentState.maySendEvent).mockReturnValue(false);
        await vm.save();
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("does not create a board without state permissions, or archive after cancelled confirmation", async () => {
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        vi.mocked(room.currentState.maySendStateEvent).mockReturnValue(false);
        await vm.createBoard();
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([false]),
            close: vi.fn(),
        } as ReturnType<typeof Modal.createDialog>);
        await vm.archive(vm.getSnapshot().cards[0], true);
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("shows partial failure instead of presenting an empty successful recap", async () => {
        vi.mocked(client.fetchRelations).mockRejectedValue(new Error("offline"));
        vm = new KanbanBoardViewModel({ client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ loading: false, error: expect.any(String) });
    });

    it("refreshes synced revisions without looping when fetching and decrypting board history", async () => {
        vm = new KanbanBoardViewModel({ room, client });
        await vm.reload();
        vi.useFakeTimers();
        events = [revision("one", "Changed remotely")];
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            client.emit(MatrixEventEvent.Decrypted, event);
        });
        vi.mocked(client.fetchRelations).mockClear();
        client.emit(ClientEvent.Event, new MatrixEvent(events[0]));
        await vi.advanceTimersByTimeAsync(301);
        expect(vm.getSnapshot().cards[0].title).toBe("Changed remotely");
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).toHaveBeenCalledTimes(1);
    });

    it("exits the recap before navigating even when the source is the current room", async () => {
        const onOpenRoom = vi.fn();
        vm = new KanbanBoardViewModel({ client, onOpenRoom });
        await vm.reload();
        const dispatch = vi.spyOn(dispatcher, "dispatch");
        vm.openRoom(room.roomId);
        expect(onOpenRoom).toHaveBeenCalledOnce();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ room_id: room.roomId }));
    });
});
