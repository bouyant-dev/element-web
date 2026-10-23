/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SpaceDocsSetupView, type SpaceDocsSetupSnapshot } from "./SpaceDocsSetupView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<SpaceDocsSetupSnapshot> {
    public enable = vi.fn();
    public retry = vi.fn();
}
const initial: SpaceDocsSetupSnapshot = { spaceName: "Engineering", configured: false, canSetup: true, busy: false };

describe("SpaceDocsSetupView", () => {
    it("explains the permanent Space change before exposing the administrator action", async () => {
        const vm = new TestViewModel(initial);
        render(<SpaceDocsSetupView vm={vm} />);
        expect(screen.getByRole("heading", { name: "Encrypted Docs for Engineering" })).toBeVisible();
        expect(screen.getByText("Enabling encryption is permanent.")).toBeVisible();
        expect(screen.getByText("Chat permissions and chat encryption stay the same.")).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: "Enable encrypted Docs" }));
        expect(vm.enable).toHaveBeenCalledOnce();
    });

    it("offers only a read-only status refresh to ordinary members before setup", async () => {
        const vm = new TestViewModel({ ...initial, canSetup: false });
        render(<SpaceDocsSetupView vm={vm} />);
        expect(screen.queryByRole("button", { name: "Enable encrypted Docs" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Check setup" }));
        expect(vm.retry).toHaveBeenCalledOnce();
    });

    it("announces setup errors and prevents duplicate actions while waiting for state sync", () => {
        render(<SpaceDocsSetupView vm={new TestViewModel({ ...initial, busy: true, error: "Setup is incomplete" })} />);
        expect(screen.getByRole("alert").textContent).toContain("Setup is incomplete");
        expect(screen.getByRole("status").textContent).toContain("Setting up encrypted Docs");
        expect(screen.getByRole("button", { name: "Enable encrypted Docs" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Check setup" })).toBeDisabled();
    });
});
