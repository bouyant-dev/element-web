/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { EmojiPackSettingsView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { EmojiPackSettingsViewModel } from "../../../../../viewmodels/emoji/EmojiPackSettingsViewModel";

/** User settings tab managing the personal custom emoji pack, usable in every room. */
export function EmojiUserSettingsTab(): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () => new EmojiPackSettingsViewModel({ client, target: { kind: "user" } }),
    );
    return (
        <SettingsTab>
            <SettingsSection heading={_t("matcha_emoji|title")}>
                <SettingsSubsection description={_t("matcha_emoji|user_description")}>
                    <EmojiPackSettingsView vm={vm} />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
