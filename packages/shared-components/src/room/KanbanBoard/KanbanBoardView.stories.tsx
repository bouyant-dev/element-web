/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { KanbanBoardView, type KanbanBoardSnapshot, type KanbanCard } from "./KanbanBoardView";
import { useMockedViewModel } from "../../core/viewmodel";

const meta = {
    title: "Room/KanbanBoard",
    component: KanbanBoardView,
    parameters: { layout: "fullscreen" },
} satisfies Meta<typeof KanbanBoardView>;
export default meta;

const people = [
    { userId: "@bob:server", name: "Bob" },
    { userId: "@carol:server", name: "Carol" },
];

const cards: KanbanCard[] = [
    {
        id: "one",
        threadId: "$launch",
        roomId: "project",
        roomName: "Product",
        title: "Review the beta launch checklist",
        dueAt: new Date("2027-03-10T10:30").getTime(),
        description: "One final pass through threads, boards, and reminders before we invite the team.",
        column: "todo",
        archived: false,
        canEdit: true,
        participants: [people[0]],
        showToRoom: true,
    },
    {
        id: "two",
        roomId: "design",
        roomName: "Design studio",
        title: "Make room for a calmer sidebar",
        description: "Bring favourites back within easy reach.",
        column: "todo",
        archived: false,
        canEdit: true,
        participants: [people[1]],
        showToRoom: false,
    },
    {
        id: "three",
        roomId: "design",
        roomName: "Design studio",
        title: "Polish the thread navigation",
        description: "General, focused conversations, and the board. Everything where you expect it.",
        column: "doing",
        archived: false,
        canEdit: true,
        participants: people,
        showToRoom: false,
    },
    {
        id: "four",
        roomId: "operations",
        roomName: "Operations",
        title: "Try the reminder bot with the team",
        description: "Schedule a room reminder and check that it arrives with the browser closed.",
        column: "doing",
        archived: false,
        canEdit: true,
        participants: [people[0]],
        showToRoom: true,
    },
    {
        id: "five",
        roomId: "project",
        roomName: "Product",
        title: "Give every chat its own board",
        description: "Shared tasks stay close to the conversation.",
        column: "done",
        archived: false,
        canEdit: true,
    },
    {
        id: "six",
        roomId: "operations",
        roomName: "Operations",
        title: "Connect the beta workspace",
        description: "",
        column: "done",
        archived: false,
        canEdit: true,
    },
];

const initial: KanbanBoardSnapshot = {
    cards,
    people,
    universal: true,
    initialized: true,
    canCreateBoard: false,
    canAdd: false,
    loading: false,
    busy: false,
    hasMore: true,
    showArchived: false,
    unreadable: false,
    canRemind: true,
    threads: [
        { id: "$launch", title: "Beta launch" },
        { id: "$design", title: "Design review" },
    ],
    threadsLoading: false,
};

function BoardStory({ overrides }: { overrides?: Partial<KanbanBoardSnapshot> }): React.JSX.Element {
    const [state, setState] = useState({ ...initial, ...overrides });
    const filteredState = {
        ...state,
        cards: state.cards.filter(
            (card) => !state.personFilter || card.participants?.some((person) => person.userId === state.personFilter),
        ),
    };
    const vm = useMockedViewModel(filteredState, {
        reload: fn(async () => {}),
        loadMore: fn(async () => setState((value) => ({ ...value, hasMore: false }))),
        createBoard: fn(async () => setState((value) => ({ ...value, initialized: true, canAdd: true }))),
        edit: fn((card?: KanbanCard) =>
            setState((value) => ({
                ...value,
                editor: {
                    id: card?.id,
                    roomId: card?.roomId ?? "project",
                    title: card?.title ?? "",
                    description: card?.description ?? "",
                    threadId: card?.threadId,
                    showToRoom: card ? (card.showToRoom ?? true) : false,
                },
            })),
        ),
        setTitle: (title: string) => setState((value) => ({ ...value, editor: { ...value.editor!, title } })),
        setDescription: (description: string) =>
            setState((value) => ({ ...value, editor: { ...value.editor!, description } })),
        setThread: (threadId: string) =>
            setState((value) => ({ ...value, editor: { ...value.editor!, threadId: threadId || undefined } })),
        openThread: fn(async () => {}),
        setDueAt: (dueAt: string) => setState((value) => ({ ...value, editor: { ...value.editor!, dueAt } })),
        setShowToRoom: (showToRoom: boolean) =>
            setState((value) => ({ ...value, editor: { ...value.editor!, showToRoom } })),
        setPersonFilter: (personFilter: string) => setState((value) => ({ ...value, personFilter })),
        remind: fn(async () => {}),
        cancelEdit: () => setState((value) => ({ ...value, editor: undefined })),
        save: fn(async () =>
            setState((value) => {
                const editor = value.editor!;
                const card = value.cards.find((item) => item.id === editor.id);
                return {
                    ...value,
                    editor: undefined,
                    cards: card
                        ? value.cards.map((item) =>
                              item === card
                                  ? {
                                        ...item,
                                        title: editor.title,
                                        description: editor.description,
                                        threadId: editor.threadId,
                                        showToRoom: editor.showToRoom,
                                    }
                                  : item,
                          )
                        : [
                              ...value.cards,
                              {
                                  id: String(value.cards.length + 1),
                                  roomId: editor.roomId,
                                  roomName: "Product",
                                  title: editor.title,
                                  description: editor.description,
                                  threadId: editor.threadId,
                                  showToRoom: editor.showToRoom,
                                  column: "todo",
                                  archived: false,
                                  canEdit: true,
                              },
                          ],
                };
            }),
        ),
        move: fn(async (card: KanbanCard, column: KanbanCard["column"]) =>
            setState((value) => ({
                ...value,
                cards: value.cards.map((item) => (item.id === card.id ? { ...item, column } : item)),
            })),
        ),
        archive: fn(async (card: KanbanCard, archived: boolean) =>
            setState((value) => ({
                ...value,
                cards: value.cards.map((item) => (item.id === card.id ? { ...item, archived } : item)),
            })),
        ),
        toggleArchived: () => setState((value) => ({ ...value, showArchived: !value.showArchived })),
        openRoom: fn(),
    });
    return <KanbanBoardView vm={vm} />;
}

