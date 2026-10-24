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
    ThreadEvent,
    MatrixEventEvent,
    RoomEvent,
    EventTimeline,
    type MatrixClient,
    type Thread,
    type IEvent,
    type IRelationsResponse,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";
// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";

import { RoomThreadTabsViewModel } from "./RoomThreadTabsViewModel";
import { THREAD_ARCHIVE_EVENT, THREAD_METADATA_EVENT, ThreadMetadataReadError } from "../../utils/matcha/threads";
import * as threadHelpers from "../../utils/matcha/threads";
import { _t } from "../../languageHandler";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import Modal from "../../Modal";
import type RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import * as reminders from "../../utils/matcha/reminders";

describe("RoomThreadTabsViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let root: MatrixEvent;
    let threads: Thread[];
    let vm: RoomThreadTabsViewModel;
    const onBoardChange = vi.fn();
    const onOpenDocs = vi.fn();
    const onOpenLegacyDocs = vi.fn();
    const panel = Object.assign(new EventEmitter(), {
        currentCardForRoom: vi.fn(),
        isOpenForRoom: vi.fn(),
        togglePanel: vi.fn(),
        setCard: vi.fn(),
    });
    const confirm = (value?: string) =>
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve(value === undefined ? [true] : [true, value]),
            close: vi.fn(),
        } as ReturnType<typeof Modal.createDialog>);

    beforeEach(async () => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room("!room:server", client, client.getSafeUserId());
        root = new MatrixEvent({
            event_id: "$root",
            room_id: room.roomId,
            origin_server_ts: 1,
            type: "m.room.message",
            content: { body: "Project plans", msgtype: "m.text" },
            unsigned: { "m.relations": { "m.thread": { count: 1 } } },
        });
        threads = [{ id: "$root", rootEvent: root } as Thread];
        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(room, "maySendMessage").mockReturnValue(true);
        vi.spyOn(room, "getThreads").mockImplementation(() => threads);
        vi.spyOn(room, "getThread").mockImplementation((id) => threads.find((thread) => thread.id === id) ?? null);
        vi.spyOn(room, "findEventById").mockImplementation((id) => (id === "$root" ? root : undefined));
        vi.spyOn(room, "createThread").mockImplementation((id, event) => {
            const thread = { id, rootEvent: event } as Thread;
            threads.push(thread);
            return thread;
        });
        vi.spyOn(client, "fetchRoomEvent").mockImplementation(async (_roomId, id) => ({ ...root.event, event_id: id }));
        client.fetchRelations = vi.fn<MatrixClient["fetchRelations"]>().mockResolvedValue({ chunk: [] });
        vi.spyOn(room, "createThreadsTimelineSets").mockResolvedValue(null);
        vi.spyOn(room, "fetchRoomThreads").mockResolvedValue();
        vi.spyOn(room.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(room.currentState, "maySendStateEvent").mockReturnValue(false);
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$metadata" });
        panel.currentCardForRoom.mockReturnValue({
            phase: RightPanelPhases.ThreadView,
            state: { threadHeadEvent: root },
        });
        panel.isOpenForRoom.mockReturnValue(true);
        vm = new RoomThreadTabsViewModel({
            room,
            client,
            rightPanelStore: panel as unknown as RightPanelStore,
            onBoardChange,
            onOpenDocs,
            onOpenLegacyDocs,
            reminderBot: "@reminder:server",
        });
        await vi.waitFor(() => expect(vm.getSnapshot().threads[0]?.canManage).toBe(true));
    });
    afterEach(() => {
        vm.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("loads titles and switches between native thread, General, history and a linked board", async () => {
        vm.openDocs();
        expect(onOpenDocs).not.toHaveBeenCalled();
        vm.setSpaceDocsAvailable(true);
        vm.openDocs();
        expect(onOpenDocs).toHaveBeenCalledOnce();
        vm.openLegacyDocs();
        expect(onOpenLegacyDocs).toHaveBeenCalledOnce();
        vm.setDocs(true);
        expect(vm.getSnapshot().docs).toBe(true);
        vm.setDocs(false);
        expect(vm.getSnapshot()).toMatchObject({
            selectedId: "$root",
            canCreate: true,
            threads: [{ title: "Project plans", archived: false, canManage: true }],
        });
        await vm.select("$root");
        expect(panel.setCard).toHaveBeenCalledWith(
            { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: root } },
            true,
            room.roomId,
        );
        await vm.select();
        expect(panel.togglePanel).toHaveBeenCalledWith(room.roomId);
        vm.toggleHistory();
        expect(vm.getSnapshot().showHistory).toBe(true);
        await vm.linkToBoard("$root");
        expect(onBoardChange).toHaveBeenCalledWith("room", "$root");
    });

    it("archives with ordinary member permission after confirmation, preserving messages", async () => {
        confirm();
        await vm.archive("$root", true);
        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, THREAD_METADATA_EVENT, {
            "version": 1,
            "archived": true,
            "m.relates_to": { rel_type: "m.reference", event_id: "$root" },
        });
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(client.redactEvent).not.toHaveBeenCalled();
        expect(panel.togglePanel).toHaveBeenCalledWith(room.roomId);
    });

    it("renames without rewriting the root message or archive field", async () => {
        confirm("Launch plans");
        await vm.rename("$root");
        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, THREAD_METADATA_EVENT, {
            "version": 1,
            "name": "Launch plans",
            "m.relates_to": { rel_type: "m.reference", event_id: "$root" },
        });
        expect(vm.getSnapshot().threads[0].title).toBe("Launch plans");
        expect(root.getContent().body).toBe("Project plans");
    });

    it("creates a named native thread and opens it without a Reply in thread prerequisite", async () => {
        confirm("Launch");
        vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$created" });
        await vm.create();
        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, "$created", THREAD_METADATA_EVENT, {
            version: 1,
            name: "Launch",
            archived: false,
        });
        expect(panel.setCard).toHaveBeenCalledWith(
            expect.objectContaining({ phase: RightPanelPhases.ThreadView }),
            true,
            room.roomId,
        );
        expect(vm.getSnapshot().threads).toContainEqual(expect.objectContaining({ id: "$created", title: "Launch" }));
    });

    it("does not reopen a slowly decrypted thread after selecting General", async () => {
        let decrypted!: () => void;
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    decrypted = resolve;
                }),
        );
        const opening = vm.select("$root");
        await vm.select();
        decrypted();
        await opening;
        expect(panel.setCard).not.toHaveBeenCalled();
    });

    it("rechecks current send permissions after the confirmation dialog", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation(() => {
            vi.mocked(room.currentState.maySendEvent).mockReturnValue(false);
            return { finished: Promise.resolve([true]), close: vi.fn() } as ReturnType<typeof Modal.createDialog>;
        });
        await vm.archive("$root", true);
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(vm.getSnapshot().error).toContain("Could not change");
    });

    it("preserves legacy archive entries and loads older native thread pages", async () => {
        room.currentState.setStateEvents([
            new MatrixEvent({
                type: THREAD_ARCHIVE_EVENT,
                state_key: "$old",
                room_id: room.roomId,
                content: { archived: true },
            }),
        ]);
        room.threadsTimelineSets[0] = room.getUnfilteredTimelineSet();
        room.threadsTimelineSets[0].getLiveTimeline().setPaginationToken("older", EventTimeline.BACKWARDS);
        room.emit(ThreadEvent.Update, threads[0]);
        await vi.waitFor(() =>
            expect(vm.getSnapshot().threads.find((thread) => thread.id === "$old")?.canManage).toBe(true),
        );
        expect(vm.getSnapshot().threads.find((thread) => thread.id === "$old")?.archived).toBe(true);
        vi.spyOn(client, "paginateEventTimeline").mockResolvedValue(false);
        await vm.loadMore();
        expect(client.paginateEventTimeline).toHaveBeenCalledWith(expect.anything(), { backwards: true, limit: 30 });
        await vm.archive("$old", false);
        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, THREAD_METADATA_EVENT, {
            "version": 1,
            "archived": false,
            "m.relates_to": { rel_type: "m.reference", event_id: "$old" },
        });
    });

    it("reloads metadata from other members and exposes failure without allowing unsafe management", async () => {
        vi.mocked(client.fetchRelations).mockRejectedValue(new Error("Offline"));
        const revision = new MatrixEvent({
            type: THREAD_METADATA_EVENT,
            room_id: room.roomId,
            content: { "version": 1, "name": "New", "m.relates_to": { rel_type: "m.reference", event_id: "$root" } },
        });
        client.emit(RoomEvent.Timeline, revision, room, false, false, {
            timeline: room.getLiveTimeline(),
            liveEvent: true,
        });
        await vi.waitFor(() => expect(vm.getSnapshot().error).toBe(_t("matcha_threads|metadata_network_error")));
        expect(vm.getSnapshot().threads[0].canManage).toBe(false);
    });

    it("ignores the board's history decryptions for threads whose metadata already loaded", async () => {
        vi.mocked(client.fetchRelations).mockClear();
        vi.useFakeTimers();
        const patch = new MatrixEvent({
            event_id: "$patch",
            type: THREAD_METADATA_EVENT,
            room_id: room.roomId,
            content: { "version": 1, "name": "Old", "m.relates_to": { rel_type: "m.reference", event_id: "$root" } },
        });
        client.emit(MatrixEventEvent.Decrypted, patch);
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).not.toHaveBeenCalled();
        expect(vm.getSnapshot().threads[0].canManage).toBe(true);
    });

    it("recovers a failed thread when its keys arrive during a different metadata batch", async () => {
        const read = vi
            .spyOn(threadHelpers, "readThreadMetadata")
            .mockRejectedValueOnce(new ThreadMetadataReadError("keys", "Missing keys"));
        await vm.retry();
        expect(vm.getSnapshot().error).toBe(_t("matcha_threads|metadata_keys_error"));
        expect(vm.getSnapshot().threads[0].canManage).toBe(false);
        const otherRoot = new MatrixEvent({ ...root.event, event_id: "$other" });
        threads.push({ id: "$other", rootEvent: otherRoot } as Thread);
        const pending = Promise.withResolvers<threadHelpers.ThreadMetadata>();
        read.mockImplementation(async (_client, _room, event) =>
            event.getId() === "$other" ? pending.promise : { name: "Recovered", archived: false },
        );
        room.emit(ThreadEvent.New, threads[1], false);
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        client.emit(MatrixEventEvent.Decrypted, root);
        pending.resolve({ name: "Other", archived: false });
        await vi.waitFor(() =>
            expect(vm.getSnapshot().threads.find((thread) => thread.id === "$root")?.canManage).toBe(true),
        );
        expect(vm.getSnapshot().error).toBeUndefined();
        expect(read).toHaveBeenCalledTimes(3);
    });

    it("does not retry failed decryption notifications in a loop and prunes vanished thread errors", async () => {
        vi.spyOn(threadHelpers, "readThreadMetadata").mockRejectedValue(
            new ThreadMetadataReadError("keys", "Missing keys"),
        );
        await vm.retry();
        const read = vi.mocked(threadHelpers.readThreadMetadata);
        read.mockClear();
        vi.useFakeTimers();
        client.emit(MatrixEventEvent.Decrypted, root, new Error("Still missing keys"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(read).not.toHaveBeenCalled();
        expect(vm.getSnapshot().error).toBe(_t("matcha_threads|metadata_keys_error"));
        panel.isOpenForRoom.mockReturnValue(false);
        const removed = threads[0];
        threads = [];
        room.emit(ThreadEvent.Delete, removed);
        expect(vm.getSnapshot().threads).toEqual([]);
        expect(vm.getSnapshot().error).toBeUndefined();
    });

    it("does not refetch when reading history emits decryption callbacks", async () => {
        const update: IEvent = {
            event_id: "$updated",
            type: THREAD_METADATA_EVENT,
            room_id: room.roomId,
            sender: "@alice:server",
            origin_server_ts: 1,
            unsigned: {},
            content: {
                "version": 1,
                "name": "Renamed",
                "archived": false,
                "m.relates_to": { rel_type: "m.reference", event_id: "$root" },
            },
        };
        vi.mocked(client.fetchRelations)
            .mockClear()
            .mockResolvedValue({ chunk: [update] });
        vi.mocked(client.decryptEventIfNeeded).mockImplementation(async (event) => {
            client.emit(MatrixEventEvent.Decrypted, event);
        });
        vi.useFakeTimers();
        await vm.retry();
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.fetchRelations).toHaveBeenCalledTimes(1);
        expect(vm.getSnapshot().threads[0]).toMatchObject({ title: "Renamed", canManage: true });
    });

    it("keeps the displayed name and fetches one follow-up for a live encrypted revision during loading", async () => {
        const update: IEvent = {
            event_id: "$updated",
            type: THREAD_METADATA_EVENT,
            room_id: room.roomId,
            sender: "@alice:server",
            origin_server_ts: 1,
            unsigned: {},
            content: {
                "version": 1,
                "name": "Live name",
                "archived": true,
                "m.relates_to": { rel_type: "m.reference", event_id: "$root" },
            },
        };
        const first = Promise.withResolvers<IRelationsResponse>();
        vi.mocked(client.fetchRelations)
            .mockClear()
            .mockReturnValueOnce(first.promise)
            .mockResolvedValue({ chunk: [update] });
        const refresh = vm.retry();
        await vi.waitFor(() => expect(client.fetchRelations).toHaveBeenCalledTimes(1));
        const encrypted = new MatrixEvent({
            ...update,
            type: "m.room.encrypted",
            content: {
                "ciphertext": "encrypted",
                "m.relates_to": { rel_type: "m.reference", event_id: "$root" },
            },
        });
        client.emit(RoomEvent.Timeline, encrypted, room, false, false, {
            timeline: room.getLiveTimeline(),
            liveEvent: true,
        });
        expect(vm.getSnapshot().threads[0].title).toBe("Project plans");
        first.resolve({ chunk: [] });
        await refresh;
        await vi.waitFor(() => expect(vm.getSnapshot().threads[0].title).toBe("Live name"));
        expect(client.fetchRelations).toHaveBeenCalledTimes(2);
        expect(vm.getSnapshot().threads[0].archived).toBe(true);
    });

    it("prevents duplicate reminder dialogs and releases its listeners", async () => {
        const pending = Promise.withResolvers<Awaited<ReturnType<typeof reminders.scheduleRoomReminder>>>();
        const schedule = vi.spyOn(reminders, "scheduleRoomReminder").mockReturnValue(pending.promise);
        const first = vm.setReminder();
        await vm.setReminder();
        expect(schedule).toHaveBeenCalledTimes(1);
        pending.resolve(undefined);
        await first;
        expect(vm.getSnapshot().busy).toBe(false);
        vm.dispose();
        expect(panel.listenerCount(UPDATE_EVENT)).toBe(0);
        expect(room.listenerCount(ThreadEvent.New)).toBe(0);
    });
});
