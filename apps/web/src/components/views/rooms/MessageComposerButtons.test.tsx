/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { createTestClient, getRoomContext, mkStubRoom } from "test-utils";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MessageComposerButtons from "./MessageComposerButtons";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext.tsx";
import { type RoomContextType } from "../../../contexts/RoomContext.ts";
import { RoomUploadContextProvider } from "../../../viewmodels/room/RoomUploadViewModel.tsx";
import SdkConfig from "../../../SdkConfig";
import SettingsStore from "../../../settings/SettingsStore";

describe("MessageComposerButtons", () => {
    // @ts-ignore - we're deliberately not implementing the whole interface here, but
    // can't use Partial<> for types because it'll annoy TS more than it helps.
    const mockProps: React.ComponentProps<typeof MessageComposerButtons> = {
        addEmoji: () => false,
        haveRecording: false,
        isStickerPickerOpen: false,
        menuPosition: undefined,
        onRecordStartEndClick: () => {},
        setStickerPickerOpen: () => {},
        setEmojiPickerOpen: () => {},
        toggleButtonMenu: () => {},
    };

    const mockClient = createTestClient();
    vi.spyOn(MatrixClientPeg, "get").mockReturnValue(mockClient);

    function getButtonLabels() {
        const getLabels = (elements: HTMLElement[]): string[] =>
            elements
                .map((element) => element.getAttribute("aria-label"))
                .filter((label): label is string => label !== null);

        const mainLabels: Array<string | string[]> = getLabels(screen.queryAllByRole("button"));
        const menuLabels = getLabels(screen.queryAllByRole("menuitem"));

        if (menuLabels.length) {
            mainLabels.push(getLabels(screen.queryAllByRole("menuitem")));
        }

        return mainLabels;
    }

    function wrapAndRender(component: React.ReactElement, narrow: boolean) {
        const mockRoom = mkStubRoom("myfakeroom", "myfakeroom", mockClient) as any;
        const defaultRoomContext: RoomContextType = getRoomContext(mockRoom, { narrow });

        return render(
            <MatrixClientContext.Provider value={mockClient}>
                <ScopedRoomContextProvider {...defaultRoomContext}>
                    <RoomUploadContextProvider>{component}</RoomUploadContextProvider>
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>,
        );
    }

    it("Renders emoji and upload buttons in wide mode", () => {
        wrapAndRender(
            <MessageComposerButtons
                {...mockProps}
                isMenuOpen={false}
                showLocationButton={true}
                showPollsButton={true}
                showStickersButton={true}
            />,
            false,
        );

        expect(getButtonLabels()).toEqual(["Emoji", "Attachment", "More options"]);
    });

    it("Renders other buttons in menu in wide mode", async () => {
        wrapAndRender(
            <MessageComposerButtons
                {...mockProps}
                isMenuOpen={true}
                showLocationButton={true}
                showPollsButton={true}
                showStickersButton={true}
            />,
            false,
        );

        // The location code is lazy loaded, so the button will take a little while
        // to appear, so we need to wait.
        await waitFor(() => {
            expect(getButtonLabels()).toEqual([
                "Emoji",
                "Attachment",
                "More options",
                ["Sticker", "Voice Message", "Poll", "Location"],
            ]);
        });
    });

    it("Renders only some buttons in narrow mode", () => {
        wrapAndRender(
            <MessageComposerButtons
                {...mockProps}
                isMenuOpen={false}
                showLocationButton={true}
                showPollsButton={true}
                showStickersButton={true}
            />,
            true,
        );

        expect(getButtonLabels()).toEqual(["Emoji", "More options"]);
    });

    it("Renders other buttons in menu (except voice messages) in narrow mode", () => {
        wrapAndRender(
            <MessageComposerButtons
                {...mockProps}
                isMenuOpen={true}
                showLocationButton={true}
                showPollsButton={true}
                showStickersButton={true}
            />,
            true,
        );

        expect(getButtonLabels()).toEqual(["Emoji", "More options", ["Attachment", "Sticker", "Poll", "Location"]]);
    });

    describe("polls button", () => {
        it("should render when asked to", () => {
            wrapAndRender(
                <MessageComposerButtons
                    {...mockProps}
                    isMenuOpen={true}
                    showLocationButton={true}
                    showPollsButton={true}
                    showStickersButton={true}
                />,
                true,
            );

            expect(getButtonLabels()).toEqual(["Emoji", "More options", ["Attachment", "Sticker", "Poll", "Location"]]);
        });

        it("should not render when asked not to", () => {
            wrapAndRender(
                <MessageComposerButtons
                    {...mockProps}
                    isMenuOpen={true}
                    showLocationButton={true}
                    showPollsButton={false} // !! the change from the alternate test
                    showStickersButton={true}
                />,
                true,
            );

            expect(getButtonLabels()).toEqual([
                "Emoji",
                "More options",
                [
                    "Attachment",
                    "Sticker",
                    // "Poll", // should be hidden
                    "Location",
                ],
            ]);
        });
    });

    describe("with Matcha's beta features on", () => {
        beforeEach(() => {
            SdkConfig.add({ matcha_thread_tabs: true });
        });

        afterEach(() => {
            SdkConfig.reset();
            vi.restoreAllMocks();
        });

        const renderButtons = (narrow: boolean, props: Partial<React.ComponentProps<typeof MessageComposerButtons>>) =>
            wrapAndRender(
                <MessageComposerButtons
                    {...mockProps}
                    isMenuOpen={false}
                    showLocationButton={true}
                    showPollsButton={true}
                    showStickersButton={true}
                    {...props}
                />,
                narrow,
            );

        it("puts the sticker button in the bar and emoji in the menu in wide mode", async () => {
            renderButtons(false, { isMenuOpen: true });
            await waitFor(() => {
                expect(getButtonLabels()).toEqual([
                    "Sticker",
                    "Attachment",
                    "More options",
                    ["Emoji", "Voice Message", "Poll", "Location"],
                ]);
            });
        });

        it("puts the sticker button in the bar and emoji in the menu in narrow mode", () => {
            renderButtons(true, { isMenuOpen: true });
            expect(getButtonLabels()).toEqual(["Sticker", "More options", ["Attachment", "Emoji", "Poll", "Location"]]);
        });

        it("opens the composer's emoji picker from the menu", async () => {
            const setEmojiPickerOpen = vi.fn();
            renderButtons(false, { isMenuOpen: true, setEmojiPickerOpen });
            await userEvent.click(screen.getByRole("menuitem", { name: "Emoji" }));
            expect(setEmojiPickerOpen).toHaveBeenCalledWith(true);
        });

        it("opens the sticker picker from the bar", async () => {
            const setStickerPickerOpen = vi.fn();
            renderButtons(false, { setStickerPickerOpen });
            await userEvent.click(screen.getByRole("button", { name: "Sticker" }));
            expect(setStickerPickerOpen).toHaveBeenCalledWith(true);
        });

        it("keeps the emoji button in the bar when the stickers button is turned off", () => {
            renderButtons(false, { isMenuOpen: true, showStickersButton: false, showLocationButton: false });
            expect(getButtonLabels()).toEqual(["Emoji", "Attachment", "More options", ["Voice Message", "Poll"]]);
        });

        it("leaves emoji to the formatting bar in the WYSIWYG composer", () => {
            const getValue = SettingsStore.getValue;
            vi.spyOn(SettingsStore, "getValue").mockImplementation((name, ...rest) =>
                name === "feature_wysiwyg_composer" ? true : getValue.call(SettingsStore, name, ...rest),
            );
            renderButtons(true, { isMenuOpen: true, showLocationButton: false });
            expect(getButtonLabels()).toEqual(["Show formatting", "Sticker", "More options", ["Attachment", "Poll"]]);
        });
    });
});
