/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NewEmojiPackView, type NewEmojiPackViewSnapshot } from "./NewEmojiPackView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";
import { BaseViewModel } from "../../core/viewmodel/BaseViewModel";

class TestViewModel extends MockViewModel<NewEmojiPackViewSnapshot> {
    public createPack = vi.fn();
    public dismissError = vi.fn();
}

describe("NewEmojiPackView", () => {
    it("creates a pack with the typed name and clears the field", async () => {
        const vm = new TestViewModel({ canCreate: true, busy: false });
        render(<NewEmojiPackView vm={vm} />);
        const create = screen.getByRole("button", { name: "Create pack" });
        expect(create).toBeDisabled();
        const name = screen.getByRole("textbox", { name: "New pack name" });
        await userEvent.type(name, "Hamster Jack{Enter}");
        expect(vm.createPack).toHaveBeenCalledExactlyOnceWith("Hamster Jack");
        expect(name).toHaveValue("");
    });

    it("keeps the typed name when creating fails, and clears it once a pack is created", async () => {
        class LiveViewModel extends BaseViewModel<NewEmojiPackViewSnapshot, undefined> {
            public fail = true;
            public constructor() {
                super(undefined, { canCreate: true, busy: false });
            }
            public dismissError = vi.fn();
            public createPack = (): void => {
                this.snapshot.merge({ busy: true, error: undefined });
                const error = this.fail ? "The pack could not be created." : undefined;
                void Promise.resolve().then(() => this.snapshot.merge({ busy: false, error }));
            };
        }
        const vm = new LiveViewModel();
        render(<NewEmojiPackView vm={vm} />);
        const name = screen.getByRole("textbox", { name: "New pack name" });
        await userEvent.type(name, "Cats{Enter}");
        await screen.findByRole("alert");
        expect(name).toHaveValue("Cats");

        vm.fail = false;
        await userEvent.click(screen.getByRole("button", { name: "Create pack" }));
        await vi.waitFor(() => expect(name).toHaveValue(""));
    });

    it("ignores a blank name and waits while busy", async () => {
        const vm = new TestViewModel({ canCreate: true, busy: true });
        render(<NewEmojiPackView vm={vm} />);
        await userEvent.type(screen.getByRole("textbox", { name: "New pack name" }), "Cats{Enter}");
        expect(screen.getByRole("button", { name: "Create pack" })).toBeDisabled();
        expect(vm.createPack).not.toHaveBeenCalled();
    });

    it("is hidden without permission", () => {
        const { container } = render(<NewEmojiPackView vm={new TestViewModel({ canCreate: false, busy: false })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows an error that can be dismissed", async () => {
        const vm = new TestViewModel({ canCreate: true, busy: false, error: "The pack could not be created." });
        render(<NewEmojiPackView vm={vm} />);
        await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Dismiss" }));
        expect(vm.dismissError).toHaveBeenCalledTimes(1);
    });
});
