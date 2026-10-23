/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomThreadTabsView, type RoomThreadTabsSnapshot } from "./RoomThreadTabsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<RoomThreadTabsSnapshot> {
    public openBoard = vi.fn();
    public setReminder = vi.fn().mockResolvedValue(undefined);
    public select = vi.fn();
    public create = vi.fn().mockResolvedValue(undefined);
    public rename = vi.fn().mockResolvedValue(undefined);
    public linkToBoard = vi.fn().mockResolvedValue(undefined);
    public archive = vi.fn().mockResolvedValue(undefined);
    public toggleHistory = vi.fn();
    public loadMore = vi.fn().mockResolvedValue(undefined);
    public retry = vi.fn().mockResolvedValue(undefined);
}

const snapshot: RoomThreadTabsSnapshot = {
    threads: [
        { id: "active", title: "Project plans", archived: false, canManage: true },
        { id: "old", title: "Old plans", archived: true, canManage: true },
    ],
    selectedId: "active",
    canCreate: true,
    canLinkToBoard: true,
    busy: false,
    showHistory: false,
    hasMore: false,
};

describe("RoomThreadTabsView", () => {
    it("makes thread creation and complete history visible text actions", async () => {
        const vm = new TestViewModel(snapshot);
        render(<RoomThreadTabsView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "New thread" }));
        expect(vm.create).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole("button", { name: "Thread history" }));
        expect(vm.toggleHistory).toHaveBeenCalledOnce();
    });

    it("keeps board and reminder destinations in a labelled More menu", async () => {
        const vm = new TestViewModel({ ...snapshot, selectedId: undefined, board: "room", canRemind: true });
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(vm.openBoard).toHaveBeenCalledWith("room");
        await userEvent.click(screen.getByRole("button", { name: "More" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "All boards" }));
        expect(vm.openBoard).toHaveBeenCalledWith("all");
        await userEvent.click(screen.getByRole("button", { name: "More" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Set reminder" }));
        expect(vm.setReminder).toHaveBeenCalledOnce();
    });

    it("selects General and threads and exposes rename, board link, and archive for the selected thread", async () => {
        const vm = new TestViewModel(snapshot);
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByRole("navigation", { name: "Room conversations" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Project plans" })).toHaveAttribute("aria-current", "page");
        expect(screen.queryByRole("button", { name: "Old plans" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "General" }));
        expect(vm.select).toHaveBeenCalledWith();
        await userEvent.click(screen.getByRole("button", { name: "Project plans" }));
        expect(vm.select).toHaveBeenCalledWith("active");
        for (const label of ["Rename thread", "Link to board", "Archive thread"]) {
            await userEvent.click(screen.getByRole("button", { name: "Thread actions" }));
            await userEvent.click(screen.getByRole("menuitem", { name: label }));
        }
        expect(vm.rename).toHaveBeenCalledWith("active");
        expect(vm.linkToBoard).toHaveBeenCalledWith("active");
        expect(vm.archive).toHaveBeenCalledWith("active", true);
    });

    it("shows all active and archived conversations in history with per-thread management", async () => {
        const vm = new TestViewModel({
            ...snapshot,
            showHistory: true,
            hasMore: true,
            threads: [
                ...snapshot.threads,
                { id: "other", title: "Someone else's thread", archived: false, canManage: false },
            ],
        });
        render(<RoomThreadTabsView vm={vm} />);
        const history = within(screen.getByRole("region", { name: "Thread history" }));
        expect(history.getByRole("button", { name: "Project plans" })).toBeVisible();
        expect(history.getByRole("button", { name: "Old plans" })).toBeVisible();
        expect(history.getAllByText("Active")).toHaveLength(2);
        expect(history.getByText("Archived")).toBeVisible();
        expect(history.getAllByRole("button", { name: "Rename thread" })).toHaveLength(2);
        await userEvent.click(history.getByRole("button", { name: "Restore thread" }));
        expect(vm.archive).toHaveBeenCalledWith("old", false);
        await userEvent.click(history.getByRole("button", { name: "Archive thread" }));
        expect(vm.archive).toHaveBeenCalledWith("active", true);
        await userEvent.click(history.getByRole("button", { name: "Load older threads" }));
        expect(vm.loadMore).toHaveBeenCalledOnce();
    });

    it("limits thread tabs to four while keeping a selected later thread available", () => {
        const threads = Array.from({ length: 7 }, (_, index) => ({
            id: String(index),
            title: `Thread ${index}`,
            archived: false,
            canManage: true,
        }));
        render(<RoomThreadTabsView vm={new TestViewModel({ ...snapshot, threads, selectedId: "6" })} />);
        const tabs = within(screen.getByRole("navigation", { name: "Open threads" }));
        for (const index of [0, 1, 2, 6]) expect(tabs.getByRole("button", { name: `Thread ${index}` })).toBeVisible();
        for (const index of [3, 4, 5])
            expect(tabs.queryByRole("button", { name: `Thread ${index}` })).not.toBeInTheDocument();
        expect(tabs.getByRole("button", { name: "Thread 6" })).toHaveAttribute("aria-current", "page");
    });

    it("keeps an opened archived thread accessible without displaying all archived tabs", () => {
        render(<RoomThreadTabsView vm={new TestViewModel({ ...snapshot, selectedId: "old" })} />);
        expect(screen.getByRole("button", { name: "Old plans" })).toHaveAttribute("aria-current", "page");
    });

    it("explains empty history and prevents actions without permission", async () => {
        const vm = new TestViewModel({
            ...snapshot,
            threads: [],
            selectedId: undefined,
            showHistory: true,
            canCreate: false,
            canLinkToBoard: false,
        });
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByText("No threads yet")).toBeVisible();
        expect(screen.getByText("You need permission to send messages to create a thread.")).toBeVisible();
        expect(screen.getByRole("button", { name: "New thread" })).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Thread actions" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "More" }));
        expect(screen.queryByRole("menuitem", { name: "Set reminder" })).not.toBeInTheDocument();
    });

    it("preserves error retry and busy management controls", async () => {
        const vm = new TestViewModel({ ...snapshot, showHistory: true, busy: true, error: "Could not archive thread" });
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByRole("alert").textContent).toBe("Could not archive thread");
        expect(screen.getByRole("button", { name: "New thread" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Archive thread" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Restore thread" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    });
});
