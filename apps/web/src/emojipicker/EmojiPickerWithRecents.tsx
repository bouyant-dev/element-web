/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useMemo } from "react";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import {
    EmojiPicker,
    type EmojiPickerProps,
    type PickerCustomEmoji,
    type PickerCustomEmojiCategory,
} from "@element-hq/web-shared-components";
import * as recent from "./recent";
import { getWebRovingAction } from "../accessibility/RovingTabIndex";
import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { useScopedRoomContext } from "../contexts/ScopedRoomContext";
import { mediaFromMxc } from "../customisations/Media";
import { useCustomEmojiPacks } from "../hooks/useCustomEmojiPacks";
import { type EmojiPack } from "../utils/matcha/imagePacks";

/**
 * Props for {@link EmojiPickerWithRecents}.
 */
interface EmojiPickerWithRecentsProps extends Omit<
    EmojiPickerProps,
    "recentEmojis" | "onRecordRecent" | "getAction" | "customEmojiCategories"
> {
    /** Room whose custom emoji to offer. Defaults to the room in the RoomContext, if any. */
    room?: Room;
}

/** Turns custom emoji packs into picker categories, leaving out images that cannot be displayed. */
function toPickerCategories(packs: EmojiPack[], client: MatrixClient): PickerCustomEmojiCategory[] {
    return packs
        .map((pack) => ({
            id: pack.id,
            name: pack.name,
            iconSrc: (pack.avatarUrl && mediaFromMxc(pack.avatarUrl, client).srcHttp) || undefined,
            emojis: pack.emojis.flatMap(({ shortcode, url }): PickerCustomEmoji[] => {
                const src = mediaFromMxc(url, client).srcHttp;
                return src ? [{ key: url, shortcode, src }] : [];
            }),
        }))
        .filter((category) => category.emojis.length > 0);
}

/**
 * Wrapped version of the shared-components emoji picker that passes in
 * the recent emojis from the web app's local storage (also passes in the
 * web roving actions) and the custom emoji available in the room.
 */
export function EmojiPickerWithRecents({
    selectedEmojis,
    onChoose,
    onFinished,
    isEmojiDisabled,
    room,
}: EmojiPickerWithRecentsProps): React.ReactNode {
    // There isn't anything for us to key the memoisation off here. This will just
    // update when the component mounts which is probably good enough.
    const recentEmojis = useMemo(() => recent.get(), []);
    const client = useMatrixClientContext();
    const { room: contextRoom } = useScopedRoomContext("room");
    const packs = useCustomEmojiPacks(room ?? contextRoom);
    const customEmojiCategories = useMemo(() => toPickerCategories(packs, client), [packs, client]);

    return (
        <EmojiPicker
            selectedEmojis={selectedEmojis}
            onChoose={onChoose}
            onFinished={onFinished}
            isEmojiDisabled={isEmojiDisabled}
            getAction={getWebRovingAction}
            recentEmojis={recentEmojis}
            onRecordRecent={recent.add}
            customEmojiCategories={customEmojiCategories}
        />
    );
}
