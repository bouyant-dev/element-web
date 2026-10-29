/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useCallback, useEffect, useState } from "react";
import { isEqual } from "lodash";
import {
    ClientEvent,
    EventType,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    RoomStateEvent,
} from "matrix-js-sdk/src/matrix";

import SdkConfig from "../SdkConfig";
import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { _t } from "../languageHandler";
import {
    EMOTE_ROOMS_EVENT,
    type EmojiPack,
    getEmojiPacks,
    getParentSpaceIds,
    getStickerPacks,
    ROOM_EMOTES_EVENT,
    type StickerPack,
    USER_EMOTES_EVENT,
} from "../utils/matcha/imagePacks";
import { useTypedEventEmitter } from "./useEventEmitter";

/**
 * Custom emoji packs usable in a room: the personal pack, packs enabled everywhere, the room's own, then those of the
 * joined Spaces the room names as its parents. Empty unless Matcha's beta features are on.
 */
export function availableEmojiPacks(client: MatrixClient, room: Room | undefined): EmojiPack[] {
    if (!SdkConfig.get("matcha_thread_tabs")) return [];
    const parents = room ? getParentSpaceIds(client, room.roomId) : [];
    return getEmojiPacks(client, room, parents, _t("matcha_emoji|personal_pack_name"));
}

/** Sticker packs usable in a room, in the same order as {@link availableEmojiPacks}. Empty unless Matcha's beta features are on. */
export function availableStickerPacks(client: MatrixClient, room: Room | undefined): StickerPack[] {
    if (!SdkConfig.get("matcha_thread_tabs")) return [];
    const parents = room ? getParentSpaceIds(client, room.roomId) : [];
    return getStickerPacks(client, room, parents, _t("matcha_stickers|personal_pack_name"));
}

/**
 * {@link availableEmojiPacks}, kept up to date as packs change. The array is only replaced when its contents change,
 * so it is safe to use as a dependency.
 */
export function useCustomEmojiPacks(room: Room | undefined): EmojiPack[] {
    return useLivePacks(room, availableEmojiPacks);
}

/** {@link availableStickerPacks}, kept up to date like {@link useCustomEmojiPacks}. */
export function useCustomStickerPacks(room: Room | undefined): StickerPack[] {
    return useLivePacks(room, availableStickerPacks);
}

function useLivePacks<T>(room: Room | undefined, read: (client: MatrixClient, room: Room | undefined) => T[]): T[] {
    const client = useMatrixClientContext();
    const [packs, setPacks] = useState(() => read(client, room));
    const refresh = useCallback((): void => {
        const next = read(client, room);
        setPacks((previous) => (isEqual(previous, next) ? previous : next));
    }, [client, room, read]);

    useEffect(refresh, [refresh]);
    useTypedEventEmitter(client, ClientEvent.AccountData, (event: MatrixEvent) => {
        if (event.getType() === USER_EMOTES_EVENT || event.getType() === EMOTE_ROOMS_EVENT) refresh();
    });
    useTypedEventEmitter(client, RoomStateEvent.Events, (event: MatrixEvent) => {
        if (event.getType() === ROOM_EMOTES_EVENT || event.getType() === EventType.SpaceParent) refresh();
    });
    return packs;
}
