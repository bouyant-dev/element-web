/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent, Room, ThreadEvent, type MatrixClient, type Thread } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";
// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";

import { RoomThreadTabsViewModel, THREAD_ARCHIVE_EVENT } from "./RoomThreadTabsViewModel";
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
    let thread: Thread;
    let vm: RoomThreadTabsViewModel;
    const panel = Object.assign(new EventEmitter(), {
        currentCardForRoom: vi.fn(),
        isOpenForRoom: vi.fn(),
        togglePanel: vi.fn(),
        setCard: vi.fn(),
    });

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room("!room:server", client, client.getSafeUserId());
        root = new MatrixEvent({
            event_id: "$root",
            room_id: room.roomId,
            type: "m.room.message",
            content: { body: "Project plans", msgtype: "m.text" },
        });
        thread = { id: "$root", rootEvent: root } as Thread;
        vi.spyOn(room, "getThreads").mockReturnValue([thread]);
        vi.spyOn(room, "getThread").mockImplementation((id) => (id === "$root" ? thread : null));
        vi.spyOn(room, "findEventById").mockImplementation((id) => (id === "$root" ? root : undefined));
        vi.spyOn(client, "fetchRoomEvent").mockImplementation(async (_roomId, id) => ({
            ...root.event,
            event_id: id,
        }));
        vi.spyOn(room, "createThreadsTimelineSets").mockResolvedValue(null);
        vi.spyOn(room, "fetchRoomThreads").mockResolvedValue();
        vi.spyOn(room.currentState, "maySendStateEvent").mockReturnValue(true);
        vi.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        vi.spyOn(client, "sendStateEvent").mockResolvedValue({ event_id: "$archive" });
        panel.currentCardForRoom.mockReturnValue({
            phase: RightPanelPhases.ThreadView,
            state: { threadHeadEvent: root },
        });
        panel.isOpenForRoom.mockReturnValue(true);
        vm = new RoomThreadTabsViewModel({ room, client, rightPanelStore: panel as unknown as RightPanelStore });
    });

    afterEach(() => {
        vm.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("loads thread titles and switches between native thread and General", async () => {
        await vm.retry();
        expect(vm.getSnapshot()).toMatchObject({
            selectedId: "$root",
            threads: [{ title: "Project plans", archived: false }],
        });
        await vm.select("$root");
        expect(panel.setCard).toHaveBeenCalledWith(
            { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: root } },
            true,
            room.roomId,
        );
        await vm.select();
        expect(panel.togglePanel).toHaveBeenCalledWith(room.roomId);
        vm.browse();
        expect(panel.setCard).toHaveBeenCalledWith({ phase: RightPanelPhases.ThreadPanel }, true, room.roomId);
    });

    it("archives only after confirmation, preserving all messages", async () => {
        await vm.retry();
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([true]),
            close: vi.fn(),
        } as ReturnType<typeof Modal.createDialog>);
        await vm.archive("$root", true);
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            room.roomId,
            THREAD_ARCHIVE_EVENT,
            { archived: true },
            "$root",
        );
        expect(panel.togglePanel).toHaveBeenCalledWith(room.roomId);
        expect(client.redactEvent).not.toHaveBeenCalled();
    });

    it("does not reopen a slowly decrypted thread after selecting General", async () => {
        await vm.retry();
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

    it("opens board views and prevents duplicate reminder dialogs", async () => {
        vm.dispose();
        const onBoardChange = vi.fn();
        vm = new RoomThreadTabsViewModel({
            room,
            client,
            rightPanelStore: panel as unknown as RightPanelStore,
            onBoardChange,
            reminderBot: "@reminder:server",
        });
        await vm.retry();
        vm.openBoard("all");
        expect(onBoardChange).toHaveBeenCalledWith("all");
        vm.setBoard("all");
        expect(vm.getSnapshot().board).toBe("all");
        const pending = Promise.withResolvers<void>();
        const schedule = vi.spyOn(reminders, "scheduleRoomReminder").mockReturnValue(pending.promise);
        const first = vm.setReminder();
        await vm.setReminder();
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(vm.getSnapshot().busy).toBe(true);
        pending.resolve();
        await first;
        expect(vm.getSnapshot().busy).toBe(false);
    });

    it("does not archive when cancelled or permission is missing", async () => {
        await vm.retry();
        const dialog = vi
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([false]), close: vi.fn() } as ReturnType<
                typeof Modal.createDialog
            >);
        await vm.archive("$root", true);
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        vi.mocked(room.currentState.maySendStateEvent).mockReturnValue(false);
        dialog.mockClear();
        await vm.archive("$root", true);
        expect(dialog).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("rechecks permission after the confirmation dialog", async () => {
        await vm.retry();
        vi.spyOn(Modal, "createDialog").mockImplementation(() => {
            vi.mocked(room.currentState.maySendStateEvent).mockReturnValue(false);
            return { finished: Promise.resolve([true]), close: vi.fn() } as ReturnType<typeof Modal.createDialog>;
        });
        await vm.archive("$root", true);
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("restores archived threads even when their old root is not loaded", async () => {
        await vm.retry();
        room.currentState.setStateEvents([
            new MatrixEvent({
                type: THREAD_ARCHIVE_EVENT,
                state_key: "$old",
                room_id: room.roomId,
                content: { archived: true },
            }),
        ]);
        room.emit(ThreadEvent.Update, thread);
        expect(vm.getSnapshot().threads).toContainEqual(expect.objectContaining({ id: "$old", archived: true }));
        vm.toggleArchived();
        expect(vm.getSnapshot().showArchived).toBe(true);
        await vm.archive("$old", false);
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            room.roomId,
            THREAD_ARCHIVE_EVENT,
            { archived: false },
            "$old",
        );
    });

    it("reports failed state writes without hiding the conversation", async () => {
        await vm.retry();
        vi.mocked(client.sendStateEvent).mockRejectedValue(new Error("Forbidden"));
        await vm.archive("$root", false);
        expect(vm.getSnapshot().error).toContain("Could not change");
        expect(panel.togglePanel).not.toHaveBeenCalled();
        expect(vm.getSnapshot().busy).toBe(false);
    });

    it("reports failed loading and releases all listeners", async () => {
        vi.mocked(room.fetchRoomThreads).mockRejectedValue(new Error("Offline"));
        await vm.retry();
        expect(vm.getSnapshot().error).toContain("Could not load");
        vm.dispose();
        expect(panel.listenerCount(UPDATE_EVENT)).toBe(0);
        expect(room.listenerCount(ThreadEvent.New)).toBe(0);
    });
});
