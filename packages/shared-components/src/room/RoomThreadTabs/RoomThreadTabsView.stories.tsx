/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RoomThreadTabsView } from "./RoomThreadTabsView";
import { useMockedViewModel } from "../../core/viewmodel";

function ThreadTabsStory() {
    const vm = useMockedViewModel(
        {
            threads: [
                { id: "plans", title: "Project plans", archived: false },
                { id: "release", title: "Release checklist", archived: false },
            ],
            selectedId: "plans",
            canArchive: true,
            canRemind: true,
            busy: false,
            showArchived: false,
        },
        {
            select: fn(),
            browse: fn(),
            archive: fn(),
            toggleArchived: fn(),
            retry: fn(),
            openBoard: fn(),
            setReminder: fn(),
        },
    );
    return <RoomThreadTabsView vm={vm} />;
}

const meta = { title: "Room/RoomThreadTabs", component: ThreadTabsStory } satisfies Meta<typeof ThreadTabsStory>;
export default meta;

/** General and two room threads, with the active thread highlighted. */
export const Default: StoryObj<typeof meta> = {};