/** A working recap; changes stay in this local preview. */
export const Recap: StoryObj = {
    render: () => <BoardStory />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const filter = canvas.getByRole("combobox", { name: "Filter by person" });
        await userEvent.selectOptions(filter, "@bob:server");
        await expect(canvas.getByRole("article", { name: "Review the beta launch checklist" })).toBeVisible();
        await expect(canvas.queryByRole("article", { name: "Make room for a calmer sidebar" })).not.toBeInTheDocument();
        await expect(canvas.getByText("With Bob, Carol")).toBeVisible();
        await userEvent.selectOptions(filter, "");
        await expect(canvas.getByRole("article", { name: "Make room for a calmer sidebar" })).toBeVisible();
    },
};
/** A room board with its add-card action. */
export const RoomBoard: StoryObj = {
    render: () => <BoardStory overrides={{ universal: false, canAdd: true, canCreateBoard: true, hasMore: false }} />,
};
/** Room board ready for its first card. */
export const Empty: StoryObj = {
    render: () => <BoardStory overrides={{ universal: false, canAdd: true, cards: [], hasMore: false }} />,
};
/** Initial board setup, before room state exists. */
export const Setup: StoryObj = {
    render: () => (
        <BoardStory
            overrides={{ universal: false, initialized: false, canCreateBoard: true, cards: [], hasMore: false }}
        />
    ),
};
/** Restricted room without editing permission. */
export const ReadOnly: StoryObj = {
    render: () => (
        <BoardStory
            overrides={{ universal: false, cards: cards.map((card) => ({ ...card, canEdit: false })), hasMore: false }}
        />
    ),
};
/** An inline editor with recoverable error feedback. */
export const Editor: StoryObj = {
    render: () => (
        <BoardStory
            overrides={{
                universal: false,
                canAdd: true,
                editor: {
                    roomId: "project",
                    title: "Review launch notes",
                    description: "Keep the invitation clear and short.",
                },
                error: "The card could not be saved. Try again.",
                hasMore: false,
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const visibility = canvas.getByRole("switch", { name: "Show to everyone in channel" });
        await expect(visibility).not.toBeChecked();
        await userEvent.click(visibility);
        await expect(visibility).toBeChecked();
        await userEvent.click(canvas.getByRole("button", { name: "Save card" }));
        const card = canvas.getByRole("article", { name: "Review launch notes" });
        await expect(within(card).getByText("Show to everyone in channel")).toBeVisible();
    },
};
/** Loading does not claim the board is empty. */
export const Loading: StoryObj = {
    render: () => <BoardStory overrides={{ loading: true, cards: [], hasMore: false }} />,
};
/** An archive retains each card's source and restore action. */
export const Archived: StoryObj = {
    render: () => (
        <BoardStory
            overrides={{
                showArchived: true,
                cards: cards.slice(0, 2).map((card) => ({ ...card, archived: true })),
                hasMore: false,
            }}
        />
    ),
};
/** An encrypted board can be incomplete until keys are restored. */
export const MissingKeys: StoryObj = { render: () => <BoardStory overrides={{ unreadable: true }} /> };
