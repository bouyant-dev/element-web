/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Meta, type StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { EmojiPicker, type PickerCustomEmoji } from "./EmojiPicker";

const meta = {
    title: "Core/EmojiPicker",
    component: EmojiPicker,
    tags: ["autodocs"],
    globals: {
        // Render emoji using Twemoji, as Element Web does, rather than the platform's emoji font
        rootCss: "app-web",
    },
    args: {
        onChoose: fn(() => true),
        onFinished: fn(),
        onRecordRecent: fn(),
    },
} satisfies Meta<typeof EmojiPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRecents: Story = {
    args: {
        recentEmojis: ["👍", "🎉", "❤️", "🚀"],
    },
};

export const WithSelected: Story = {
    args: {
        selectedEmojis: new Set(["😀", "🙂"]),
    },
};

export const DisabledEmoji: Story = {
    // Disable screenshot because it doesn't actually look any different
    tags: ["!snapshot"],
    args: {
        isEmojiDisabled: (unicode: string) => unicode === "😀",
    },
};

export const HideQuickReactions: Story = {
    args: {
        showQuickReactions: false,
    },
};

// A custom emoji with an inline image, so the story needs no network
const customEmoji = (shortcode: string, fill: string): PickerCustomEmoji => ({
    key: `mxc://example.org/${shortcode}`,
    shortcode,
    src: `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" fill="${fill}"/></svg>`,
    )}`,
});

export const WithCustomEmoji: Story = {
    // No visual baseline has been generated for this story yet
    tags: ["!snapshot"],
    args: {
        recentEmojis: ["👍", "🎉"],
        customEmojiCategories: [
            {
                id: "user",
                name: "Your emoji",
                emojis: [customEmoji("wave", "#0dbd8b"), customEmoji("heart", "#e0245e")],
            },
            {
                id: "!space:example.org|",
                name: "Cat Server",
                emojis: [
                    "#ff9f1c",
                    "#ffbf69",
                    "#2ec4b6",
                    "#cbf3f0",
                    "#5e60ce",
                    "#7400b8",
                    "#e63946",
                    "#457b9d",
                    "#1d3557",
                ].map((fill, i) => customEmoji(`cat_${i + 1}`, fill)),
            },
        ],
    },
};
