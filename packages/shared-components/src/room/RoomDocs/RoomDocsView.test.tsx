/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomDocsView, type RoomDocsSnapshot } from "./RoomDocsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<RoomDocsSnapshot> {
    public setMode = vi.fn();
    public retry = vi.fn();
}
const initial: RoomDocsSnapshot = {
    roomName: "Product studio",
    mode: "edit",
    ready: true,
    canEdit: true,
    sync: "saved",
    pendingUpdates: 0,
    html: "<h1>Release plan</h1>",
};

describe("RoomDocsView", () => {
    it("shows the selected document name and containing space", () => {
        render(
            <RoomDocsView
                vm={new TestViewModel({ ...initial, documentName: "Release checklist" })}
                editor={<textarea />}
                onDownload={vi.fn()}
            />,
        );
        expect(screen.getByRole("heading", { name: "Release checklist" })).toBeVisible();
        expect(screen.getByText(/Product studio/)).toBeVisible();
    });
    it("keeps the editor mounted while switching to the document preview", async () => {
        const vm = new TestViewModel(initial);
        const download = vi.fn();
        const editor = <textarea aria-label="Markdown document" defaultValue="# Release plan" />;
        const { rerender } = render(<RoomDocsView vm={vm} editor={editor} onDownload={download} />);
        const input = screen.getByRole("textbox", { name: "Markdown document" });
        await userEvent.click(screen.getByRole("button", { name: "Preview" }));
        expect(vm.setMode).toHaveBeenCalledWith("preview");
        rerender(
            <RoomDocsView
                vm={new TestViewModel({ ...initial, mode: "preview" })}
                editor={editor}
                onDownload={download}
            />,
        );
        expect(input.isConnected).toBe(true);
        expect(input).not.toBeVisible();
        expect(screen.getByRole("heading", { name: "Release plan" })).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
        expect(download).toHaveBeenCalledOnce();
    });
    it("makes unsaved work and retry visible without hiding the editor or download", async () => {
        const vm = new TestViewModel({
            ...initial,
            sync: "error",
            pendingUpdates: 2,
            error: "Connection lost. Your edits are kept.",
        });
        render(<RoomDocsView vm={vm} editor={<textarea aria-label="Markdown document" />} onDownload={vi.fn()} />);
        expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
        expect(screen.getByRole("alert").textContent).toContain("Your edits are kept");
        expect(screen.getByRole("textbox")).toBeVisible();
        expect(screen.getByRole("button", { name: "Download Markdown" })).toBeEnabled();
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(vm.retry).toHaveBeenCalledOnce();
    });
    it("explains read-only permissions and an empty document", () => {
        render(
            <RoomDocsView
                vm={new TestViewModel({ ...initial, mode: "preview", canEdit: false, html: "" })}
                editor={<div />}
                onDownload={vi.fn()}
            />,
        );
        expect(screen.getByText(/You can read this document/)).toBeVisible();
        expect(screen.getByText(/This document is empty/)).toBeVisible();
    });
});
