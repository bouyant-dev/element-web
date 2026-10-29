/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import {
    EmojiPackSettingsView,
    NewEmojiPackView,
    useCreateAutoDisposedViewModel,
    useViewModel,
} from "@element-hq/web-shared-components";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import { EmojiPackSettingsViewModel } from "../../../../../viewmodels/emoji/EmojiPackSettingsViewModel";
import { RoomEmojiPacksViewModel } from "../../../../../viewmodels/emoji/RoomEmojiPacksViewModel";

/**
 * Room or Space settings tab managing the custom emoji and sticker packs shared with everyone in it.
 * @param room - the room or Space whose packs are managed
 */
export function EmojiRoomSettingsTab({ room }: { room: Room }): JSX.Element {
    const packsVm = useCreateAutoDisposedViewModel(() => new RoomEmojiPacksViewModel({ client: room.client, room }));
    const { stateKeys } = useViewModel(packsVm);
    return (
        <SettingsTab>
            <SettingsSection heading={_t("matcha_emoji|title")}>
                <SettingsSubsection
                    description={
                        room.isSpaceRoom() ? _t("matcha_emoji|space_description") : _t("matcha_emoji|room_description")
                    }
                >
                    {stateKeys.map((stateKey) => (
                        <RoomPack key={stateKey} room={room} stateKey={stateKey} />
                    ))}
                    <NewEmojiPackView vm={packsVm} />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}

function RoomPack({ room, stateKey }: { room: Room; stateKey: string }): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(
        () => new EmojiPackSettingsViewModel({ client: room.client, target: { kind: "room", room, stateKey } }),
    );
    return <EmojiPackSettingsView vm={vm} />;
}
