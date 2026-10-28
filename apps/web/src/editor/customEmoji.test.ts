/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";

import EditorModel from "./model";
import { createPartCreator, createRenderer } from "./__mocks__";
import { replaceTypedCustomEmoji } from "./customEmoji";
import { htmlSerializeIfNeeded, textSerialize } from "./serialize";
import { type EmojiPack } from "../utils/matcha/imagePacks";
import { type Part } from "./parts";

const packs: EmojiPack[] = [
    { id: "user", kind: "user", name: "Yours", emojis: [{ shortcode: "a", url: "mxc://hs.tld/a" }] },
    {
        id: "!r:hs.tld|",
        kind: "room",
        name: "Room",
        emojis: [
            { shortcode: "a", url: "mxc://hs.tld/other_a" },
            { shortcode: "b", url: "mxc://hs.tld/b" },
        ],
    },
];

function convert(...parts: Part[]): EditorModel {
    const model = new EditorModel(parts, createPartCreator(), createRenderer());
    replaceTypedCustomEmoji(model, packs);
    return model;
}

const a = { type: "custom-emoji", text: ":a:", resourceId: "mxc://hs.tld/a" };
const b = { type: "custom-emoji", text: ":b:", resourceId: "mxc://hs.tld/b" };

describe("replaceTypedCustomEmoji", () => {
    const pc = createPartCreator();

    it("converts a typed shortcode, taking the first pack's emoji", () => {
        expect(convert(pc.plain("hi :a: there")).serializeParts()).toEqual([
            { type: "plain", text: "hi " },
            a,
            { type: "plain", text: " there" },
        ]);
    });

    it("converts several shortcodes across parts, including pill candidates", () => {
        expect(convert(pc.plain("x :a: y "), pc.pillCandidate(":b:")).serializeParts()).toEqual([
            { type: "plain", text: "x " },
            a,
            { type: "plain", text: " y " },
            b,
        ]);
    });

    it("converts adjacent shortcodes", () => {
        expect(convert(pc.plain("::a::b::")).serializeParts()).toEqual([
            { type: "plain", text: ":" },
            a,
            b,
            { type: "plain", text: ":" },
        ]);
    });

    it("leaves unknown and partial shortcodes alone, but not a known one sharing their colon", () => {
        expect(convert(pc.plain(":nope: :a :x:b:")).serializeParts()).toEqual([
            { type: "plain", text: ":nope: :a :x" },
            b,
        ]);
    });

    it("does nothing without packs", () => {
        const model = new EditorModel([pc.plain(":a:")], pc, createRenderer());
        replaceTypedCustomEmoji(model, []);
        expect(model.serializeParts()).toEqual([{ type: "plain", text: ":a:" }]);
    });

    it("leaves the shortcode as text inside code", () => {
        const model = convert(pc.plain("`:a:` :a:"));
        expect(htmlSerializeIfNeeded(model)).toBe(
            '<code>:a:</code> <img data-mx-emoticon="" src="mxc://hs.tld/a" alt=":a:" title=":a:" height="32">',
        );
        expect(textSerialize(model)).toBe("`:a:` :a:");
    });
});
