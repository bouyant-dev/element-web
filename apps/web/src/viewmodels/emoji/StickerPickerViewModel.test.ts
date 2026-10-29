/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { UserTab } from "../../components/views/dialogs/UserTab";
import { StickerPickerViewModel } from "./StickerPickerViewModel";
import { type StickerPack } from "../../utils/matcha/imagePacks";

describe("StickerPickerViewModel", () => {
    let client: MatrixClient;
    let onFinished: () => void;

    const packs: StickerPack[] = [
        {
            id: "user",
            kind: "user",
            name: "Your stickers",
            stickers: [
                { shortcode: "wave", url: "mxc://server/wave", info: { w: 512, h: 512, mimetype: "image/webp" } },
                { shortcode: "party", url: "mxc://server/party", body: "Party frog" },
            ],
        },
        {
            id: "!room:server|pepe",
            kind: "room",
            roomId: "!room:server",
            stateKey: "pepe",
            name: "Pepe",
            avatarUrl: "mxc://server/pepe-avatar",
            stickers: [{ shortcode: "pepe_wave", url: "mxc://server/pepe-wave" }],
        },
    ];
    const make = (threadId: string | null = null): StickerPickerViewModel =>
        new StickerPickerViewModel({ client, packs, threadId, onFinished });
    const shown = (vm: StickerPickerViewModel): string[] =>
        vm.getSnapshot().stickers.map((sticker) => `${sticker.packId}:${sticker.shortcode}`);

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        onFinished = vi.fn();
        vi.spyOn(dis, "dispatch").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows every pack as a tab and the first pack's stickers", () => {
        const vm = make();
        const { tabs, selectedPackId, stickers } = vm.getSnapshot();
        expect(tabs.map((tab) => tab.name)).toEqual(["Your stickers", "Pepe"]);
        // A pack's icon is its avatar, else its first sticker; never an mxc URL.
        expect(tabs[0].iconSrc).toContain("wave");
        expect(tabs[1].iconSrc).toContain("pepe-avatar");
        expect(tabs.every((tab) => !tab.iconSrc?.startsWith("mxc:"))).toBe(true);
        expect(selectedPackId).toBe("user");
        expect(stickers.map((sticker) => sticker.label)).toEqual([":wave:", "Party frog"]);
        expect(stickers.every((sticker) => sticker.src.startsWith("http"))).toBe(true);
    });

    it("switches packs", () => {
        const vm = make();
        vm.selectPack("!room:server|pepe");
        expect(vm.getSnapshot().selectedPackId).toBe("!room:server|pepe");
        expect(shown(vm)).toEqual(["!room:server|pepe:pepe_wave"]);
    });

    it("searches every pack by shortcode and description, and a pack choice ends the search", () => {
        const vm = make();
        vm.setQuery(" WAVE ");
        expect(vm.getSnapshot().selectedPackId).toBeUndefined();
        expect(vm.getSnapshot().query).toBe(" WAVE ");
        expect(shown(vm)).toEqual(["user:wave", "!room:server|pepe:pepe_wave"]);
        vm.setQuery("frog");
        expect(shown(vm)).toEqual(["user:party"]);
        vm.setQuery("zebra");
        expect(shown(vm)).toEqual([]);

        vm.selectPack("user");
        expect(vm.getSnapshot().query).toBe("");
        expect(shown(vm)).toEqual(["user:wave", "user:party"]);
    });

    it("follows pack changes and falls back to the first pack when the chosen one goes", () => {
        const vm = make();
        vm.selectPack("!room:server|pepe");
        vm.setPacks([packs[0]]);
        expect(vm.getSnapshot().tabs).toHaveLength(1);
        expect(vm.getSnapshot().selectedPackId).toBe("user");
        vm.setPacks([]);
        expect(vm.getSnapshot()).toEqual({ tabs: [], query: "", stickers: [], selectedPackId: undefined });
    });

    it("sends a sticker through RoomView's sticker action and closes", () => {
        make().sendSticker("user", "wave");
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: "post_sticker_message",
            data: {
                content: { url: "mxc://server/wave", info: { w: 512, h: 512, mimetype: "image/webp" } },
                description: "wave",
                threadId: null,
            },
        });
        expect(onFinished).toHaveBeenCalled();
    });

    it("sends into the composer's thread, with the description and an empty info when it has none", () => {
        make("$thread").sendSticker("user", "party");
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: "post_sticker_message",
            data: { content: { url: "mxc://server/party", info: {} }, description: "Party frog", threadId: "$thread" },
        });
    });

    it("ignores a sticker that is no longer there", () => {
        make().sendSticker("user", "gone");
        expect(dis.dispatch).not.toHaveBeenCalled();
        expect(onFinished).not.toHaveBeenCalled();
    });

    it("opens the Emoji settings tab and closes", () => {
        make().openSettings();
        expect(dis.dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings, initialTabId: UserTab.Emoji });
        expect(onFinished).toHaveBeenCalled();
    });
});
