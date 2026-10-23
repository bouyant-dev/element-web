/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KanbanBoardView, type KanbanBoardSnapshot } from "./KanbanBoardView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<KanbanBoardSnapshot> {
    public reload = vi.fn();
    public loadMore = vi.fn();
    public createBoard = vi.fn();
    public edit = vi.fn();
    public setTitle = vi.fn();
    public setDescription = vi.fn();
    public setThread = vi.fn();
    public setDueAt = vi.fn();
    public remind = vi.fn().mockResolvedValue(undefined);
    public openThread = vi.fn();
    public cancelEdit = vi.fn();
    public save = vi.fn();
    public move = vi.fn();
    public archive = vi.fn();
    public toggleArchived = vi.fn();
    public openRoom = vi.fn();
}

const snapshot: KanbanBoardSnapshot = {
    cards: [
        {
            id: "one",
            roomId: "!room:server",
            roomName: "Project",
            title: "Ship release",
            description: "<script>alert(1)</script>",
            column: "todo",
            archived: false,
            canEdit: true,
        },
    ],
    universal: false,
    initialized: true,
    canCreateBoard: true,
    canAdd: true,
    loading: false,
    busy: false,
    hasMore: false,
    showArchived: false,
    unreadable: false,
    threads: [],
    threadsLoading: false,
};

