/*
Copyright 2024 New Vector Ltd.
Copyright 2022 Ryan Browne <code@commonlawfeature.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { stubClient, mkStubRoom } from "test-utils";

import EmojiProvider from "./EmojiProvider";
import { add } from "../emojipicker/recent";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { type ICompletion } from "./Autocompleter";
import { availableEmojiPacks } from "../hooks/useCustomEmojiPacks";

vi.mock("../hooks/useCustomEmojiPacks", () => ({ availableEmojiPacks: vi.fn().mockReturnValue([]) }));

const EMOJI_SHORTCODES = [
    ":+1",
    ":heart",
    ":grinning",
    ":hand",
    ":man",
    ":sweat",
    ":monkey",
    ":boat",
    ":mailbox",
    ":cop",
    ":bow",
    ":kiss",
    ":golf",
];

// Some emoji shortcodes are too short and do not actually trigger autocompletion until the ending `:`.
// This means that we cannot compare their autocompletion before and after the ending `:` and have
// to simply assert that the final completion with the colon is the exact emoji.
const TOO_SHORT_EMOJI_SHORTCODE = [{ emojiShortcode: ":o", expectedEmoji: "⭕️" }];

interface CompletionComponentProps {
    title: string;
}

describe("EmojiProvider", function () {
    const testRoom = mkStubRoom(undefined, undefined, undefined);
    stubClient();
    MatrixClientPeg.safeGet();

    it.each(EMOJI_SHORTCODES)("Returns consistent results after final colon %s", async function (emojiShortcode) {
        const ep = new EmojiProvider(testRoom);
        const range = { beginning: true, start: 0, end: 3 };
        const completionsBeforeColon = await ep.getCompletions(emojiShortcode, range);
        const completionsAfterColon = await ep.getCompletions(emojiShortcode + ":", range);

        const firstCompletionWithoutColon = completionsBeforeColon[0].completion;
        const firstCompletionWithColon = completionsAfterColon[0].completion;

        expect(firstCompletionWithoutColon).toEqual(firstCompletionWithColon);
    });

    it.each(TOO_SHORT_EMOJI_SHORTCODE)(
        "Returns correct results after final colon $emojiShortcode",
        async ({ emojiShortcode, expectedEmoji }) => {
            const ep = new EmojiProvider(testRoom);
            const range = { beginning: true, start: 0, end: 3 };
            const completions = await ep.getCompletions(emojiShortcode + ":", range);

            expect(completions[0].completion).toEqual(expectedEmoji);
        },
    );

    it("Recently used emojis are correctly sorted", async function () {
        add("😘"); //kissing_heart
        add("💗"); //heartpulse
        add("💗"); //heartpulse
        add("😍"); //heart_eyes

        const ep = new EmojiProvider(testRoom);
        const completionsList = await ep.getCompletions(":heart", { beginning: true, start: 0, end: 6 });
        expect((completionsList[0]?.component?.props as CompletionComponentProps).title).toEqual(":heartpulse:");
        expect((completionsList[1]?.component?.props as CompletionComponentProps).title).toEqual(":heart_eyes:");
    });

    it("Exact match in recently used takes the lead", async function () {
        add("😘"); //kissing_heart
        add("💗"); //heartpulse
        add("💗"); //heartpulse
        add("😍"); //heart_eyes

        add("❤️"); //heart
        const ep = new EmojiProvider(testRoom);
        const completionsList = await ep.getCompletions(":heart", { beginning: true, start: 0, end: 6 });

        expect((completionsList[0]?.component?.props as CompletionComponentProps).title).toEqual(":heart:");
        expect((completionsList[1]?.component?.props as CompletionComponentProps).title).toEqual(":heartpulse:");
        expect((completionsList[2]?.component?.props as CompletionComponentProps).title).toEqual(":heart_eyes:");
    });

    describe("custom emoji", () => {
        const emojis = (...shortcodes: string[]) =>
            shortcodes.map((shortcode) => ({ shortcode, url: `mxc://hs.tld/${shortcode}` }));

        const custom = (completions: ICompletion[]): string[] =>
            completions.filter((c) => c.type === "custom-emoji").map((c) => c.completion);

        it("put an exact custom match first, other custom matches after the exact unicode one, once per image", async () => {
            vi.mocked(availableEmojiPacks).mockReturnValueOnce([
                { id: "user", kind: "user", name: "Your emoji", emojis: emojis("heart", "heartcat") },
                { id: "!a:hs.tld|", kind: "room", name: "A", emojis: emojis("heart", "other") },
            ]);
            const ep = new EmojiProvider(testRoom);
            const completions = await ep.getCompletions(":heart", { beginning: true, start: 0, end: 6 });

            expect(availableEmojiPacks).toHaveBeenCalledWith(MatrixClientPeg.safeGet(), testRoom);
            const exactIndex = completions.findIndex((c) => c.completion === "❤️");
            expect(completions[0]).toMatchObject({
                type: "custom-emoji",
                completion: ":heart:",
                completionId: "mxc://hs.tld/heart",
            });
            expect(completions[exactIndex + 1]).toMatchObject({ completion: ":heartcat:" });
            expect(custom(completions)).toEqual([":heart:", ":heartcat:"]);
            expect((completions[0].component.props as CompletionComponentProps).title).toEqual(":heart:");
        });

        it("never put a custom prefix match before an exact unicode match", async () => {
            vi.mocked(availableEmojiPacks).mockReturnValueOnce([
                { id: "user", kind: "user", name: "Your emoji", emojis: emojis("thumbsup_party") },
            ]);
            const ep = new EmojiProvider(testRoom);
            const completions = await ep.getCompletions(":thumbsup", { beginning: true, start: 0, end: 9 });

            expect(completions[0].completion).toContain("👍");
            expect(custom(completions)).toEqual([":thumbsup_party:"]);
        });

        it("offer an exact match before longer shortcodes from earlier packs", async () => {
            const shortcodes = Array.from({ length: 9 }, (_, i) => `blob_${i}`);
            vi.mocked(availableEmojiPacks).mockReturnValueOnce([
                { id: "user", kind: "user", name: "Your emoji", emojis: emojis(...shortcodes) },
                { id: "!a:hs.tld|", kind: "room", name: "A", emojis: emojis("blob") },
            ]);
            const ep = new EmojiProvider(testRoom);
            const completions = await ep.getCompletions(":blob", { beginning: true, start: 0, end: 5 });

            expect(custom(completions)[0]).toBe(":blob:");
            expect(completions[0].completion).toBe(":blob:");
        });

        it("match shortcodes with punctuation and accents", async () => {
            vi.mocked(availableEmojiPacks).mockReturnValue([
                { id: "user", kind: "user", name: "Your emoji", emojis: emojis("pepe.happy", "café") },
            ]);
            const ep = new EmojiProvider(testRoom);

            expect(custom(await ep.getCompletions(":pepe.h", { beginning: true, start: 0, end: 7 }))).toEqual([
                ":pepe.happy:",
            ]);
            expect(custom(await ep.getCompletions(":café", { beginning: true, start: 0, end: 5 }))).toEqual([":café:"]);
            vi.mocked(availableEmojiPacks).mockReturnValue([]);
        });

        it("do not make unicode emoji names searchable by punctuation", async () => {
            const ep = new EmojiProvider(testRoom);
            expect(await ep.getCompletions("lol :P,", { beginning: true, start: 7, end: 7 })).toEqual([]);
        });

        it("are limited to eight suggestions", async () => {
            const shortcodes = Array.from({ length: 10 }, (_, i) => `blob${i}`);
            vi.mocked(availableEmojiPacks).mockReturnValueOnce([
                { id: "user", kind: "user", name: "Your emoji", emojis: emojis(...shortcodes) },
            ]);
            const ep = new EmojiProvider(testRoom);
            const completions = await ep.getCompletions(":blob", { beginning: true, start: 0, end: 5 });

            expect(completions.filter((c) => c.type === "custom-emoji")).toHaveLength(8);
        });
    });
});
