/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StickerPickerView, type StickerPickerViewSnapshot } from "./StickerPickerView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<StickerPickerViewSnapshot> {
    public setQuery = vi.fn();
    public selectPack = vi.fn();
    public sendSticker = vi.fn();
    public openSettings = vi.fn();
}

const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const snapshot: StickerPickerViewSnapshot = {
    tabs: [
        { id: "user", name: "Your stickers", iconSrc: gif },
        { id: "!room:x|pepe", name: "Pepe" },
    ],
    selectedPackId: "user",
    query: "",
    stickers: [
        { packId: "user", shortcode: "wave", src: gif, label: ":wave:" },
        { packId: "user", shortcode: "party", src: gif, label: "A party hat" },
    ],
};

describe("StickerPickerView", () => {
    it("shows the packs as tabs and the selected pack's stickers", () => {
        render(<StickerPickerView vm={new TestViewModel(snapshot)} />);
        const tabs = within(screen.getByRole("group", { name: "Sticker packs" })).getAllByRole("button");
        expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Your stickers", "Pepe"]);
        expect(tabs[0]).toHaveAttribute("aria-pressed", "true");
        expect(tabs[1]).toHaveAttribute("aria-pressed", "false");
        // A pack without an icon shows its initial.
        expect(tabs[1]).toHaveTextContent("P");
        const stickers = within(screen.getByRole("list", { name: "Stickers" })).getAllByRole("button");
        expect(stickers.map((sticker) => sticker.getAttribute("aria-label"))).toEqual([":wave:", "A party hat"]);
    });

    it("focuses the search and passes typed text to the view model", async () => {
        const vm = new TestViewModel(snapshot);
        render(<StickerPickerView vm={vm} />);
        const search = screen.getByRole("searchbox", { name: "Search stickers" });
        expect(search).toHaveFocus();
        await userEvent.type(search, "p");
        expect(vm.setQuery).toHaveBeenCalledWith("p");
    });

    it("selects a pack and sends a sticker by mouse or keyboard", async () => {
        const vm = new TestViewModel(snapshot);
        render(<StickerPickerView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Pepe" }));
        expect(vm.selectPack).toHaveBeenCalledWith("!room:x|pepe");
        await userEvent.click(screen.getByRole("button", { name: ":wave:" }));
        expect(vm.sendSticker).toHaveBeenCalledWith("user", "wave");
        screen.getByRole("button", { name: "A party hat" }).focus();
        await userEvent.keyboard("{Enter}");
        expect(vm.sendSticker).toHaveBeenLastCalledWith("user", "party");
    });

    it("says when a search finds nothing", () => {
        render(<StickerPickerView vm={new TestViewModel({ ...snapshot, query: "zzz", stickers: [] })} />);
        expect(screen.getByText("No stickers match “zzz”")).toBeInTheDocument();
    });

    it("offers to add stickers when there are no packs", async () => {
        const vm = new TestViewModel({ tabs: [], query: "", stickers: [] });
        render(<StickerPickerView vm={vm} />);
        expect(screen.getByText("No stickers yet")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Add stickers" }));
        expect(vm.openSettings).toHaveBeenCalled();
    });

    it("links to the sticker settings", async () => {
        const vm = new TestViewModel(snapshot);
        render(<StickerPickerView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Manage stickers" }));
        expect(vm.openSettings).toHaveBeenCalled();
    });
});
