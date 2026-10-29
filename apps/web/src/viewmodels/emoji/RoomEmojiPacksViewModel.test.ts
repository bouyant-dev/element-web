/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType, MatrixError, MatrixEvent, Room, RoomStateEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { RoomEmojiPacksViewModel } from "./RoomEmojiPacksViewModel";
import { EMOTE_ROOMS_EVENT, ROOM_EMOTES_EVENT } from "../../utils/matcha/imagePacks";

describe("RoomEmojiPacksViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let vm: RoomEmojiPacksViewModel;
    let me: string;

    const setState = (type: string, content: object, eventId: string, stateKey = ""): void => {
        room.currentState.setStateEvents([
            new MatrixEvent({
                type,
                state_key: stateKey,
                room_id: room.roomId,
                event_id: eventId,
                sender: me,
                content,
            }),
        ]);
    };
    const settle = (): Promise<void> => vi.waitFor(() => expect(vm.getSnapshot().busy).toBe(false));

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        me = client.getSafeUserId();
        room = new Room("!crew:server", client, me);
        room.currentState.on(RoomStateEvent.Events, (...args) => client.emit(RoomStateEvent.Events, ...args));
        room.currentState.on(RoomStateEvent.Update, (...args) => client.emit(RoomStateEvent.Update, ...args));
        setState(EventType.RoomCreate, { room_version: "10" }, "$create");
        setState(EventType.RoomMember, { membership: KnownMembership.Join }, "$join", me);
        setState(EventType.RoomPowerLevels, { users: { [me]: 100 }, state_default: 50 }, "$pl");
        setState(ROOM_EMOTES_EVENT, { pack: { display_name: "Pepe" }, images: {} }, "$pepe", "pepe");
        setState(ROOM_EMOTES_EVENT, {}, "$gone", "gone");
        vi.mocked(client.sendStateEvent).mockResolvedValue({ event_id: "$sent" });
        vi.mocked(client.setAccountData).mockResolvedValue({});
        vm = new RoomEmojiPacksViewModel({ client, room });
    });

    afterEach(() => {
        vm.dispose();
        vi.restoreAllMocks();
    });

    it("lists the default pack first and leaves deleted packs out", () => {
        expect(vm.getSnapshot()).toEqual({ stateKeys: ["", "pepe"], canCreate: true, busy: false });
    });

    it("follows pack changes and permissions, keeping the list when nothing changed", () => {
        const before = vm.getSnapshot().stateKeys;
        setState(ROOM_EMOTES_EVENT, { images: {} }, "$default");
        expect(vm.getSnapshot().stateKeys).toBe(before);

        setState(ROOM_EMOTES_EVENT, {}, "$pepe-gone", "pepe");
        expect(vm.getSnapshot().stateKeys).toEqual([""]);

        setState(EventType.RoomPowerLevels, { users: { [me]: 0 }, state_default: 50 }, "$pl2");
        expect(vm.getSnapshot().canCreate).toBe(false);
    });

    it("creates a named pack under a new state key and lists it once its state arrives", async () => {
        vm.createPack("  Pepe  ");
        await settle();
        // "pepe" is taken.
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            room.roomId,
            ROOM_EMOTES_EVENT,
            { pack: { display_name: "Pepe" }, images: {} },
            "pepe-2",
        );
        expect(vm.getSnapshot().stateKeys).toEqual(["", "pepe"]);

        setState(ROOM_EMOTES_EVENT, { pack: { display_name: "Pepe" }, images: {} }, "$echo", "pepe-2");
        expect(vm.getSnapshot().stateKeys).toEqual(["", "pepe", "pepe-2"]);
        setState(ROOM_EMOTES_EVENT, {}, "$deleted", "pepe-2");
        expect(vm.getSnapshot().stateKeys).toEqual(["", "pepe"]);
    });

    it("offers a new pack in all the creator's rooms, keeping the other entries", async () => {
        vi.mocked(client.getAccountData).mockImplementation((type) =>
            type === EMOTE_ROOMS_EVENT
                ? new MatrixEvent({ type, content: { rooms: { "!other:server": { fav: {} } } } })
                : undefined,
        );
        vm.createPack("Cats");
        await settle();
        expect(client.setAccountData).toHaveBeenCalledWith(EMOTE_ROOMS_EVENT, {
            rooms: { "!other:server": { fav: {} }, [room.roomId]: { cats: {} } },
        });
    });

    it("still finishes creating when the pack cannot be offered everywhere", async () => {
        vi.mocked(client.setAccountData).mockRejectedValueOnce(new Error("offline"));
        vm.createPack("Cats");
        await settle();
        expect(vm.getSnapshot().error).toBeUndefined();
    });

    it("refuses names longer than 100 characters", () => {
        vm.createPack("x".repeat(101));
        expect(vm.getSnapshot().error).toBe("Pack names can be at most 100 characters.");
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("does not reuse a deleted pack's state key", async () => {
        vm.createPack("gone");
        await settle();
        expect(vi.mocked(client.sendStateEvent).mock.calls[0][3]).toBe("gone-2");
    });

    it("asks for a name", () => {
        vm.createPack("   ");
        expect(vm.getSnapshot().error).toBe("Enter a name for the pack.");
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        vm.dismissError();
        expect(vm.getSnapshot().error).toBeUndefined();
    });

    it("explains why a pack could not be created", async () => {
        vi.mocked(client.sendStateEvent).mockRejectedValueOnce(
            new MatrixError({ errcode: "M_FORBIDDEN", error: "no" }, 403),
        );
        vm.createPack("Cats");
        await settle();
        expect(vm.getSnapshot().error).toBe("You don't have permission to add packs here.");
        // A pack that was not created is not offered anywhere.
        expect(client.setAccountData).not.toHaveBeenCalled();

        vi.mocked(client.sendStateEvent).mockRejectedValueOnce(new Error("offline"));
        vm.createPack("Cats");
        await settle();
        expect(vm.getSnapshot().error).toBe("The pack could not be created. Check your connection, then try again.");
        expect(vm.getSnapshot().stateKeys).toEqual(["", "pepe"]);
    });
});
