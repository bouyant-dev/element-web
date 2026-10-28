/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { EmojiPart, PartCreator, PlainPart, Type } from "./parts";
import { createPartCreator } from "./__mocks__";
import EditorModel from "./model";

describe("editor/parts", () => {
    describe("appendUntilRejected", () => {
        const femaleFacepalmEmoji = "🤦‍♀️";

        it("should not accept emoji strings into type=plain", () => {
            const part = new PlainPart();
            expect(part.appendUntilRejected(femaleFacepalmEmoji, "")).toEqual(femaleFacepalmEmoji);
            expect(part.text).toEqual("");
        });

        it("should accept emoji strings into type=emoji", () => {
            const part = new EmojiPart();
            expect(part.appendUntilRejected(femaleFacepalmEmoji, "")).toBeUndefined();
            expect(part.text).toEqual(femaleFacepalmEmoji);
        });
    });

    it("should not explode on room pills for unknown rooms", () => {
        const pc = createPartCreator();
        const part = pc.roomPill("#room:server");
        expect(() => part.toDOMNode()).not.toThrow();
    });

    it("keeps custom emoji when cloning and draws their image behind the shortcode text", () => {
        const client = {
            mxcUrlToHttp: vi.fn((mxc: string) => `https://hs.tld/media/${mxc.slice(6)}`),
        } as unknown as MatrixClient;
        const pc = new PartCreator({} as Room, client);
        const model = new EditorModel([pc.customEmoji(":blob:", "mxc://hs.tld/blob")], pc);

        const [part] = model.clone().parts;
        expect(part.serialize()).toStrictEqual({
            type: "custom-emoji",
            text: ":blob:",
            resourceId: "mxc://hs.tld/blob",
        });
        const node = part.toDOMNode() as HTMLElement;
        expect(node.className).toBe("mx_CustomEmoji");
        expect(node.title).toBe(":blob:");
        // the caret code counts text nodes, so the shortcode must be the only one
        expect(node.childNodes).toHaveLength(1);
        expect(node.firstChild?.nodeType).toBe(Node.TEXT_NODE);
        expect(node.textContent).toBe(":blob:");
        expect(node.style.getPropertyValue("--avatar-background")).toBe("url('https://hs.tld/media/hs.tld/blob')");
    });

    it.each([
        ["without an image", undefined, ":blob:"],
        ["with a malformed image", "mxc://hs.tld/a/b", ":blob:"],
        ["with spaces in its shortcode", "mxc://hs.tld/blob", ":pay here:"],
    ])("keeps the text of a serialized custom emoji %s", (_, resourceId, text) => {
        const part = createPartCreator().deserializePart({ type: Type.CustomEmoji, text, resourceId });
        expect(part?.serialize()).toStrictEqual({ type: "plain", text });
    });

    it("does not reuse a user pill's node for a custom emoji, or the reverse", () => {
        const client = { mxcUrlToHttp: vi.fn(() => "https://hs.tld/media") } as unknown as MatrixClient;
        const pc = new PartCreator({ getMember: () => null } as unknown as Room, client);
        const emoji = pc.customEmoji(":blob:", "mxc://hs.tld/blob");
        const pill = pc.userPill("Alice", "@alice:hs.tld");
        expect(emoji.canUpdateDOMNode(pill.toDOMNode() as HTMLElement)).toBe(false);
        expect(pill.canUpdateDOMNode(emoji.toDOMNode() as HTMLElement)).toBe(false);
        expect(emoji.canUpdateDOMNode(pc.customEmoji(":cat:", "mxc://hs.tld/cat").toDOMNode() as HTMLElement)).toBe(
            true,
        );
    });
});
