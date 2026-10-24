/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MatrixEvent,
    EventType,
    User,
    Room,
    RelationType,
    RoomMemberEvent,
    RoomStateEvent,
    ClientEvent,
    MatrixEventEvent,
    type MatrixClient,
    type RoomMember,
    type IEvent,
    type Thread,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { KanbanBoardViewModel, KANBAN_STATE_EVENT, KANBAN_CARD_EVENT, KANBAN_ROOT_EVENT } from "./KanbanBoardViewModel";
import { createNamedThread, THREAD_METADATA_EVENT } from "../../utils/matcha/threads";
import { scheduleRoomReminder } from "../../utils/matcha/reminders";
import Modal from "../../Modal";
import dispatcher from "../../dispatcher/dispatcher";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { Action } from "../../dispatcher/actions";

vi.mock("../../utils/matcha/threads", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../utils/matcha/threads")>()),
    createNamedThread: vi.fn(),
}));
vi.mock("../../utils/matcha/reminders", () => ({ scheduleRoomReminder: vi.fn() }));

describe("KanbanBoardViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let vm: KanbanBoardViewModel | undefined;
    let events: IEvent[];
    const rightPanelStore = { setCard: vi.fn() };

    const revision = (
        id: string,
        title: string,
        changes: Record<string, unknown> = {},
        roomId = "!room:server",
    ): IEvent => ({
        event_id: "$" + id + title,
        sender: client.getSafeUserId(),
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
        vi.spyOn(result, "maySendMessage").mockReturnValue(true);
        vi.spyOn(result, "createThreadsTimelineSets").mockResolvedValue(null);
        vi.spyOn(result, "fetchRoomThreads").mockResolvedValue();
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

    function makeThread(source = room, id = "$thread"): MatrixEvent {
        const root = new MatrixEvent({
            event_id: id,
            room_id: source.roomId,
            sender: client.getSafeUserId(),
            type: "m.room.message",
            content: { body: "Release planning", msgtype: "m.text" },
            unsigned: { "m.relations": { "m.thread": { count: 1 } } },
        });
        const thread = { id, rootEvent: root } as Thread;
        const threads = [...source.getThreads().filter((item) => item.id !== id), thread];
        vi.spyOn(source, "getThreads").mockReturnValue(threads);
        vi.spyOn(source, "getThread").mockImplementation(
            (eventId) => threads.find((item) => item.id === eventId) ?? null,
        );
        vi.spyOn(source, "findEventById").mockImplementation(
            (eventId) => threads.find((item) => item.id === eventId)?.rootEvent,
        );
        return root;
    }

    beforeEach(() => {
        client = stubClient();
        room = makeRoom();
        rightPanelStore.setCard.mockClear();
        vi.spyOn(room, "createThreadsTimelineSets").mockResolvedValue(null);
        vi.spyOn(room, "fetchRoomThreads").mockResolvedValue();
        events = [revision("one", "Plan release")];
        vi.mocked(client.getRooms).mockReturnValue([room]);
        vi.mocked(client.getRoom).mockImplementation((id) => (id === room.roomId ? room : null));
        client.fetchRelations = vi.fn().mockImplementation(async (_room, root) => ({
            chunk: events.filter(
                (event) => event.content?.["m.relates_to"]?.event_id === root || event.type === "m.room.encrypted",
            ),
        }));
        vi.mocked(createNamedThread)
            .mockReset()
            .mockImplementation(async (_client, source, name) => {
                const root = makeThread(source, "$created" + vi.mocked(createNamedThread).mock.calls.length);
                root.getContent().body = name.trim();
                return root;
            });
        vi.mocked(scheduleRoomReminder).mockReset().mockResolvedValue(undefined);
        client.getStateEvent = vi.fn().mockResolvedValue({ version: 1, event_id: "$board" });
        vi.spyOn(client, "getEventMapper").mockReturnValue((raw) => new MatrixEvent(raw));
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.mocked(client.sendEvent).mockImplementation(async (roomId, type, content) => {
            events.unshift({
                room_id: roomId,
                event_id: "$new",
                sender: client.getSafeUserId(),
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
                sender: client.getSafeUserId(),
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ cards: [], unreadable: true });
    });

    it("includes only joined rooms in the recap and removes a room immediately after leaving", async () => {
        const left = makeRoom("!left:server");
        vi.mocked(left.getMyMembership).mockReturnValue(KnownMembership.Leave);
        vi.mocked(client.getRooms).mockReturnValue([room, left]);
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
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

    it("persists opt-in channel visibility across edits, moves and archive changes", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards[0].showToRoom).toBe(true);
        vm.edit();
        expect(vm.getSnapshot().editor?.showToRoom).toBe(false);
        vm.setTitle("Team task");
        vm.setShowToRoom(true);
        await vm.save();
        let card = vm.getSnapshot().cards.find((item) => item.title === "Team task")!;
        expect(card.showToRoom).toBe(true);
        vm.edit(card);
        vm.setShowToRoom(false);
        await vm.save();
        card = vm.getSnapshot().cards.find((item) => item.id === card.id)!;
        expect(card.showToRoom).toBe(false);
        await vm.move(card, "doing");
        await vm.archive(card, false);
        expect(client.sendEvent).toHaveBeenLastCalledWith(
            room.roomId,
            KANBAN_CARD_EVENT,
            expect.objectContaining({ show_to_room: false, column: "doing" }),
        );
    });

    it("shows channel-shared B+C cards in the room but excludes them from my recap", async () => {
        const root = makeThread();
        root.event.sender = "@bob:server";
        events = [revision("one", "Release planning", { thread_id: "$thread", show_to_room: true })];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toHaveLength(1);
        vm.dispose();
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toEqual([]);
        expect(vm.getSnapshot().people).toEqual([]);
        vm.dispose();
        events[0].content!.show_to_room = false;
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toEqual([]);
    });

    it("includes a thread I replied to and filters by its participants, never other room members", async () => {
        const root = makeThread();
        root.event.sender = "@bob:server";
        Object.assign(room.getThread("$thread")!, { hasCurrentUserParticipated: true });
        const own = makeThread(room, "$own");
        own.getContent().body = "Solo task";
        events = [];
        const bob = new User("@bob:server");
        bob.displayName = "Bob";
        vi.mocked(client.getUser).mockImplementation((id) => (id === bob.userId ? bob : null));
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toHaveLength(2);
        expect(vm.getSnapshot().people).toEqual([{ userId: bob.userId, name: "Bob" }]);
        vm.setPersonFilter(bob.userId);
        expect(vm.getSnapshot().cards.map((card) => card.threadId)).toEqual(["$thread"]);
        expect(vm.getSnapshot().cards[0].participants).toEqual([{ userId: bob.userId, name: "Bob" }]);
        vm.setPersonFilter("");
        expect(vm.getSnapshot().cards).toHaveLength(2);
    });

    it("recognizes my participation from the server summary and loads older people without losing them on refresh", async () => {
        const root = makeThread();
        root.event.sender = "@bob:server";
        root.getUnsigned()["m.relations"] = { [RelationType.Thread]: { current_user_participated: true } };
        events = [];
        vi.mocked(client.fetchRelations).mockImplementation(async (_room, _root, relation, _type, options) => {
            if (relation !== RelationType.Thread) return { chunk: [] };
            return options?.from
                ? {
                      chunk: [
                          {
                              event_id: "$oldreply",
                              origin_server_ts: 1,
                              unsigned: {},
                              room_id: room.roomId,
                              sender: "@charlie:server",
                              type: EventType.RoomMessage,
                              content: {
                                  "body": "Older reply",
                                  "m.relates_to": { rel_type: RelationType.Thread, event_id: "$thread" },
                              },
                          },
                      ],
                  }
                : { chunk: [], next_batch: "older-people" };
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ hasMore: true, cards: [{ threadId: "$thread" }] });
        await vm.loadMore();
        expect(vm.getSnapshot().hasMore).toBe(false);
        expect(vm.getSnapshot().people?.map((person) => person.userId)).toContain("@charlie:server");
        await vm.reload();
        vm.setPersonFilter("@charlie:server");
        expect(vm.getSnapshot().cards).toHaveLength(1);
    });

    it("keeps older participant pagination progress through refreshes and reports stalled pages", async () => {
        makeThread();
        events = [];
        let stalled = false;
        vi.mocked(client.fetchRelations).mockImplementation(async (_room, _root, relation, _type, options) => {
            if (relation !== RelationType.Thread) return { chunk: [] };
            if (!options?.from) return { chunk: [], next_batch: "second" };
            if (options.from === "second") return { chunk: [], next_batch: "third" };
            return { chunk: [], ...(stalled ? { next_batch: "third" } : {}) };
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        await vm.loadMore();
        await vm.reload();
        stalled = true;
        await vm.loadMore();
        expect(client.fetchRelations).toHaveBeenCalledWith(
            room.roomId,
            "$thread",
            RelationType.Thread,
            null,
            expect.objectContaining({ from: "third" }),
        );
        expect(vm.getSnapshot()).toMatchObject({ hasMore: true, error: expect.any(String) });
        stalled = false;
        await vm.loadMore();
        expect(vm.getSnapshot()).toMatchObject({ hasMore: false, error: undefined });
        await vm.reload();
        expect(vm.getSnapshot().hasMore).toBe(false);
    });

    it("reads encrypted replies' cleartext senders without decrypting them, ignoring foreign, redacted and non-thread events", async () => {
        const root = makeThread();
        root.event.sender = "@bob:server";
        events = [];
        const reply = (id: string, sender: string, relation = RelationType.Thread): IEvent => ({
            event_id: id,
            origin_server_ts: 1,
            unsigned: {},
            room_id: room.roomId,
            sender,
            type: EventType.RoomMessage,
            content: { "body": "Reply", "m.relates_to": { rel_type: relation, event_id: "$thread" } },
        });
        vi.mocked(client.fetchRelations).mockImplementation(async (_room, _root, relation) => ({
            chunk:
                relation === RelationType.Thread
                    ? [
                          reply("$mine", client.getSafeUserId()),
                          { ...reply("$encrypted", "@carol:server"), type: EventType.RoomMessageEncrypted },
                          { ...reply("$foreign", "@foreign:server"), room_id: "!elsewhere:server" },
                          reply("$reaction", "@reactor:server", RelationType.Annotation),
                          {
                              ...reply("$redacted", "@redacted:server"),
                              unsigned: { redacted_because: reply("$redaction", "@bob:server") },
                          },
                      ]
                    : [],
        }));
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            if (event.getId() === "$encrypted") vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toHaveLength(1);
        expect(vm.getSnapshot().people?.map((person) => person.userId)).toEqual(["@bob:server", "@carol:server"]);
        // An unreadable chat reply is not an unreadable card update.
        expect(vm.getSnapshot().unreadable).toBe(false);
        expect(
            vi.mocked(client.decryptEventIfNeeded).mock.calls.some(([event]) => event.getId() === "$encrypted"),
        ).toBe(false);
    });

    it("reads a thread's people once instead of refetching its replies on every reload", async () => {
        makeThread();
        events = [];
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        vi.mocked(client.fetchRelations).mockClear();
        await vm.reload();
        expect(client.fetchRelations).toHaveBeenCalled();
        expect(client.fetchRelations).not.toHaveBeenCalledWith(
            room.roomId,
            "$thread",
            RelationType.Thread,
            null,
            expect.anything(),
        );
    });

    it("loads four board rooms at a time and publishes them together", async () => {
        const rooms = [room, ...["!b:server", "!c:server", "!d:server", "!e:server"].map((id) => makeRoom(id))];
        vi.mocked(client.getRooms).mockReturnValue(rooms);
        vi.mocked(client.getRoom).mockImplementation((id) => rooms.find((source) => source.roomId === id) ?? null);
        let inFlight = 0;
        let peak = 0;
        vi.mocked(client.fetchRelations).mockImplementation(async (roomId) => {
            peak = Math.max(peak, ++inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
            return { chunk: [revision("one", "Card", {}, roomId)] };
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vi.waitFor(() => expect(vm!.getSnapshot().cards).toHaveLength(5));
        expect(peak).toBe(4);
    });

    it("includes DM cards before I reply and updates when direct-message account data changes", async () => {
        const root = makeThread();
        root.event.sender = "@bob:server";
        events = [revision("one", "Release planning", { thread_id: "$thread", show_to_room: false })];
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toEqual([]);
        const direct = new MatrixEvent({ type: EventType.Direct, content: { "@bob:server": [room.roomId] } });
        vi.mocked(client.getAccountData).mockReturnValue(direct);
        client.emit(ClientEvent.AccountData, direct);
        expect(vm.getSnapshot().cards).toHaveLength(1);
        expect(vm.getSnapshot().people?.map((person) => person.userId)).toEqual(["@bob:server"]);
        vi.mocked(client.getAccountData).mockReturnValue(undefined);
        vm.setPersonFilter("@bob:server");
        client.emit(ClientEvent.AccountData, new MatrixEvent({ type: EventType.Direct, content: {} }));
        expect(vm.getSnapshot().cards).toEqual([]);
        expect(vm.getSnapshot().personFilter).toBe("");
    });

    it("lists every mapped group-DM counterpart without treating channel members as participants", async () => {
        events = [revision("one", "Group DM task", { show_to_room: false })];
        events[0].sender = "@bob:server";
        vi.mocked(client.getAccountData).mockReturnValue(
            new MatrixEvent({
                type: EventType.Direct,
                content: {
                    "@bob:server": [room.roomId],
                    "@charlie:server": [room.roomId],
                    "@elsewhere:server": ["!other:server"],
                },
            }),
        );
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toHaveLength(1);
        expect(vm.getSnapshot().people?.map((person) => person.userId)).toEqual(["@bob:server", "@charlie:server"]);
    });

    it("keeps a visibility draft after a failed save and rejects malformed visibility fields", async () => {
        events = [revision("bad", "Invalid", { show_to_room: "true" }), revision("one", "Valid")];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards.map((card) => card.title)).toEqual(["Valid"]);
        vm.edit(vm.getSnapshot().cards[0]);
        vm.setShowToRoom(false);
        vi.mocked(client.sendEvent).mockRejectedValue(new Error("offline"));
        await vm.save();
        expect(vm.getSnapshot().editor?.showToRoom).toBe(false);
        expect(vm.getSnapshot().cards[0].showToRoom).toBe(true);
    });

    it("checks permission again before writes and retains drafts after failures", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ loading: false, error: expect.any(String) });
    });

    it("refreshes synced revisions without looping when fetching and decrypting board history", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
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

    it("ignores other readers' history decryptions and reloads once keys arrive for an unreadable revision", async () => {
        makeThread();
        events = [revision("one", "Plan release"), { ...revision("locked", "Locked"), type: "m.room.encrypted" }];
        let missingKeys = true;
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            if (missingKeys && event.getId() === "$lockedLocked")
                vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().unreadable).toBe(true);
        vi.useFakeTimers();
        vi.mocked(client.fetchRelations).mockClear();
        // The thread tabs re-reading a rename decrypt a fresh copy of the patch; that is not new board data.
        const patch = new MatrixEvent({
            event_id: "$rename",
            room_id: room.roomId,
            type: THREAD_METADATA_EVENT,
            content: {
                "version": 1,
                "name": "Renamed",
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$thread" },
            },
        });
        client.emit(MatrixEventEvent.Decrypted, patch);
        const stillLocked = new MatrixEvent({ ...events[1] });
        vi.spyOn(stillLocked, "isDecryptionFailure").mockReturnValue(true);
        client.emit(MatrixEventEvent.Decrypted, stillLocked);
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
        missingKeys = false;
        client.emit(MatrixEventEvent.Decrypted, new MatrixEvent({ ...events[1] }));
        await vi.advanceTimersByTimeAsync(301);
        expect(client.fetchRelations).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(vm.getSnapshot().unreadable).toBe(false);
    });

    it("reloads for a live encrypted rename by its cleartext relation, but not for encrypted chat during a reload", async () => {
        makeThread();
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vi.useFakeTimers();
        const encrypted = (id: string, content: Record<string, unknown>) =>
            new MatrixEvent({ event_id: id, room_id: room.roomId, type: "m.room.encrypted", content });
        const refresh = vm.reload();
        client.emit(ClientEvent.Event, encrypted("$chat", { ciphertext: "hello" }));
        await refresh;
        vi.mocked(client.fetchRelations).mockClear();
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
        client.emit(
            ClientEvent.Event,
            encrypted("$rename", {
                "ciphertext": "renamed",
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$thread" },
            }),
        );
        await vi.advanceTimersByTimeAsync(301);
        expect(client.fetchRelations).toHaveBeenCalled();
    });

    it("adds a reply's sender to its thread card without reloading, and reloads for a thread new to the board", async () => {
        makeThread();
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vi.useFakeTimers();
        vi.mocked(client.fetchRelations).mockClear();
        const reply = (id: string, threadId: string) =>
            new MatrixEvent({
                event_id: id,
                room_id: room.roomId,
                sender: "@dana:server",
                type: "m.room.encrypted",
                content: {
                    "ciphertext": "reply",
                    "m.relates_to": { rel_type: RelationType.Thread, event_id: threadId },
                },
            });
        client.emit(ClientEvent.Event, reply("$reply", "$thread"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
        expect(
            vm
                .getSnapshot()
                .cards.find((card) => card.threadId === "$thread")
                ?.participants?.map((person) => person.userId),
        ).toEqual(["@dana:server"]);
        client.emit(ClientEvent.Event, reply("$first", "$elsewhere"));
        await vi.advanceTimersByTimeAsync(301);
        expect(client.fetchRelations).toHaveBeenCalled();
    });

    it("does not reload again for the sync echo of its own card revision, whenever it arrives", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vi.useFakeTimers();
        let echo!: IEvent;
        vi.mocked(client.sendEvent).mockImplementationOnce(async (roomId, type, content) => {
            echo = {
                room_id: roomId,
                event_id: "$echo",
                sender: client.getSafeUserId(),
                origin_server_ts: 2,
                unsigned: {},
                type: String(type),
                content: typeof content === "object" ? content : {},
            };
            events.unshift(echo);
            // Sync can deliver the echo before the send request resolves.
            client.emit(ClientEvent.Event, new MatrixEvent(echo));
            return { event_id: "$echo" };
        });
        await vm.move(vm.getSnapshot().cards[0], "doing");
        expect(vm.getSnapshot().cards[0].column).toBe("doing");
        vi.mocked(client.fetchRelations).mockClear();
        // Or after the reload that already read it.
        client.emit(ClientEvent.Event, new MatrixEvent(echo));
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
    });

    it("publishes a power-level change without reloading and ignores other rooms' state", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().canAdd).toBe(true);
        vi.useFakeTimers();
        vi.mocked(client.fetchRelations).mockClear();
        const state = (roomId: string, type: string) =>
            new MatrixEvent({ room_id: roomId, type, state_key: "", content: { version: 1, event_id: "$other" } });
        client.emit(RoomStateEvent.Events, state("!other:server", KANBAN_STATE_EVENT), room.currentState, null);
        vi.mocked(room.currentState.maySendEvent).mockReturnValue(false);
        client.emit(RoomStateEvent.Events, state(room.roomId, EventType.RoomPowerLevels), room.currentState, null);
        expect(vm.getSnapshot().canAdd).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
    });

    it("publishes member name changes once per batch and only for board rooms", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        const published = vi.fn();
        vm.subscribe(published);
        const member = (roomId: string) => ({ roomId, userId: "@bob:server" }) as RoomMember;
        client.emit(RoomMemberEvent.Name, new MatrixEvent(), member("!elsewhere:server"), null);
        await Promise.resolve();
        expect(published).not.toHaveBeenCalled();
        for (let index = 0; index < 3; index++)
            client.emit(RoomMemberEvent.Name, new MatrixEvent(), member(room.roomId), null);
        await Promise.resolve();
        expect(published).toHaveBeenCalledOnce();
    });

    it("exits the recap before navigating even when the source is the current room", async () => {
        const onOpenRoom = vi.fn();
        vm = new KanbanBoardViewModel({ rightPanelStore, client, onOpenRoom });
        await vm.reload();
        const dispatch = vi.spyOn(dispatcher, "dispatch");
        vm.openRoom(room.roomId);
        expect(onOpenRoom).toHaveBeenCalledOnce();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ room_id: room.roomId }));
    });

    it("prevents linking a second card to a thread or unlinking its canonical card", async () => {
        makeThread();
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        const manual = vm.getSnapshot().cards.find((card) => !card.threadId)!;
        vm.edit(manual);
        vm.setThread("$thread");
        expect(vm.getSnapshot()).toMatchObject({ threadError: expect.any(String), editor: { id: manual.id } });
        await vm.save();
        expect(client.sendEvent).not.toHaveBeenCalled();
        const linked = vm.getSnapshot().cards.find((card) => card.threadId)!;
        vm.edit(linked);
        vm.setThread("");
        expect(vm.getSnapshot().editor?.threadId).toBe("$thread");
        expect(vm.getSnapshot().cards.filter((card) => card.threadId === "$thread")).toHaveLength(1);
    });

    it("opens a thread-linked draft once and loads the room's thread titles", async () => {
        makeThread();
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client, initialThreadId: "$thread" });
        await vm.reload();
        await vi.waitFor(() => expect(vm!.getSnapshot().threadsLoading).toBe(false));
        expect(vm.getSnapshot().editor).toMatchObject({ threadId: "$thread", title: "Release planning" });
        expect(vm.getSnapshot().threads).toContainEqual({ id: "$thread", title: "Release planning" });
        vm.cancelEdit();
        await vm.reload();
        expect(vm.getSnapshot().editor).toBeUndefined();
    });

    it("keeps the selected thread when its board must be created first", async () => {
        makeThread();
        vi.spyOn(room.currentState, "getStateEvents").mockReturnValue(null);
        vi.mocked(client.sendStateEvent).mockResolvedValue({ event_id: "$state" });
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client, initialThreadId: "$thread" });
        await vm.reload();
        expect(vm.getSnapshot().editor).toBeUndefined();
        await vm.createBoard();
        expect(vm.getSnapshot().editor).toMatchObject({ threadId: "$thread" });
    });

    it.each([false, true])("opens a linked native thread in its source room (universal=%s)", async (universal) => {
        const root = makeThread();
        const onOpenRoom = vi.fn();
        events = [revision("one", "Linked", { thread_id: "$thread" })];
        vm = new KanbanBoardViewModel({ rightPanelStore, client, room: universal ? undefined : room, onOpenRoom });
        await vm.reload();
        const dispatch = vi.spyOn(dispatcher, "dispatch");
        await vm.openThread(vm.getSnapshot().cards[0]);
        expect(rightPanelStore.setCard).toHaveBeenCalledWith(
            { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: root } },
            true,
            room.roomId,
        );
        expect(onOpenRoom).toHaveBeenCalledOnce();
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewRoom, room_id: room.roomId });
    });

    it("rejects foreign-room thread roots when saving or opening and preserves the card", async () => {
        const foreignRoot = makeThread(makeRoom("!foreign:server"), "$foreign");
        vi.spyOn(client, "fetchRoomEvent").mockResolvedValue(foreignRoot.event);
        events = [revision("one", "Keep this card", { thread_id: "$foreign" })];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        const card = vm.getSnapshot().cards[0];
        await vm.openThread(card);
        expect(rightPanelStore.setCard).not.toHaveBeenCalled();
        expect(vm.getSnapshot()).toMatchObject({ error: expect.any(String), cards: [{ title: "Keep this card" }] });
        vm.edit();
        vm.setTitle("Invalid link");
        vm.setThread("$foreign");
        await vm.save();
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(vm.getSnapshot().editor?.title).toBe("Invalid link");
        expect(vm.getSnapshot().threadError).toBeDefined();
    });

    it("keeps existing links when choices cannot load and prevents navigation after leaving", async () => {
        events = [revision("one", "Linked", { thread_id: "$thread" })];
        vi.mocked(room.fetchRoomThreads).mockRejectedValue(new Error("offline"));
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vm.edit(vm.getSnapshot().cards[0]);
        await vi.waitFor(() => expect(vm!.getSnapshot().threadsLoading).toBe(false));
        expect(vm.getSnapshot()).toMatchObject({ error: expect.any(String), editor: { threadId: "$thread" } });
        vi.mocked(room.getMyMembership).mockReturnValue(KnownMembership.Leave);
        await vm.openThread(vm.getSnapshot().cards[0]);
        expect(rightPanelStore.setCard).not.toHaveBeenCalled();
    });

    it("refreshes remote updates silently while retaining the visible cards and editor draft", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vm.edit(vm.getSnapshot().cards[0]);
        vm.setTitle("My unfinished draft");
        await vi.waitFor(() => expect(vm!.getSnapshot().threadsLoading).toBe(false));
        let finish!: (value: { chunk: IEvent[] }) => void;
        vi.mocked(client.fetchRelations).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const refresh = vm.reload();
        expect(vm.getSnapshot()).toMatchObject({
            loading: false,
            cards: [{ title: "Plan release" }],
            editor: { title: "My unfinished draft" },
        });
        finish({ chunk: [revision("one", "Changed by a teammate")] });
        await refresh;
        expect(vm.getSnapshot()).toMatchObject({
            loading: false,
            cards: [{ title: "Changed by a teammate" }],
            editor: { title: "My unfinished draft" },
        });
    });

    it("keeps cards already loaded from older history and retains them when background reads fail", async () => {
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [revision("one", "Recent"), revision("two", "Older card")],
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vi.mocked(client.fetchRelations).mockResolvedValue({
            chunk: [revision("one", "Updated")],
            next_batch: "older",
        });
        await vm.reload();
        expect(vm.getSnapshot().cards.map((card) => card.title)).toEqual(["Updated", "Older card"]);
        vi.mocked(client.fetchRelations).mockRejectedValue(new Error("offline"));
        await vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ loading: false, error: expect.any(String) });
        expect(vm.getSnapshot().cards.map((card) => card.title)).toEqual(["Updated", "Older card"]);
    });

    it("does not reintroduce initial loading for an empty board", async () => {
        events = [];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        const refresh = vm.reload();
        expect(vm.getSnapshot()).toMatchObject({ loading: false, cards: [] });
        await refresh;
    });

    it("projects every loaded thread four at a time", async () => {
        const threads = Array.from({ length: 9 }, (_, index) => makeThread(room, "$thread" + index));
        const pending: ((value: { chunk: IEvent[] }) => void)[] = [];
        vi.mocked(client.fetchRelations).mockImplementation((_room, root, relation) =>
            root === "$board"
                ? Promise.resolve({ chunk: events })
                : relation === RelationType.Thread
                  ? Promise.resolve({ chunk: [] })
                  : new Promise((resolve) => pending.push(resolve)),
        );
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vi.waitFor(() => expect(pending).toHaveLength(4));
        pending.slice(0, 4).forEach((resolve) => resolve({ chunk: [] }));
        await vi.waitFor(() => expect(pending).toHaveLength(8));
        pending.slice(4, 8).forEach((resolve) => resolve({ chunk: [] }));
        await vi.waitFor(() => expect(pending).toHaveLength(9));
        pending[8]({ chunk: [] });
        await vi.waitFor(() => expect(vm!.getSnapshot().loading).toBe(false));
        expect(
            vm
                .getSnapshot()
                .cards.filter((card) => card.threadId)
                .map((card) => card.threadId),
        ).toEqual(threads.map((thread) => thread.getId()));
    });

    it("projects one stable card per native thread without writing and preserves manual cards", async () => {
        makeThread();
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        const card = vm.getSnapshot().cards.find((item) => item.threadId)!;
        expect(card).toMatchObject({ title: "Release planning", column: "todo", archived: false });
        expect(card.id).toMatch(/^thread-[a-f0-9]{64}$/);
        expect(vm.getSnapshot().cards.find((item) => item.id === "one")?.title).toBe("Plan release");
        await vm.reload();
        expect(vm.getSnapshot().cards.filter((item) => item.threadId)).toEqual([card]);
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("retains duplicate legacy card details under one canonical thread card", async () => {
        makeThread();
        events = [
            revision("latest", "New card name", { thread_id: "$thread", description: "Current details" }),
            revision("earlier", "Old card name", {
                thread_id: "$thread",
                description: "Do not lose this",
                column: "done",
                archived: true,
            }),
            revision("manual", "Standalone earlier card"),
        ];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards).toHaveLength(2);
        expect(vm.getSnapshot().cards.find((card) => card.threadId)).toMatchObject({
            id: "latest",
            title: "Release planning",
            description: "Current details",
            earlierCards: [
                {
                    id: "earlier",
                    title: "Old card name",
                    description: "Do not lose this",
                    column: "done",
                    archived: true,
                },
            ],
        });
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("reflects shared thread rename and archive metadata in Personal and room boards", async () => {
        makeThread();
        events.unshift({
            sender: client.getSafeUserId(),
            origin_server_ts: 3,
            unsigned: {},
            room_id: room.roomId,
            event_id: "$metadata",
            type: THREAD_METADATA_EVENT,
            content: {
                "version": 1,
                "name": "Renamed discussion",
                "archived": true,
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$thread" },
            },
        });
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards.find((card) => card.threadId)).toMatchObject({
            title: "Renamed discussion",
            archived: true,
            roomId: room.roomId,
        });
    });

    it("saves validated deadlines and rejects impossible local dates without creating a thread", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vm.edit();
        vm.setTitle("Deadline task");
        vm.setDueAt("2026-02-31T10:00");
        await vm.save();
        expect(createNamedThread).not.toHaveBeenCalled();
        expect(vm.getSnapshot().error).toBeDefined();
        vm.setDueAt("2027-03-10T10:30");
        await vm.save();
        expect(createNamedThread).toHaveBeenCalledWith(client, room, "Deadline task");
        const card = vm.getSnapshot().cards.find((item) => item.threadId)!;
        expect(card.dueAt).toBe(new Date("2027-03-10T10:30").getTime());
        expect(client.sendEvent).toHaveBeenLastCalledWith(
            room.roomId,
            KANBAN_CARD_EVENT,
            expect.objectContaining({ due_at: card.dueAt }),
        );
        vm.edit(card);
        vm.setDueAt("");
        await vm.save();
        expect(vm.getSnapshot().cards.find((item) => item.id === card.id)?.dueAt).toBeUndefined();
    });

    it("does not create a second thread when its card revision must be retried", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vm.edit();
        vm.setTitle("Keep this discussion");
        const send = vi.mocked(client.sendEvent).getMockImplementation()!;
        vi.mocked(client.sendEvent).mockRejectedValueOnce(new Error("offline"));
        await vm.save();
        expect(vm.getSnapshot().editor?.threadId).toBeDefined();
        vi.mocked(client.sendEvent).mockImplementation(send);
        await vm.save();
        expect(createNamedThread).toHaveBeenCalledOnce();
        expect(vm.getSnapshot().cards.filter((card) => card.threadId)).toHaveLength(1);
    });

    it("prefills reminder context and records only successful command requests", async () => {
        makeThread();
        const due = new Date("2027-03-10T10:30").getTime();
        events = [revision("one", "Linked", { thread_id: "$thread", due_at: due })];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client, reminderBot: "@bot:server" });
        await vm.reload();
        let card = vm.getSnapshot().cards[0];
        await vm.remind(card);
        expect(scheduleRoomReminder).toHaveBeenCalledWith(client, room, "@bot:server", {
            message: "Release planning",
            at: due,
            threadId: "$thread",
        });
        expect(client.sendEvent).not.toHaveBeenCalled();
        vi.mocked(scheduleRoomReminder).mockResolvedValue({
            status: "requested",
            eventId: "$reminder",
            at: due,
            message: "Release planning",
            threadId: "$thread",
        });
        await vm.remind(card);
        card = vm.getSnapshot().cards[0];
        expect(card.reminderRequested).toEqual({ eventId: "$reminder", at: due });
        expect(client.sendEvent).toHaveBeenLastCalledWith(
            room.roomId,
            KANBAN_CARD_EVENT,
            expect.objectContaining({ reminder_requested: { event_id: "$reminder", at: due } }),
        );
    });
    it("queues one follow-up refresh for a live revision received while history is loading", async () => {
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        vi.useFakeTimers();
        let finish!: (value: { chunk: IEvent[] }) => void;
        vi.mocked(client.fetchRelations)
            .mockClear()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            );
        const refresh = vm.reload();
        events = [revision("one", "Arrived during history")];
        client.emit(ClientEvent.Event, new MatrixEvent(events[0]));
        finish({ chunk: [revision("one", "Older snapshot")] });
        await refresh;
        expect(vm.getSnapshot().cards[0].title).toBe("Older snapshot");
        await vi.advanceTimersByTimeAsync(301);
        expect(vm.getSnapshot().cards[0].title).toBe("Arrived during history");
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).toHaveBeenCalledTimes(2);
    });

    it("preserves a legacy linked-card archive until an explicit thread restore arrives", async () => {
        makeThread();
        events = [revision("one", "Keep archived", { thread_id: "$thread", archived: true })];
        vm = new KanbanBoardViewModel({ rightPanelStore, room, client });
        await vm.reload();
        expect(vm.getSnapshot().cards[0].archived).toBe(true);
        events.unshift({
            sender: client.getSafeUserId(),
            origin_server_ts: 3,
            unsigned: {},
            room_id: room.roomId,
            event_id: "$restore",
            type: THREAD_METADATA_EVENT,
            content: {
                "version": 1,
                "archived": false,
                "m.relates_to": { rel_type: RelationType.Reference, event_id: "$thread" },
            },
        });
        await vm.reload();
        expect(vm.getSnapshot().cards[0].archived).toBe(false);
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("projects member-created threads across joined boards without state-write permission", async () => {
        const second = makeRoom("!second:server");
        makeThread(room, "$first");
        makeThread(second, "$second");
        vi.mocked(room.currentState.maySendStateEvent).mockReturnValue(false);
        vi.mocked(second.currentState.maySendStateEvent).mockReturnValue(false);
        vi.mocked(client.getRooms).mockReturnValue([room, second]);
        vi.mocked(client.getRoom).mockImplementation(
            (id) => [room, second].find((source) => source.roomId === id) ?? null,
        );
        events = [];
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().cards.map((card) => [card.roomId, card.threadId])).toEqual([
            [room.roomId, "$first"],
            [second.roomId, "$second"],
        ]);
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("never paginates native thread history for a room without an initialized board", async () => {
        const unboarded = makeRoom("!unboarded:server");
        vi.spyOn(unboarded.currentState, "getStateEvents").mockReturnValue(null);
        Object.defineProperty(unboarded, "threadsTimelineSets", {
            value: [{ getLiveTimeline: () => ({ getPaginationToken: () => "older" }) }],
        });
        vi.mocked(client.getRooms).mockReturnValue([room, unboarded]);
        vi.mocked(client.getRoom).mockImplementation(
            (id) => [room, unboarded].find((source) => source.roomId === id) ?? null,
        );
        const paginate = vi.spyOn(client, "paginateEventTimeline").mockResolvedValue(false);
        vm = new KanbanBoardViewModel({ rightPanelStore, client });
        await vm.reload();
        expect(vm.getSnapshot().hasMore).toBe(false);
        await vm.loadMore();
        expect(paginate).not.toHaveBeenCalled();
    });
});
