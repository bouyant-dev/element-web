/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "test-utils-rtl";
import { ClientEvent, EventType, type MatrixClient, MatrixEvent, Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { createTestClient, withClientContextRenderOptions } from "test-utils";

import SdkConfig from "../SdkConfig";
import {
    type EmojiPack,
    type ImagePackContent,
    ROOM_EMOTES_EVENT,
    USER_EMOTES_EVENT,
} from "../utils/matcha/imagePacks";
import {
    availableEmojiPacks,
    availableStickerPacks,
    useCustomEmojiPacks,
    useCustomStickerPacks,
} from "./useCustomEmojiPacks";

describe("useCustomEmojiPacks", () => {
    let client: MatrixClient;
    let room: Room;
    let space: Room;
    let userPack: ImagePackContent;

    const emotes = (roomId: string, content: ImagePackContent): MatrixEvent =>
        new MatrixEvent({
            type: ROOM_EMOTES_EVENT,
            state_key: "",
            content,
            room_id: roomId,
            sender: "@alice:x",
            event_id: `$${roomId}`,
        });
    const spaceParent = (roomId: string, spaceId: string, content: object): MatrixEvent =>
        new MatrixEvent({
            type: EventType.SpaceParent,
            state_key: spaceId,
            content,
            room_id: roomId,
            sender: "@alice:x",
            event_id: `$${roomId}${spaceId}`,
        });
    const ids = (packs: EmojiPack[]): string[] => packs.map((pack) => pack.id);

    beforeEach(() => {
        SdkConfig.add({ matcha_thread_tabs: true });
        client = createTestClient();
        userPack = { images: { wave: { url: "mxc://x/wave" } } };
        vi.mocked(client.getAccountData).mockImplementation((type) =>
            type === USER_EMOTES_EVENT ? new MatrixEvent({ type, content: userPack }) : undefined,
        );
        room = new Room("!room:x", client, client.getSafeUserId());
        space = new Room("!space:x", client, client.getSafeUserId());
        space.name = "Space";
        space.updateMyMembership(KnownMembership.Join);
        space.currentState.setStateEvents([emotes(space.roomId, { images: { party: { url: "mxc://x/party" } } })]);
        vi.mocked(client.getRoom).mockImplementation(
            (roomId) => [room, space].find((r) => r.roomId === roomId) ?? null,
        );
        room.currentState.setStateEvents([spaceParent(room.roomId, space.roomId, { via: ["x"] })]);
    });

    afterEach(() => {
        SdkConfig.reset();
        vi.restoreAllMocks();
    });

    describe("availableEmojiPacks", () => {
        it("should offer nothing while Matcha's beta features are off", () => {
            SdkConfig.add({ matcha_thread_tabs: false });
            expect(availableEmojiPacks(client, room)).toEqual([]);
        });

        it("should offer the personal pack and packs of the room's parent Spaces", () => {
            const packs = availableEmojiPacks(client, room);
            expect(ids(packs)).toEqual(["user", "!space:x|"]);
            expect(packs.map((pack) => pack.name)).toEqual(["Your emoji", "Space"]);
        });

        it("should offer only account packs without a room", () => {
            expect(ids(availableEmojiPacks(client, undefined))).toEqual(["user"]);
        });
    });

    describe("availableStickerPacks", () => {
        it("should offer nothing while Matcha's beta features are off", () => {
            SdkConfig.add({ matcha_thread_tabs: false });
            expect(availableStickerPacks(client, room)).toEqual([]);
        });

        it("should offer images that may be stickers, under the personal sticker pack's name", () => {
            userPack = {
                images: {
                    wave: { url: "mxc://x/wave", usage: ["sticker"] },
                    smile: { url: "mxc://x/smile", usage: ["emoticon"] },
                },
            };
            const packs = availableStickerPacks(client, room);
            expect(packs.map((pack) => pack.name)).toEqual(["Your stickers", "Space"]);
            expect(packs[0].stickers.map((sticker) => sticker.shortcode)).toEqual(["wave"]);
        });
    });

    it("should keep sticker packs up to date", () => {
        const { result } = renderHook(() => useCustomStickerPacks(room), withClientContextRenderOptions(client));
        expect(result.current.map((pack) => pack.id)).toEqual(["user", "!space:x|"]);

        userPack = { images: { sticker: { url: "mxc://x/sticker", usage: ["sticker"] } } };
        act(() => {
            client.emit(ClientEvent.AccountData, new MatrixEvent({ type: USER_EMOTES_EVENT, content: userPack }));
        });
        expect(result.current[0].stickers.map((sticker) => sticker.shortcode)).toEqual(["sticker"]);
    });

    it("should update when packs change and keep the same array otherwise", () => {
        const { result } = renderHook(() => useCustomEmojiPacks(room), withClientContextRenderOptions(client));
        const initial = result.current;
        expect(ids(initial)).toEqual(["user", "!space:x|"]);

        // Unrelated events, and pack events that change nothing, keep the array identity.
        act(() => {
            client.emit(ClientEvent.AccountData, new MatrixEvent({ type: "m.direct", content: {} }));
            client.emit(RoomStateEvent.Events, emotes(space.roomId, {}), space.currentState, null);
            client.emit(ClientEvent.AccountData, new MatrixEvent({ type: USER_EMOTES_EVENT, content: userPack }));
        });
        expect(result.current).toBe(initial);

        userPack = { images: { ...userPack.images, cat: { url: "mxc://x/cat" } } };
        act(() => {
            client.emit(ClientEvent.AccountData, new MatrixEvent({ type: USER_EMOTES_EVENT, content: userPack }));
        });
        expect(result.current[0].emojis.map((emoji) => emoji.shortcode)).toEqual(["cat", "wave"]);

        const roomPack = emotes(room.roomId, { images: { hi: { url: "mxc://x/hi" } } });
        room.currentState.setStateEvents([roomPack]);
        act(() => {
            client.emit(RoomStateEvent.Events, roomPack, room.currentState, null);
        });
        expect(ids(result.current)).toEqual(["user", "!room:x|", "!space:x|"]);

        // The room leaving the Space takes the Space's packs away.
        const removed = spaceParent(room.roomId, space.roomId, {});
        room.currentState.setStateEvents([removed]);
        act(() => {
            client.emit(RoomStateEvent.Events, removed, room.currentState, null);
        });
        expect(ids(result.current)).toEqual(["user", "!room:x|"]);
    });
});
