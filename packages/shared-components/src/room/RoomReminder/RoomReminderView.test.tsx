/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomReminderView, type RoomReminderSnapshot } from "./RoomReminderView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<RoomReminderSnapshot> {
    public setMode = vi.fn();
    public setDuration = vi.fn();
    public setUnit = vi.fn();
    public setDateTime = vi.fn();
    public setMessage = vi.fn();
    public submit = vi.fn();
}

const initial: RoomReminderSnapshot = {
    mode: "in",
    duration: "10",
    unit: "m",
    dateTime: "2026-10-23T17:00:00",
    message: "Check release",
    timezone: "Asia/Jakarta",
    canSubmit: true,
};

describe("RoomReminderView", () => {
    it("shows separate duration, units and message controls", async () => {
        const vm = new TestViewModel(initial);
        render(<RoomReminderView vm={vm} />);
        expect(screen.getByRole("spinbutton", { name: "Duration" })).toHaveValue(10);
        expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("maxlength", "2000");
        await userEvent.selectOptions(screen.getByRole("combobox", { name: "Unit" }), "s");
        expect(vm.setUnit).toHaveBeenCalledWith("s");
        await userEvent.selectOptions(screen.getByRole("combobox", { name: "When" }), "at");
        expect(vm.setMode).toHaveBeenCalledWith("at");
    });

    it("shows the precise date control with the user's timezone and validation feedback", () => {
        render(<RoomReminderView vm={new TestViewModel({ ...initial, mode: "at", error: "Choose a future time" })} />);
        expect(screen.getByLabelText("Date and time")).toHaveAttribute("type", "datetime-local");
        expect(screen.getByText("Times are in Asia/Jakarta.")).toBeVisible();
        expect(screen.getByRole("alert").textContent).toContain("Choose a future time");
        expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    });
});
