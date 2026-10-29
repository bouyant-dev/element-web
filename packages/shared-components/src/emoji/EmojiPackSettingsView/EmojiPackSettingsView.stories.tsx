/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
    EmojiPackSettingsView,
    type EmojiPackSettingsEmoji,
    type EmojiPackSettingsViewActions,
    type EmojiPackSettingsViewSnapshot,
} from "./EmojiPackSettingsView";
import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";

type EmojiPackSettingsProps = EmojiPackSettingsViewSnapshot & EmojiPackSettingsViewActions;

const EmojiPackSettingsViewWrapperImpl = ({
    upload,
    rename,
    remove,
    dismissError,
    renamePack,
    setUsedEverywhere,
    deletePack,
    ...rest
}: EmojiPackSettingsProps): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        upload,
        rename,
        remove,
        dismissError,
        renamePack,
        setUsedEverywhere,
        deletePack,
    });
    return <EmojiPackSettingsView vm={vm} />;
};
const EmojiPackSettingsViewWrapper = withViewDocs(EmojiPackSettingsViewWrapperImpl, EmojiPackSettingsView);

/** A smiley face as an inline SVG, so stories need no network. */
const face = (color: string): string =>
    "data:image/svg+xml," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${color}"/>` +
            `<circle cx="11" cy="13" r="2"/><circle cx="21" cy="13" r="2"/>` +
            `<path d="M10 19q6 6 12 0" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>`,
    );

const emojis: EmojiPackSettingsEmoji[] = [
    { shortcode: "blobcat", src: face("#f6c343") },
    { shortcode: "matcha", src: face("#7cb342") },
    { shortcode: "party_parrot", src: face("#ef5350") },
    { shortcode: "thinking-hard", src: face("#42a5f5") },
];

const meta = {
    title: "Emoji/EmojiPackSettingsView",
    component: EmojiPackSettingsViewWrapper,
    tags: ["autodocs"],
    args: {
        emojis,
        stickers: [
            { shortcode: "frog_wave", src: face("#66bb6a") },
            { shortcode: "frog_cry", src: face("#29b6f6") },
        ],
        canEdit: true,
        busy: false,
        upload: fn(),
        rename: fn(),
        remove: fn(),
        dismissError: fn(),
        renamePack: fn(),
        setUsedEverywhere: fn(),
        deletePack: fn(),
    },
} satisfies Meta<typeof EmojiPackSettingsViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadOnly: Story = {
    args: { canEdit: false },
};

export const Empty: Story = {
    args: { emojis: [], stickers: [] },
};

export const RoomPack: Story = {
    args: { name: "Pepe", usedEverywhere: true, canDelete: true },
};

export const RoomPackReadOnly: Story = {
    args: { name: "Pepe", usedEverywhere: false, canEdit: false },
};

export const WithError: Story = {
    args: { error: "party.png is larger than 512 KB." },
};

export const Busy: Story = {
    args: { busy: true },
};
