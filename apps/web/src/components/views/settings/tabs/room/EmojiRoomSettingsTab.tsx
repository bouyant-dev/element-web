/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { EmojiPackSettingsView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import { EmojiPackSettingsViewModel } from "../../../../../viewmodels/emoji/EmojiPackSettingsViewModel";

/**
 * Room or Space settings tab managing the custom emoji pack shared with everyone in it.
 * @param room - the room or Space whose pack is managed
 */
export function EmojiRoomSettingsTab({ room }: { room: Room }): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(
        () => new EmojiPackSettingsViewModel({ client: room.client, target: { kind: "room", room } }),
    );
    return (
        <SettingsTab>
            <SettingsSection heading={_t("matcha_emoji|title")}>
                <SettingsSubsection
                    description={
                        room.isSpaceRoom() ? _t("matcha_emoji|space_description") : _t("matcha_emoji|room_description")
                    }
                >
                    <EmojiPackSettingsView vm={vm} />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
