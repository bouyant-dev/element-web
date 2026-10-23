/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import { describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { spaceForRoomDocuments } from "./spaceDocuments";

const chat = { roomId: "!child:server", getMyMembership: () => "join" } as Room;
const space = { roomId: "!nested:server", isSpaceRoom: () => true, getMyMembership: () => "join" } as Room;

describe("spaceForRoomDocuments", () => {
    it("includes the selected Space itself without requiring a self-child relation", () => {
        expect(spaceForRoomDocuments({ activeSpaceRoom: space, isRoomInSpace: () => false }, space)).toBe(space);
    });
    it("uses the explicitly selected nested Space for a room with multiple possible parents", () => {
        const isRoomInSpace = vi.fn().mockReturnValue(true);
        expect(spaceForRoomDocuments({ activeSpaceRoom: space, isRoomInSpace }, chat)).toBe(space);
        expect(isRoomInSpace).toHaveBeenCalledWith(space.roomId, chat.roomId);
    });
    it.each([
        ["Home or Personal", null, true, chat],
        ["an unrelated selected Space", space, false, chat],
        ["a module pseudo-space", { ...space, isSpaceRoom: () => false } as Room, true, chat],
        ["a Space the user has left", { ...space, getMyMembership: () => "leave" } as Room, true, chat],
        ["a chat the user has left", space, true, { ...chat, getMyMembership: () => "leave" } as Room],
    ] as const)("has no implicit document for %s", (_description, activeSpaceRoom, contains, room) => {
        expect(spaceForRoomDocuments({ activeSpaceRoom, isRoomInSpace: () => contains }, room)).toBeUndefined();
    });
});