describe("KanbanBoardView", () => {
    it("renders safe card text and accessible actions for each workflow column", async () => {
        const vm = new TestViewModel(snapshot);
        render(<KanbanBoardView vm={vm} />);
        const card = screen.getByRole("article", { name: "Ship release" });
        expect(within(card).getByText("<script>alert(1)</script>")).toBeInTheDocument();
        expect(card.querySelector("script")).toBeNull();
        await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Status for Ship release" }), "doing");
        expect(vm.move).toHaveBeenCalledWith(snapshot.cards[0], "doing");
        await userEvent.click(within(card).getByRole("button", { name: "Actions for Ship release" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Archive card" }));
        expect(vm.archive).toHaveBeenCalledWith(snapshot.cards[0], true);
    });

    it("links each recap card to its source room and discloses incomplete history", async () => {
        const vm = new TestViewModel({ ...snapshot, universal: true, canAdd: false, hasMore: true });
        render(<KanbanBoardView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Open Project" }));
        expect(vm.openRoom).toHaveBeenCalledWith("!room:server");
        expect(screen.getByText(/Older cards may be missing/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Load older cards" }));
        expect(vm.loadMore).toHaveBeenCalled();
    });

    it("offers restore in the archive view and hides controls for read-only cards", async () => {
        const vm = new TestViewModel({
            ...snapshot,
            showArchived: true,
            cards: [{ ...snapshot.cards[0], archived: true }],
        });
        const { rerender } = render(<KanbanBoardView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Actions for Ship release" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Restore card" }));
        expect(vm.archive).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), false);
        rerender(
            <KanbanBoardView
                vm={
                    new TestViewModel({ ...snapshot, canAdd: false, cards: [{ ...snapshot.cards[0], canEdit: false }] })
                }
            />,
        );
        expect(screen.queryByRole("button", { name: "Edit card" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add card" })).not.toBeInTheDocument();
    });

    it("uses labelled bounded editor fields and preserves error feedback", async () => {
        const vm = new TestViewModel({
            ...snapshot,
            editor: { roomId: "!room:server", title: "Title", description: "" },
            error: "Save failed",
        });
        render(<KanbanBoardView vm={vm} />);
        expect(screen.getByLabelText("Card title")).toHaveAttribute("maxlength", "100");
        expect(screen.getByLabelText("Description (optional)")).toHaveAttribute("maxlength", "4000");
        expect(screen.getByRole("alert").textContent).toContain("Save failed");
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(vm.reload).toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Save card" }));
        expect(vm.save).toHaveBeenCalled();
    });

    it("edits deadlines without unlinking the one-to-one thread and opens its conversation", async () => {
        const card = { ...snapshot.cards[0], threadId: "$launch" };
        const vm = new TestViewModel({
            ...snapshot,
            cards: [card],
            editor: {
                roomId: "!room:server",
                title: "Title",
                description: "",
                threadId: "$launch",
                dueAt: "2027-03-10T10:30",
            },
        });
        render(<KanbanBoardView vm={vm} />);
        expect(screen.queryByRole("combobox", { name: "Linked thread (optional)" })).not.toBeInTheDocument();
        const deadline = screen.getByLabelText(/Deadline/);
        expect(deadline).toHaveValue("2027-03-10T10:30");
        await userEvent.clear(deadline);
        expect(vm.setDueAt).toHaveBeenCalledWith("");
        await userEvent.click(screen.getByRole("button", { name: "Open thread" }));
        expect(vm.openThread).toHaveBeenCalledWith(card);
    });
    it("keeps earlier duplicate content accessible and labels reminder requests honestly", async () => {
        const card = {
            ...snapshot.cards[0],
            dueAt: new Date("2027-03-10T10:30").getTime(),
            reminderRequested: { eventId: "$request", at: 1000 },
            earlierCards: [
                {
                    id: "old",
                    title: "Earlier idea",
                    description: "Preserved notes",
                    column: "done" as const,
                    archived: true,
                },
            ],
        };
        const vm = new TestViewModel({ ...snapshot, cards: [card], canRemind: true });
        render(<KanbanBoardView vm={vm} />);
        await userEvent.click(screen.getByText("Earlier linked cards (1)"));
        expect(screen.getByText("Preserved notes")).toBeVisible();
        expect(screen.getByText(/Reminder requested for .*Wait for bot confirmation/)).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: "Actions for Ship release" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Remind" }));
        expect(vm.remind).toHaveBeenCalledWith(card);
    });
    it("opens card editing from the compact menu and keeps busy controls disabled", async () => {
        const vm = new TestViewModel(snapshot);
        const { rerender } = render(<KanbanBoardView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Actions for Ship release" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Edit card" }));
        expect(vm.edit).toHaveBeenCalledWith(snapshot.cards[0]);
        await userEvent.click(screen.getByRole("button", { name: "Actions for Ship release" }));
        rerender(<KanbanBoardView vm={new TestViewModel({ ...snapshot, busy: true })} />);
        expect(screen.getByRole("menuitem", { name: "Edit card" })).toBeDisabled();
        expect(screen.getByRole("menuitem", { name: "Archive card" })).toBeDisabled();
        await userEvent.keyboard("{Escape}");
        expect(screen.getByRole("combobox", { name: "Status for Ship release" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Actions for Ship release" })).toBeDisabled();
    });

    it("offers setup before rendering workflow columns and keeps loading distinct from empty", async () => {
        const vm = new TestViewModel({ ...snapshot, cards: [], initialized: false, canAdd: false });
        const { rerender } = render(<KanbanBoardView vm={vm} />);
        expect(screen.queryByRole("region", { name: "To do" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Create board" }));
        expect(vm.createBoard).toHaveBeenCalled();
        rerender(<KanbanBoardView vm={new TestViewModel({ ...snapshot, cards: [], loading: true })} />);
        expect(screen.getByRole("status").textContent).toContain("Loading boards");
        expect(screen.queryByText("No cards here yet")).not.toBeInTheDocument();
    });

    it("keeps full descriptions available when cards are read only and announces missing keys", () => {
        render(
            <KanbanBoardView
                vm={
                    new TestViewModel({
                        ...snapshot,
                        canAdd: false,
                        unreadable: true,
                        cards: [
                            {
                                ...snapshot.cards[0],
                                canEdit: false,
                                description: "The full explanation remains available to everyone in the room.",
                            },
                        ],
                    })
                }
            />,
        );
        expect(screen.getByText("The full explanation remains available to everyone in the room.")).toBeVisible();
        expect(screen.getByRole("status").textContent).toContain("Some card updates could not be decrypted");
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Actions for Ship release" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Refresh board" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
});
