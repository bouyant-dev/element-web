/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
    StickerPickerView,
    type StickerPickerSticker,
    type StickerPickerViewActions,
    type StickerPickerViewSnapshot,
} from "./StickerPickerView";
import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";

type StickerPickerProps = StickerPickerViewSnapshot & StickerPickerViewActions;

const StickerPickerViewWrapperImpl = ({
    setQuery,
    selectPack,
    sendSticker,
    openSettings,
    ...rest
}: StickerPickerProps): JSX.Element => {
    const vm = useMockedViewModel(rest, { setQuery, selectPack, sendSticker, openSettings });
    return <StickerPickerView vm={vm} />;
};
const StickerPickerViewWrapper = withViewDocs(StickerPickerViewWrapperImpl, StickerPickerView);

/** A face as an inline SVG, so stories need no network. */
const face = (color: string): string =>
    "data:image/svg+xml," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}"/>` +
            `<circle cx="22" cy="26" r="4"/><circle cx="42" cy="26" r="4"/>` +
            `<path d="M20 40q12 12 24 0" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/></svg>`,
    );

const colours = ["#7cb342", "#f6c343", "#ef5350", "#42a5f5", "#ab47bc", "#26a69a", "#ff7043", "#8d6e63", "#5c6bc0"];
const stickers: StickerPickerSticker[] = colours.map((colour, index) => ({
    packId: "pepe",
    shortcode: `pepe_${index}`,
    src: face(colour),
    label: `:pepe_${index}:`,
}));

const meta = {
    title: "Emoji/StickerPickerView",
    component: StickerPickerViewWrapper,
    tags: ["autodocs"],
    args: {
        tabs: [
            { id: "pepe", name: "Pepe", iconSrc: face("#7cb342") },
            { id: "hamster", name: "Hamster Jack", iconSrc: face("#f6c343") },
            { id: "cats", name: "Outline Cats" },
        ],
        selectedPackId: "pepe",
        query: "",
        stickers,
        setQuery: fn(),
        selectPack: fn(),
        sendSticker: fn(),
        openSettings: fn(),
    },
} satisfies Meta<typeof StickerPickerViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Searching: Story = {
    args: { selectedPackId: undefined, query: "pepe_1", stickers: stickers.slice(1, 2) },
};

export const NoResults: Story = {
    args: { selectedPackId: undefined, query: "zebra", stickers: [] },
};

export const Empty: Story = {
    args: { tabs: [], selectedPackId: undefined, stickers: [] },
};
