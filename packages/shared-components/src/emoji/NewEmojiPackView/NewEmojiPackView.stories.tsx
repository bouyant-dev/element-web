/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { NewEmojiPackView, type NewEmojiPackViewActions, type NewEmojiPackViewSnapshot } from "./NewEmojiPackView";
import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";

type NewEmojiPackProps = NewEmojiPackViewSnapshot & NewEmojiPackViewActions;

const NewEmojiPackViewWrapperImpl = ({ createPack, dismissError, ...rest }: NewEmojiPackProps): JSX.Element => {
    const vm = useMockedViewModel(rest, { createPack, dismissError });
    return <NewEmojiPackView vm={vm} />;
};
const NewEmojiPackViewWrapper = withViewDocs(NewEmojiPackViewWrapperImpl, NewEmojiPackView);

const meta = {
    title: "Emoji/NewEmojiPackView",
    component: NewEmojiPackViewWrapper,
    tags: ["autodocs"],
    args: {
        canCreate: true,
        busy: false,
        createPack: fn(),
        dismissError: fn(),
    },
} satisfies Meta<typeof NewEmojiPackViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Busy: Story = {
    args: { busy: true },
};

export const WithError: Story = {
    args: { error: "The pack could not be created. Check your connection and permissions, then try again." },
};
