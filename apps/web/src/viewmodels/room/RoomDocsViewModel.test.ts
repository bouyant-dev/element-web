/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType, MatrixEvent, Room, RoomEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { RoomDocsViewModel } from "./RoomDocsViewModel";

describe("RoomDocsViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let vm: RoomDocsViewModel;
    beforeEach(async () => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room("!docs:server", client, client.getSafeUserId());
        room.name = "Product";
        const create = new MatrixEvent({
            type: EventType.RoomCreate,
            event_id: "$create",
            room_id: room.roomId,
            state_key: "",
            content: {},
            sender: "@owner:server",
        });
        room.currentState.setStateEvents([create]);
        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(room.currentState, "maySendEvent").mockReturnValue(true);
        vi.spyOn(client, "fetchRoomEvent").mockResolvedValue(create.event);
        client.fetchRelations = vi.fn<MatrixClient["fetchRelations"]>().mockResolvedValue({ chunk: [] });
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$sent" });
        vm = new RoomDocsViewModel({ client, room });
        await vm.retry();
    });
    afterEach(async () => {
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$cleanup" });
        await vm.retry();
        vm.dispose();
        vi.restoreAllMocks();
    });

    it("binds the shared text, renders safe Markdown and follows room names", async () => {
        expect(vm.getSnapshot()).toMatchObject({ roomName: "Product", mode: "edit", ready: true, canEdit: true });
        vm.getText().insert(0, "# Shared plan\n\n<script>alert(1)</script>");
        expect(vm.getMarkdown()).toContain("# Shared plan");
        expect(vm.getSnapshot().pendingUpdates).toBe(1);
        vm.setMode("preview");
        expect(vm.getSnapshot().html).toContain("<h1>Shared plan</h1>");
        expect(vm.getSnapshot().html).not.toContain("<script>");
        room.name = "Engineering";
        room.emit(RoomEvent.Name, room);
        expect(vm.getSnapshot().roomName).toBe("Engineering");
        await vm.retry();
        expect(vm.getSnapshot()).toMatchObject({ sync: "saved", pendingUpdates: 0 });
    });

    it("retains failed edits when the view is disposed and reopened", async () => {
        vi.mocked(client.sendEvent).mockRejectedValue(new Error("offline"));
        vm.getText().insert(0, "Local recovery draft");
        await vm.retry();
        expect(vm.getSnapshot()).toMatchObject({ sync: "error", pendingUpdates: 1 });
        vm.dispose();
        vm = new RoomDocsViewModel({ client, room });
        expect(vm.getMarkdown()).toBe("Local recovery draft");
        await vi.waitFor(() => expect(vm.getSnapshot().error).toBeTruthy());
        vi.mocked(client.sendEvent).mockResolvedValue({ event_id: "$recovered" });
        await vm.retry();
        expect(vm.getSnapshot()).toMatchObject({ sync: "saved", pendingUpdates: 0 });
    });
});
