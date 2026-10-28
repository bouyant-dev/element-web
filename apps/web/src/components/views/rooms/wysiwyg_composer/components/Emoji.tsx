/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type PickerCustomEmoji } from "@element-hq/web-shared-components";

import { type MenuProps } from "../../../../structures/ContextMenu";
import { EmojiButton } from "../../EmojiButton";
import dis from "../../../../../dispatcher/dispatcher";
import { type ComposerInsertPayload } from "../../../../../dispatcher/payloads/ComposerInsertPayload";
import { Action } from "../../../../../dispatcher/actions";
import { useScopedRoomContext } from "../../../../../contexts/ScopedRoomContext.tsx";

interface EmojiProps {
    menuPosition: MenuProps;
}

export function Emoji({ menuPosition }: EmojiProps): JSX.Element {
    const roomContext = useScopedRoomContext("timelineRenderingType");

    return (
        <EmojiButton
            menuPosition={menuPosition}
            addEmoji={(emoji: string, custom?: PickerCustomEmoji) => {
                dis.dispatch<ComposerInsertPayload>({
                    action: Action.ComposerInsert,
                    // composers that cannot show custom emoji insert the shortcode instead
                    text: custom ? `:${custom.shortcode}:` : emoji,
                    customEmoji: custom && { url: custom.key, shortcode: custom.shortcode },
                    timelineRenderingType: roomContext.timelineRenderingType,
                });
                return true;
            }}
        />
    );
}
