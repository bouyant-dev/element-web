/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RoomThreadTabsView, type RoomThreadTabsSnapshot } from "./RoomThreadTabsView";
import { useMockedViewModel } from "../../core/viewmodel";

const initial: RoomThreadTabsSnapshot = {
    threads: [
        { id: "plans", title: "Project plans", archived: false, canManage: true },
        { id: "release", title: "Release checklist", archived: false, canManage: true },
        { id: "feedback", title: "Team feedback", archived: false, canManage: false },
        { id: "onboarding", title: "New teammate onboarding", archived: false, canManage: true },
        { id: "old", title: "September planning", archived: true, canManage: true },
    ],
    selectedId: "plans",
    canCreate: true,
    canLinkToBoard: true,
    canRemind: true,
    busy: false,
    showHistory: false,
    hasMore: true,
};

function ThreadTabsStory({ overrides }: { overrides?: Partial<RoomThreadTabsSnapshot> }) {
    const [state, setState] = useState({ ...initial, ...overrides });
    const vm = useMockedViewModel(state, {
        select: (id?: string) => setState((value) => ({ ...value, selectedId: id, board: undefined })),
        create: fn(async () => {}),
        rename: fn(async () => {}),
        linkToBoard: fn(async () => {}),
        archive: fn(async (id: string, archived: boolean) =>
            setState((value) => ({
                ...value,
                selectedId: archived && value.selectedId === id ? undefined : value.selectedId,
                threads: value.threads.map((thread) => (thread.id === id ? { ...thread, archived } : thread)),
            })),
        ),
        toggleHistory: () => setState((value) => ({ ...value, showHistory: !value.showHistory })),
        retry: fn(async () => {}),
        loadMore: fn(async () => {}),
        openBoard: (board: "room" | "all") => setState((value) => ({ ...value, board })),
        setReminder: fn(async () => {}),
    });
    return <RoomThreadTabsView vm={vm} />;
}

const meta = {
    title: "Room/RoomThreadTabs",
    component: RoomThreadTabsView,
    parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RoomThreadTabsView>;
export default meta;

/** Explicit create/history actions with four focused thread tabs. */
export const Default: StoryObj = { render: () => <ThreadTabsStory /> };
/** Complete history includes active and archived conversations. */
export const History: StoryObj = { render: () => <ThreadTabsStory overrides={{ showHistory: true }} /> };
/** An empty history explains how to begin. */
export const EmptyHistory: StoryObj = {
    render: () => (
        <ThreadTabsStory overrides={{ threads: [], selectedId: undefined, showHistory: true, hasMore: false }} />
    ),
};
/** A selected later thread remains among the four displayed tabs. */
export const ManyThreads: StoryObj = {
    render: () => (
        <ThreadTabsStory
            overrides={{
                threads: Array.from({ length: 7 }, (_, index) => ({
                    id: String(index),
                    title: `Conversation ${index + 1}`,
                    archived: false,
                    canManage: true,
                })),
                selectedId: "6",
            }}
        />
    ),
};
