/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { Room } from "matrix-js-sdk/src/matrix";
import { VirtuosoMockContext } from "@element-hq/web-shared-components";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { getRoomContext, stubClient, withContexts } from "test-utils";

import { EmojiPickerWithRecents } from "./EmojiPickerWithRecents";
import { getKeyBindingsManager } from "../KeyBindingsManager";
import { useCustomEmojiPacks } from "../hooks/useCustomEmojiPacks";

vi.mock("../hooks/useCustomEmojiPacks", () => ({ useCustomEmojiPacks: vi.fn(() => []) }));

describe("EmojiPickerWithRecents", () => {
    it("passes the selected emoji through to the picker", () => {
        render(<EmojiPickerWithRecents onChoose={() => true} onFinished={vi.fn()} selectedEmojis={new Set(["🎉"])} />);

        expect(screen.getByRole("checkbox", { name: "🎉" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("checkbox", { name: "🚀" })).toHaveAttribute("aria-checked", "false");
    });

    it("resolves keyboard actions using the app's keybindings", async () => {
        const getAccessibilityAction = vi.spyOn(getKeyBindingsManager(), "getAccessibilityAction");
        render(<EmojiPickerWithRecents onChoose={() => true} onFinished={vi.fn()} />);

        screen.getByRole("button", { name: "🎉" }).focus();
        await userEvent.keyboard("[ArrowRight]");

        expect(getAccessibilityAction).toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "😕" })).toHaveFocus();
    });

    it("offers the custom emoji of the room in the RoomContext", async () => {
        const client = stubClient();
        // Stubs what the Media helper resolves, so one image can fail to resolve.
        // eslint-disable-next-line no-restricted-properties
        vi.mocked(client.mxcUrlToHttp).mockImplementation((mxc) =>
            mxc.endsWith("broken") ? null : `https://example.org/${mxc.slice(6)}`,
        );
        const room = new Room("!room:example.org", client, client.getSafeUserId());
        vi.mocked(useCustomEmojiPacks).mockReturnValue([
            {
                id: "!space:example.org|",
                kind: "room",
                name: "Cat Server",
                avatarUrl: "mxc://example.org/icon",
                emojis: [
                    { shortcode: "broken", url: "mxc://example.org/broken" },
                    { shortcode: "party", url: "mxc://example.org/party" },
                ],
            },
            { id: "user", kind: "user", name: "Your emoji", emojis: [{ shortcode: "x", url: "mxc://a/broken" }] },
        ]);
        const onChoose = vi.fn(() => true);

        render(
            // Lays out the emoji grid, which happy-dom cannot measure.
            <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 40 }}>
                <EmojiPickerWithRecents onChoose={onChoose} onFinished={vi.fn()} />
            </VirtuosoMockContext.Provider>,
            withContexts({ matrixClient: client, roomContext: getRoomContext(room, {}) }),
        );

        expect(useCustomEmojiPacks).toHaveBeenLastCalledWith(room);
        const tab = screen.getByRole("tab", { name: "Cat Server" });
        expect(tab.querySelector("img")).toHaveAttribute("src", "https://example.org/example.org/icon");
        // Packs with nothing that can be displayed are left out.
        expect(screen.queryByRole("tab", { name: "Your emoji" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: ":broken:" })).not.toBeInTheDocument();

        await userEvent.click(await screen.findByRole("button", { name: ":party:" }));
        const party = {
            key: "mxc://example.org/party",
            shortcode: "party",
            src: "https://example.org/example.org/party",
        };
        expect(onChoose).toHaveBeenCalledWith(party.key, party);
    });

    it("prefers the room it is given over the RoomContext", () => {
        const client = stubClient();
        const contextRoom = new Room("!context:example.org", client, client.getSafeUserId());
        const room = new Room("!room:example.org", client, client.getSafeUserId());

        render(
            <EmojiPickerWithRecents room={room} onChoose={() => true} onFinished={vi.fn()} />,
            withContexts({ matrixClient: client, roomContext: getRoomContext(contextRoom, {}) }),
        );

        expect(useCustomEmojiPacks).toHaveBeenLastCalledWith(room);
    });
});
