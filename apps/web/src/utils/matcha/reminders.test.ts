/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { isValidReminder, scheduleRoomReminder } from "./reminders";
import Modal from "../../Modal";
import InfoDialog from "../../components/views/dialogs/InfoDialog";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";

describe("room reminders", () => {
    afterEach(() => vi.restoreAllMocks());

    it("accepts bounded delays and rejects empty, excessive, or ambiguous inputs", () => {
        for (const value of ["10m Check build", "1h Review", "365d Renewal", "1s Test"]) {
            expect(isValidReminder(value)).toBe(true);
        }
        for (const value of [
            "0m Nope",
            "-1h Nope",
            "366d Nope",
            "1e9s Nope",
            "tomorrow Review",
            "1h ",
            "1m " + "x".repeat(2001),
        ]) {
            expect(isValidReminder(value)).toBe(false);
        }
    });

    function setup(membership = "join"): { client: MatrixClient; room: Room } {
        return {
            client: {
                getSafeUserId: () => "@me:server",
                sendTextMessage: vi.fn(),
                invite: vi.fn(),
            } as unknown as MatrixClient,
            room: {
                roomId: "!room:server",
                maySendMessage: () => true,
                canInvite: () => true,
                getMember: () => ({ membership }),
            } as unknown as Room,
        };
    }

    it("sends a reminder to the selected room only after confirmation", async () => {
        const { client, room } = setup();
        const dialog = vi.spyOn(Modal, "createDialog").mockReturnValue({
            close: vi.fn(),
            finished: Promise.resolve([true, "10m Check build"]),
        } as ReturnType<typeof Modal.createDialog>);
        await scheduleRoomReminder(client, room, "@bot:server");
        expect(dialog).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({ usePlaceholderAsHint: true }),
        );
        expect(client.sendTextMessage).toHaveBeenCalledWith(room.roomId, "!remind 10m Check build");
        expect(dialog).toHaveBeenLastCalledWith(InfoDialog, expect.anything());
    });

    it("does not invite a bot after cancellation", async () => {
        const { client, room } = setup("leave");
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            close: vi.fn(),
            finished: Promise.resolve([false]),
        } as ReturnType<typeof Modal.createDialog>);
        await scheduleRoomReminder(client, room, "@bot:server");
        expect(client.invite).not.toHaveBeenCalled();
        expect(client.sendTextMessage).not.toHaveBeenCalled();
    });

    it("waits for an invited bot rather than losing a command before it joins", async () => {
        const { client, room } = setup("leave");
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            close: vi.fn(),
            finished: Promise.resolve([true]),
        } as ReturnType<typeof Modal.createDialog>);
        await scheduleRoomReminder(client, room, "@bot:server");
        expect(client.invite).toHaveBeenCalledWith(room.roomId, "@bot:server");
        expect(client.sendTextMessage).not.toHaveBeenCalled();
    });

    it("does not send after membership changes while the dialog is open", async () => {
        const { client, room } = setup();
        vi.spyOn(Modal, "createDialog").mockImplementation(() => {
            vi.spyOn(room, "getMember").mockReturnValue(null);
            return { close: vi.fn(), finished: Promise.resolve([true, "10m Check build"]) } as ReturnType<
                typeof Modal.createDialog
            >;
        });
        await scheduleRoomReminder(client, room, "@bot:server");
        expect(client.sendTextMessage).not.toHaveBeenCalled();
    });

    it("shows failure rather than claiming a failed send was scheduled", async () => {
        const { client, room } = setup();
        vi.mocked(client.sendTextMessage).mockRejectedValue(new Error("offline"));
        const dialog = vi
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ close: vi.fn(), finished: Promise.resolve([true, "10m Review"]) } as ReturnType<
                typeof Modal.createDialog
            >);
        await scheduleRoomReminder(client, room, "@bot:server");
        expect(dialog).toHaveBeenLastCalledWith(ErrorDialog, expect.anything());
    });
});
