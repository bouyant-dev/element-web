/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";
import type SpaceStore from "../../stores/spaces/SpaceStore";

/** Resolve Docs only in the explicitly selected containing Space, never from an arbitrary parent. */
export function spaceForRoomDocuments(
    store: Pick<SpaceStore, "activeSpaceRoom" | "isRoomInSpace">,
    room: Room,
): Room | undefined {
    const space = store.activeSpaceRoom;
    return space?.isSpaceRoom() &&
        space.getMyMembership() === "join" &&
        room.getMyMembership() === "join" &&
        (space.roomId === room.roomId || store.isRoomInSpace(space.roomId, room.roomId))
        ? space
        : undefined;
}
