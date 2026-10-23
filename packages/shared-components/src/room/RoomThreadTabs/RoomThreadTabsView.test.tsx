/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomThreadTabsView, type RoomThreadTabsSnapshot } from "./RoomThreadTabsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<RoomThreadTabsSnapshot> {
    public openBoard = vi.fn();
    public setReminder = vi.fn().mockResolvedValue(undefined);
    public select = vi.fn();
    public browse = vi.fn();
    public archive = vi.fn().mockResolvedValue(undefined);
    public toggleArchived = vi.fn();
    public retry = vi.fn().mockResolvedValue(undefined);
}

const snapshot: RoomThreadTabsSnapshot = {
    threads: [
        { id: "active", title: "Project plans", archived: false },
        { id: "old", title: "Old plans", archived: true },
    ],
    selectedId: "active",
    canArchive: true,
    busy: false,
    showArchived: false,
};

describe("RoomThreadTabsView", () => {
    it("offers reminders only when a bot is configured", async () => {
        const vm = new TestViewModel({ ...snapshot, canRemind: true });
        render(<RoomThreadTabsView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Set reminder" }));
        expect(vm.setReminder).toHaveBeenCalledOnce();
    });
    it("opens this room's board and the aggregate board", async () => {
        const vm = new TestViewModel({ ...snapshot, selectedId: undefined, board: "room" });
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(vm.openBoard).toHaveBeenCalledWith("room");
        await userEvent.click(screen.getByRole("button", { name: "All boards" }));
        expect(vm.openBoard).toHaveBeenCalledWith("all");
    });
    it("selects General and threads while hiding archived threads", async () => {
        const vm = new TestViewModel(snapshot);
        render(<RoomThreadTabsView vm={vm} />);
        expect(screen.getByRole("navigation", { name: "Room conversations" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Project plans" })).toHaveAttribute("aria-current", "page");
        expect(screen.queryByRole("button", { name: "Old plans" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Set reminder" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "General" }));
        expect(vm.select).toHaveBeenCalledWith();
        await userEvent.click(screen.getByRole("button", { name: "Project plans" }));
        expect(vm.select).toHaveBeenCalledWith("active");
        await userEvent.click(screen.getByRole("button", { name: "Archive thread" }));
        expect(vm.archive).toHaveBeenCalledWith("active", true);
    });

    it("offers restore for archived conversations only to permitted users", async () => {
        const vm = new TestViewModel({ ...snapshot, selectedId: undefined, showArchived: true });
        render(<RoomThreadTabsView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Restore thread" }));
        expect(vm.archive).toHaveBeenCalledWith("old", false);
    });

    it("hides moderation controls when permission is absent", () => {
        render(<RoomThreadTabsView vm={new TestViewModel({ ...snapshot, showArchived: true, canArchive: false })} />);
        expect(screen.queryByRole("button", { name: "Archive thread" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Restore thread" })).not.toBeInTheDocument();
    });
});
