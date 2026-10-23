/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EventType, MatrixEvent, Room, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { SpaceDocsViewModel } from "./SpaceDocsViewModel";
import { ROOM_DOC_EVENT } from "../../utils/matcha/documents";
import Modal from "../../Modal";

describe("SpaceDocsViewModel", () => {
    let client: MatrixClient;
    let space: Room;
    let vm: SpaceDocsViewModel;
    let encryption: Record<string, unknown> | undefined;
    let powers: Record<string, unknown>;
    let acknowledgePower: boolean;

    function state(type: string, content: Record<string, unknown>): void {
        space.currentState.setStateEvents([new MatrixEvent({ room_id: space.roomId, type, state_key: "", content })]);
    }

    beforeEach(() => {
        client = stubClient();
        space = new Room("!space:server", client, client.getSafeUserId());
        space.name = "Team space";
        state(EventType.RoomCreate, { type: "m.space" });
        vi.spyOn(space, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(space.currentState, "maySendStateEvent").mockReturnValue(true);
        encryption = undefined;
        acknowledgePower = true;
        powers = {
            events_default: 100,
            state_default: 50,
            invite: 50,
            users: { [client.getSafeUserId()]: 100 },
            events: { "m.space.child": 50, "custom.existing": 70 },
            notifications: { room: 80 },
        };
        state(EventType.RoomPowerLevels, powers);
        client.getStateEvent = vi.fn();
        vi.mocked(client.getStateEvent).mockImplementation(async (_id, type) => {
            if (type === EventType.RoomEncryption) {
                if (!encryption) throw { errcode: "M_NOT_FOUND" };
                return encryption;
            }
            return powers;
        });
        vi.mocked(client.sendStateEvent).mockImplementation(async (_id, type, content) => {
            if (type === EventType.RoomEncryption) {
                encryption = content as Record<string, unknown>;
                state(type, encryption);
            } else {
                powers = content as Record<string, unknown>;
                if (acknowledgePower) state(type, powers);
            }
            return { event_id: "$state" };
        });
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            close: vi.fn(),
            finished: Promise.resolve([true]),
        } as ReturnType<typeof Modal.createDialog>);
        vm = new SpaceDocsViewModel({ space, client });
    });

    afterEach(() => {
        vm?.dispose();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("never writes on construction or a read-only status check", async () => {
        expect(vm.getSnapshot()).toMatchObject({ configured: false, canSetup: true, busy: false });
        expect(client.getStateEvent).not.toHaveBeenCalled();
        await vm.retry();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(Modal.createDialog).not.toHaveBeenCalled();
    });

    it("requires both administrator capabilities and actual joined Space membership", async () => {
        vi.mocked(space.currentState.maySendStateEvent).mockImplementation(
            (type) => type !== EventType.RoomPowerLevels,
        );
        await vm.enable();
        expect(vm.getSnapshot().canSetup).toBe(false);
        vi.mocked(space.currentState.maySendStateEvent).mockReturnValue(true);
        vi.mocked(space.getMyMembership).mockReturnValue(KnownMembership.Leave);
        await vm.enable();
        vi.mocked(space.getMyMembership).mockReturnValue(KnownMembership.Join);
        vi.spyOn(space, "isSpaceRoom").mockReturnValue(false);
        await vm.enable();
        expect(Modal.createDialog).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("does nothing after the administrator cancels the confirmation", async () => {
        vi.mocked(Modal.createDialog).mockReturnValue({
            close: vi.fn(),
            finished: Promise.resolve([false]),
        } as ReturnType<typeof Modal.createDialog>);
        await vm.enable();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(vm.getSnapshot().busy).toBe(false);
    });

    it("enables encryption first and preserves freshly read power levels except the two requested events", async () => {
        powers = { ...powers, invite: 75, users: { [client.getSafeUserId()]: 100, "@moderator:server": 70 } };
        const original = structuredClone(powers);
        await vm.enable();
        expect(client.sendStateEvent).toHaveBeenNthCalledWith(
            1,
            space.roomId,
            EventType.RoomEncryption,
            { algorithm: "m.megolm.v1.aes-sha2" },
            "",
        );
        expect(client.sendStateEvent).toHaveBeenNthCalledWith(
            2,
            space.roomId,
            EventType.RoomPowerLevels,
            {
                ...original,
                events: {
                    ...(original.events as Record<string, number>),
                    [ROOM_DOC_EVENT]: 0,
                    [EventType.RoomMessageEncrypted]: 0,
                },
            },
            "",
        );
        expect(vi.mocked(client.getStateEvent).mock.invocationCallOrder[1]).toBeGreaterThan(
            vi.mocked(client.sendStateEvent).mock.invocationCallOrder[0],
        );
        expect(vm.getSnapshot()).toMatchObject({ configured: true, busy: false, error: undefined });
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("does not expose Docs until the granted permissions arrive in SDK state", async () => {
        acknowledgePower = false;
        const enabling = vm.enable();
        await vi.waitFor(() => expect(client.sendStateEvent).toHaveBeenCalledTimes(2));
        expect(vm.getSnapshot()).toMatchObject({ configured: false, busy: true });
        state(EventType.RoomPowerLevels, powers);
        await enabling;
        expect(vm.getSnapshot()).toMatchObject({ configured: true, busy: false });
    });

    it("keeps encryption after partial failure and safely finishes setup on a later confirmed attempt", async () => {
        const readState = vi.mocked(client.getStateEvent).getMockImplementation()!;
        vi.mocked(client.getStateEvent).mockImplementation(async (...args) => {
            if (args[1] === EventType.RoomPowerLevels) throw new Error("offline");
            return readState(...args);
        });
        await vm.enable();
        expect(encryption).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
        expect(vm.getSnapshot()).toMatchObject({ configured: false, error: expect.any(String) });
        expect(client.sendStateEvent).toHaveBeenCalledTimes(1);
        vi.mocked(client.getStateEvent).mockImplementation(readState);
        await vm.enable();
        expect(client.sendStateEvent).toHaveBeenCalledTimes(2);
        expect(vm.getSnapshot().configured).toBe(true);
    });

    it("does not overwrite unsupported encryption or treat an offline state read as unencrypted", async () => {
        encryption = { algorithm: "unknown.algorithm" };
        await vm.enable();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        vi.mocked(client.getStateEvent).mockRejectedValue(new Error("offline"));
        await vm.enable();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(vm.getSnapshot()).toMatchObject({ configured: false, error: expect.any(String) });
    });

    it("rechecks administrator permission after confirmation and lets ordinary members use configured Docs", async () => {
        vi.mocked(Modal.createDialog).mockImplementation(() => {
            vi.mocked(space.currentState.maySendStateEvent).mockReturnValue(false);
            return { close: vi.fn(), finished: Promise.resolve([true]) } as ReturnType<typeof Modal.createDialog>;
        });
        await vm.enable();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        state(EventType.RoomEncryption, { algorithm: "m.megolm.v1.aes-sha2" });
        state(EventType.RoomPowerLevels, {
            ...powers,
            events: { [ROOM_DOC_EVENT]: 0, [EventType.RoomMessageEncrypted]: 0 },
        });
        expect(vm.getSnapshot()).toMatchObject({ configured: true, canSetup: false });
    });
});
