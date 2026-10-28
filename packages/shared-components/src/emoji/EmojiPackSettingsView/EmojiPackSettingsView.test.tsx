/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmojiPackSettingsView, type EmojiPackSettingsViewSnapshot } from "./EmojiPackSettingsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";
import { BaseViewModel } from "../../core/viewmodel/BaseViewModel";

class TestViewModel extends MockViewModel<EmojiPackSettingsViewSnapshot> {
    public upload = vi.fn();
    public rename = vi.fn();
    public remove = vi.fn();
    public dismissError = vi.fn();
}

const snapshot: EmojiPackSettingsViewSnapshot = {
    emojis: [
        { shortcode: "blob", src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
        { shortcode: "party", src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
    ],
    canEdit: true,
    busy: false,
};

describe("EmojiPackSettingsView", () => {
    it("lists each emoji with its image, editable name and remove action", () => {
        render(<EmojiPackSettingsView vm={new TestViewModel(snapshot)} />);
        expect(screen.getByText("2 emoji")).toBeInTheDocument();
        const rows = within(screen.getByRole("list")).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByRole("img", { name: ":blob:" })).toHaveAttribute("src", snapshot.emojis[0].src);
        expect(within(rows[0]).getByRole("textbox", { name: "Name for :blob:" })).toHaveValue("blob");
        expect(within(rows[0]).getByRole("button", { name: "Remove :blob:" })).toBeEnabled();
        expect(screen.getByText(/PNG, GIF, WebP or JPEG, up to 512 KB/)).toBeInTheDocument();
    });

    it("uploads every chosen file and clears the picker", async () => {
        const vm = new TestViewModel(snapshot);
        const { container } = render(<EmojiPackSettingsView vm={vm} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(input).toHaveAttribute("accept", "image/png,image/gif,image/webp,image/jpeg");
        const files = [
            new File(["a"], "cat.png", { type: "image/png" }),
            new File(["b"], "dog.gif", { type: "image/gif" }),
        ];
        await userEvent.upload(input, files);
        expect(vm.upload).toHaveBeenCalledExactlyOnceWith(files);
        expect(input).toHaveValue("");
    });

    it("renames on Enter, once", async () => {
        const vm = new TestViewModel(snapshot);
        render(<EmojiPackSettingsView vm={vm} />);
        const name = screen.getByRole("textbox", { name: "Name for :blob:" });
        await userEvent.clear(name);
        await userEvent.type(name, "blobby{Enter}");
        expect(vm.rename).toHaveBeenCalledExactlyOnceWith("blob", "blobby");
    });

    it("renames on blur only when the name changed", async () => {
        const vm = new TestViewModel(snapshot);
        render(<EmojiPackSettingsView vm={vm} />);
        const name = screen.getByRole("textbox", { name: "Name for :party:" });
        await userEvent.click(name);
        await userEvent.tab();
        expect(vm.rename).not.toHaveBeenCalled();
        await userEvent.type(name, "_time");
        await userEvent.tab();
        expect(vm.rename).toHaveBeenCalledExactlyOnceWith("party", "party_time");
    });

    it("shows the stored name again when a rename is rejected", async () => {
        class RejectingViewModel extends BaseViewModel<EmojiPackSettingsViewSnapshot, undefined> {
            public constructor() {
                super(undefined, snapshot);
            }
            public upload = vi.fn();
            public remove = vi.fn();
            public dismissError = vi.fn();
            public rename = (): void => {
                this.snapshot.merge({ busy: true });
                void Promise.resolve().then(() => this.snapshot.merge({ busy: false, error: "Name taken" }));
            };
        }
        render(<EmojiPackSettingsView vm={new RejectingViewModel()} />);
        const name = screen.getByRole("textbox", { name: "Name for :blob:" });
        await userEvent.type(name, "!{Enter}");
        await screen.findByRole("alert");
        expect(name).toHaveValue("blob");
    });

    it("reverts the name on Escape without closing a surrounding dialog", async () => {
        const vm = new TestViewModel(snapshot);
        const onDialogKeyDown = vi.fn();
        render(
            <div onKeyDown={onDialogKeyDown}>
                <EmojiPackSettingsView vm={vm} />
            </div>,
        );
        const name = screen.getByRole("textbox", { name: "Name for :blob:" });
        await userEvent.type(name, "xyz");
        onDialogKeyDown.mockClear();
        await userEvent.keyboard("{Escape}");
        expect(name).toHaveValue("blob");
        expect(onDialogKeyDown).not.toHaveBeenCalled();
        await userEvent.tab();
        expect(vm.rename).not.toHaveBeenCalled();
    });

    it("removes an emoji", async () => {
        const vm = new TestViewModel(snapshot);
        render(<EmojiPackSettingsView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Remove :party:" }));
        expect(vm.remove).toHaveBeenCalledExactlyOnceWith("party");
    });

    it("hides every control without permission", () => {
        render(<EmojiPackSettingsView vm={new TestViewModel({ ...snapshot, canEdit: false })} />);
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.getByText("blob")).toBeInTheDocument();
        expect(screen.getByText("You don't have permission to change these emoji.")).toBeInTheDocument();
    });

    it("shows an error that can be dismissed", async () => {
        const vm = new TestViewModel({ ...snapshot, error: "cat.png is larger than 512 KB." });
        render(<EmojiPackSettingsView vm={vm} />);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("cat.png is larger than 512 KB.");
        await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
        expect(vm.dismissError).toHaveBeenCalledTimes(1);
    });

    it("shows the empty state", () => {
        render(<EmojiPackSettingsView vm={new TestViewModel({ ...snapshot, emojis: [] })} />);
        expect(screen.getByText("No custom emoji yet.")).toBeInTheDocument();
        expect(screen.queryByRole("list")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Upload emoji" })).toBeEnabled();
    });

    it("locks controls and shows progress while busy", () => {
        render(<EmojiPackSettingsView vm={new TestViewModel({ ...snapshot, busy: true })} />);
        expect(screen.getByRole("button", { name: "Upload emoji" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Remove :blob:" })).toBeDisabled();
        expect(screen.getByRole("textbox", { name: "Name for :blob:" })).toHaveAttribute("readonly");
        expect(screen.getByRole("progressbar", { name: "Saving emoji…" })).toBeInTheDocument();
    });
});
