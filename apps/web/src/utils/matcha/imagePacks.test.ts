/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventType, type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership, type Membership } from "matrix-js-sdk/src/types";
import { createTestClient } from "test-utils";

import {
    EMOTE_ROOMS_EVENT,
    NEW_SHORTCODE_PATTERN,
    ROOM_EMOTES_EVENT,
    USER_EMOTES_EVENT,
    type EmojiPack,
    type ImagePackContent,
    emoticonHtml,
    findEmojiByShortcode,
    getEmojiPacks,
    getParentSpaceIds,
    parseEmojiImages,
    replaceEmoticonsWithText,
    shortcodeFromFileName,
    withImage,
    withRenamedImage,
    withoutImage,
} from "./imagePacks";

const mxc = (id: string): string => `mxc://example.org/${id}`;

describe("imagePacks", () => {
    describe("parseEmojiImages", () => {
        it("should return valid emoji sorted by shortcode", () => {
            expect(
                parseEmojiImages({
                    images: {
                        "zebra": { url: mxc("z") },
                        "apple": { url: mxc("a"), body: "An apple", info: { w: 32 } },
                        "party-parrot": { url: "mxc://[::1]:8448/abc_DEF-1" },
                    },
                }),
            ).toEqual([
                { shortcode: "apple", url: mxc("a"), body: "An apple" },
                { shortcode: "party-parrot", url: "mxc://[::1]:8448/abc_DEF-1" },
                { shortcode: "zebra", url: mxc("z") },
            ]);
        });

        it("should return nothing for content that is not a pack", () => {
            for (const content of [
                undefined,
                null,
                1,
                "images",
                [],
                { images: [] },
                { images: "x" },
                { images: null },
            ]) {
                expect(parseEmojiImages(content)).toEqual([]);
            }
        });

        it("should drop images whose url is not a plain mxc URL", () => {
            const urls: unknown[] = [
                "https://example.org/a.png",
                "javascript:alert(1)",
                "data:image/png;base64,AAAA",
                "MXC://example.org/a",
                "mxc://example.org",
                "mxc://example.org/",
                "mxc://example.org/a/b",
                'mxc://example.org/a" onerror="alert(1)',
                "mxc://exa mple.org/a",
                ` ${mxc("a")}`,
                mxc("a".repeat(1000)),
                42,
                null,
                { url: mxc("a") },
            ];
            const images = Object.fromEntries(urls.map((url, i) => [`code${i}`, { url }]));
            expect(parseEmojiImages({ images: { ...images, ok: { url: mxc("ok") } } })).toEqual([
                { shortcode: "ok", url: mxc("ok") },
            ]);
        });

        it("should drop invalid shortcodes and image entries", () => {
            expect(
                parseEmojiImages({
                    images: {
                        "has space": { url: mxc("a") },
                        "co:lon": { url: mxc("a") },
                        "": { url: mxc("a") },
                        // too long once colons are added, measured in UTF-8 bytes as MSC4027 does
                        ["x".repeat(99)]: { url: mxc("a") },
                        ["猫".repeat(33)]: { url: mxc("a") },
                        "bidi\u202Eoverride": { url: mxc("a") },
                        "bell\u0007": { url: mxc("a") },
                        "null": null,
                        "array": [mxc("a")],
                        "string": mxc("a"),
                        ["x".repeat(98)]: { url: mxc("long") },
                        ["猫".repeat(32)]: { url: mxc("cat") },
                        "ünïcode": { url: mxc("u") },
                    },
                }),
            ).toEqual([
                { shortcode: "ünïcode", url: mxc("u") },
                { shortcode: "x".repeat(98), url: mxc("long") },
                { shortcode: "猫".repeat(32), url: mxc("cat") },
            ]);
        });

        it("should drop overlong bodies and ignore bodies that are not strings", () => {
            expect(
                parseEmojiImages({
                    images: {
                        long: { url: mxc("a"), body: "b".repeat(1001) },
                        max: { url: mxc("b"), body: "b".repeat(1000) },
                        number: { url: mxc("c"), body: 5 },
                        empty: { url: mxc("d"), body: "" },
                    },
                }),
            ).toEqual([
                { shortcode: "empty", url: mxc("d") },
                { shortcode: "max", url: mxc("b"), body: "b".repeat(1000) },
                { shortcode: "number", url: mxc("c") },
            ]);
        });

        it("should keep only images usable as emoticons, with image usage overriding the pack's", () => {
            const codes = (content: unknown): string[] => parseEmojiImages(content).map((emoji) => emoji.shortcode);
            const images = {
                none: { url: mxc("a") },
                empty: { url: mxc("b"), usage: [] },
                emoticon: { url: mxc("c"), usage: ["emoticon"] },
                sticker: { url: mxc("d"), usage: ["sticker"] },
                both: { url: mxc("e"), usage: ["sticker", "emoticon"] },
                hostile: { url: mxc("f"), usage: "emoticon" },
            };
            expect(codes({ images })).toEqual(["both", "emoticon", "empty", "hostile", "none"]);
            expect(codes({ images, pack: { usage: ["sticker"] } })).toEqual(["both", "emoticon"]);
            expect(codes({ images, pack: { usage: ["emoticon"] } })).toEqual([
                "both",
                "emoticon",
                "empty",
                "hostile",
                "none",
            ]);
            expect(codes({ images, pack: { usage: "sticker" } })).toEqual([
                "both",
                "emoticon",
                "empty",
                "hostile",
                "none",
            ]);
        });
    });

    describe("getEmojiPacks", () => {
        let client: MatrixClient;
        let accountData: Record<string, unknown>;
        let rooms: Map<string, Room>;

        const makeRoom = (
            roomId: string,
            name: string,
            membership: Membership,
            packs: Record<string, unknown>,
        ): Room => {
            const room = new Room(roomId, client, client.getSafeUserId());
            room.name = name;
            room.updateMyMembership(membership);
            room.currentState.setStateEvents(
                Object.entries(packs).map(
                    ([stateKey, content]) =>
                        new MatrixEvent({
                            type: ROOM_EMOTES_EVENT,
                            state_key: stateKey,
                            content: content as ImagePackContent,
                            room_id: roomId,
                            sender: "@alice:example.org",
                            event_id: `$${roomId}${stateKey}`,
                        }),
                ),
            );
            rooms.set(roomId, room);
            return room;
        };
        const pack = (code: string, displayName?: string): ImagePackContent => ({
            images: { [code]: { url: mxc(code) } },
            ...(displayName ? { pack: { display_name: displayName } } : {}),
        });
        const ids = (packs: EmojiPack[]): string[] => packs.map((emojiPack) => emojiPack.id);

        beforeEach(() => {
            client = createTestClient();
            accountData = {};
            rooms = new Map();
            vi.mocked(client.getAccountData).mockImplementation((type) =>
                accountData[type] === undefined
                    ? undefined
                    : new MatrixEvent({ type, content: accountData[type] as ImagePackContent }),
            );
            vi.mocked(client.getRoom).mockImplementation((roomId) => (roomId && rooms.get(roomId)) || null);
        });

        it("should order personal, enabled, room and parent Space packs, each once", () => {
            accountData[USER_EMOTES_EVENT] = {
                images: { wave: { url: mxc("wave") } },
                pack: { display_name: "Ignored", avatar_url: mxc("me") },
            };
            accountData[EMOTE_ROOMS_EVENT] = {
                rooms: {
                    "!other:x": { fav: {}, missing: {} },
                    "!invited:x": { "": {} },
                    // also a pack of the room, but keeps its place among the packs enabled everywhere
                    "!room:x": { "zz-cinny": {} },
                },
            };
            const room = makeRoom("!room:x", "General", KnownMembership.Join, {
                "zz-cinny": pack("b", "Cinny pack"),
                "": pack("a"),
                "empty": { images: {} },
                "stickers": { images: { s: { url: mxc("s") } }, pack: { usage: ["sticker"] } },
            });
            makeRoom("!space:x", "Space", KnownMembership.Join, {
                "": { ...pack("c"), pack: { avatar_url: mxc("space"), display_name: "  " } },
            });
            makeRoom("!left:x", "Left Space", KnownMembership.Leave, { "": pack("d") });
            makeRoom("!other:x", "Other", KnownMembership.Join, { "fav": pack("e", "Favourites"), "": pack("f") });
            makeRoom("!invited:x", "Invited", KnownMembership.Invite, { "": pack("g") });

            const packs = getEmojiPacks(client, room, ["!left:x", "!space:x", "!room:x", "!unknown:x"], "Your emoji");

            expect(ids(packs)).toEqual(["user", "!other:x|fav", "!room:x|zz-cinny", "!room:x|", "!space:x|"]);
            expect(packs[0]).toEqual({
                id: "user",
                kind: "user",
                name: "Your emoji",
                avatarUrl: mxc("me"),
                emojis: [{ shortcode: "wave", url: mxc("wave") }],
            });
            expect(packs[3]).toEqual({
                id: "!room:x|",
                kind: "room",
                roomId: "!room:x",
                stateKey: "",
                name: "General",
                emojis: [{ shortcode: "a", url: mxc("a") }],
            });
            expect(packs.map((emojiPack) => emojiPack.name)).toEqual([
                "Your emoji",
                "Favourites",
                "Cinny pack",
                "General",
                "Space",
            ]);
            expect(packs[4].avatarUrl).toBe(mxc("space"));
        });

        it("should offer only enabled packs without a room", () => {
            accountData[EMOTE_ROOMS_EVENT] = { rooms: { "!other:x": { fav: {} } } };
            makeRoom("!other:x", "Other", KnownMembership.Join, { fav: pack("e") });

            expect(ids(getEmojiPacks(client, undefined, [], "Your emoji"))).toEqual(["!other:x|fav"]);
        });

        it("should ignore malformed account data", () => {
            makeRoom("!other:x", "Other", KnownMembership.Join, { "": pack("e") });
            for (const content of [
                { rooms: "x" },
                { rooms: { "!other:x": "x" } },
                { rooms: ["!other:x"] },
                { images: 1 },
            ]) {
                accountData[EMOTE_ROOMS_EVENT] = content;
                accountData[USER_EMOTES_EVENT] = content;
                expect(getEmojiPacks(client, undefined, [], "Your emoji")).toEqual([]);
            }
        });
    });

    describe("getParentSpaceIds", () => {
        let client: MatrixClient;
        let rooms: Map<string, Room>;

        // A room naming the given Spaces as its parents in its own state.
        const makeRoom = (roomId: string, parents: Record<string, object>): void => {
            const room = new Room(roomId, client, client.getSafeUserId());
            room.currentState.setStateEvents(
                Object.entries(parents).map(
                    ([parentId, content]) =>
                        new MatrixEvent({
                            type: EventType.SpaceParent,
                            state_key: parentId,
                            content,
                            room_id: roomId,
                            sender: "@alice:example.org",
                            event_id: `$${roomId}${parentId}`,
                        }),
                ),
            );
            rooms.set(roomId, room);
        };

        beforeEach(() => {
            client = createTestClient();
            rooms = new Map();
            vi.mocked(client.getRoom).mockImplementation((roomId) => (roomId && rooms.get(roomId)) || null);
        });

        it("should follow the room's own parents up through nested Spaces, nearest first", () => {
            const via = { via: ["x"] };
            makeRoom("!room:x", { "!a:x": via, "!b:x": { ...via, canonical: true }, "!removed:x": {} });
            makeRoom("!a:x", { "!top:x": via, "!room:x": via });
            makeRoom("!b:x", { "!top:x": via });
            makeRoom("!top:x", { "!a:x": via });

            expect(getParentSpaceIds(client, "!room:x")).toEqual(["!a:x", "!b:x", "!top:x"]);
        });

        it("should ignore Spaces that only list the room as a child", () => {
            makeRoom("!room:x", {});
            const space = new Room("!space:x", client, client.getSafeUserId());
            space.currentState.setStateEvents([
                new MatrixEvent({
                    type: EventType.SpaceChild,
                    state_key: "!room:x",
                    content: { via: ["x"] },
                    room_id: space.roomId,
                    sender: "@mallory:example.org",
                    event_id: "$child",
                }),
            ]);
            rooms.set(space.roomId, space);

            expect(getParentSpaceIds(client, "!room:x")).toEqual([]);
        });

        it("should stop after five levels", () => {
            for (let i = 0; i < 8; i++) makeRoom(`!${i}:x`, { [`!${i + 1}:x`]: { via: ["x"] } });

            expect(getParentSpaceIds(client, "!0:x")).toEqual(["!1:x", "!2:x", "!3:x", "!4:x", "!5:x"]);
        });
    });

    describe("findEmojiByShortcode", () => {
        const packs: EmojiPack[] = [
            { id: "user", kind: "user", name: "Mine", emojis: [{ shortcode: "cat", url: mxc("mine") }] },
            {
                id: "!r|",
                kind: "room",
                name: "Room",
                emojis: [
                    { shortcode: "cat", url: mxc("room") },
                    { shortcode: "dog", url: mxc("dog") },
                ],
            },
        ];

        it("should return the first match in pack order", () => {
            expect(findEmojiByShortcode(packs, "cat")?.url).toBe(mxc("mine"));
            expect(findEmojiByShortcode(packs, "dog")?.url).toBe(mxc("dog"));
            expect(findEmojiByShortcode(packs, ":dog:")).toBeUndefined();
            expect(findEmojiByShortcode([], "cat")).toBeUndefined();
        });
    });

    describe("shortcodeFromFileName", () => {
        it.each([
            ["party parrot.gif", "party_parrot"],
            ["Cat-Face_2.PNG", "Cat-Face_2"],
            ["file.name.webp", "file_name"],
            ["😀.png", "emoji"],
            [".gif", "emoji"],
            ["a.png", "a_"],
            ["_x_.png", "x_"],
            [`${"a".repeat(40)}.png`, "a".repeat(32)],
        ])("should turn %s into %s", (fileName, shortcode) => {
            expect(shortcodeFromFileName(fileName, new Set())).toBe(shortcode);
            expect(shortcode).toMatch(NEW_SHORTCODE_PATTERN);
        });

        it("should add a number until the shortcode is free", () => {
            expect(shortcodeFromFileName("cat.png", new Set(["cat"]))).toBe("cat_2");
            expect(shortcodeFromFileName("cat.png", new Set(["cat", "cat_2", "cat_3"]))).toBe("cat_4");
            const long = "b".repeat(32);
            const result = shortcodeFromFileName(`${long}.gif`, new Set([long]));
            expect(result).toBe(`${"b".repeat(30)}_2`);
            expect(result).toMatch(NEW_SHORTCODE_PATTERN);
        });
    });

    describe("pack editing", () => {
        const image = { url: mxc("new"), info: { w: 32, h: 32, mimetype: "image/png", size: 100 } };
        let content: ImagePackContent & Record<string, unknown>;
        let original: unknown;

        beforeEach(() => {
            content = {
                "images": { old: { url: mxc("old"), usage: ["emoticon"] }, other: { url: mxc("other") } },
                "pack": { "display_name": "Pack", "org.example.extra": true } as ImagePackContent["pack"],
                "org.example.unknown": { nested: 1 },
            };
            original = structuredClone(content);
        });

        it("withImage should add an image to fresh objects and keep unknown fields", () => {
            const result = withImage(content, "new", image);
            expect(result).toEqual({
                "images": { ...(original as ImagePackContent).images, new: image },
                "pack": { "display_name": "Pack", "org.example.extra": true },
                "org.example.unknown": { nested: 1 },
            });
            expect(content).toEqual(original);
            expect(result.images).not.toBe(content.images);
            expect(result.pack).not.toBe(content.pack);
        });

        it("withImage should replace an existing image and start missing or malformed content", () => {
            expect(withImage(content, "old", image).images?.old).toBe(image);
            expect(withImage(undefined, "new", image)).toEqual({ images: { new: image } });
            expect(withImage({ images: "x" } as unknown as ImagePackContent, "new", image)).toEqual({
                images: { new: image },
            });
        });

        it("withImage should store a __proto__ shortcode as a plain key", () => {
            const result = withImage(undefined, "__proto__", image);
            expect(Object.hasOwn(result.images!, "__proto__")).toBe(true);
            expect(Object.getPrototypeOf(result.images)).toBe(Object.prototype);
        });

        it("withoutImage should remove only that image", () => {
            const result = withoutImage(content, "old");
            expect(result).toEqual({ ...(original as ImagePackContent), images: { other: { url: mxc("other") } } });
            expect(content).toEqual(original);
            expect(withoutImage(content, "missing").images).toEqual(content.images);
            expect(withoutImage(undefined, "missing")).toEqual({ images: {} });
        });

        it("withRenamedImage should move the same image object to the new shortcode", () => {
            const result = withRenamedImage(content, "old", "renamed");
            expect(Object.keys(result.images!)).toEqual(["renamed", "other"]);
            expect(result.images?.renamed).toBe(content.images?.old);
            expect(result).toMatchObject({ "org.example.unknown": { nested: 1 }, "pack": content.pack });
            expect(content).toEqual(original);
        });

        it("withRenamedImage should refuse taken or missing shortcodes", () => {
            expect(() => withRenamedImage(content, "old", "other")).toThrow(Error);
            expect(() => withRenamedImage(content, "missing", "new")).toThrow(Error);
            expect(() => withRenamedImage(undefined, "missing", "new")).toThrow(Error);
            expect(content).toEqual(original);
        });

        it("withRenamedImage should not treat inherited object properties as taken", () => {
            expect(Object.keys(withRenamedImage(content, "old", "constructor").images!)).toContain("constructor");
            expect(() => withRenamedImage(content, "toString", "x")).toThrow(Error);
        });

        it("withRenamedImage should return an unchanged copy when the name is the same", () => {
            const result = withRenamedImage(content, "old", "old");
            expect(result).toEqual(original);
            expect(result.images).not.toBe(content.images);
        });
    });

    describe("emoticonHtml", () => {
        it("should build an inline emoticon image", () => {
            expect(emoticonHtml(mxc("a"), "wave")).toBe(
                `<img data-mx-emoticon src="${mxc("a")}" alt=":wave:" title=":wave:" height="32" />`,
            );
        });

        it("should escape attribute values", () => {
            const html = emoticonHtml('mxc://x/a" onerror="alert(1)', `a"<b>'&`);
            expect(html).not.toContain('" onerror');
            expect(html).not.toContain("<b>");
            const doc = new DOMParser().parseFromString(html, "text/html");
            const images = doc.body.querySelectorAll("img");
            expect(images).toHaveLength(1);
            expect(images[0].getAttribute("src")).toBe('mxc://x/a" onerror="alert(1)');
            expect(images[0].getAttribute("alt")).toBe(`:a"<b>'&:`);
            expect(images[0].hasAttribute("onerror")).toBe(false);
            expect(doc.body.children).toHaveLength(1);
        });
    });

    describe("replaceEmoticonsWithText", () => {
        it("should replace emoticons with their text and leave other images alone", () => {
            expect(
                replaceEmoticonsWithText(
                    `Hi ${emoticonHtml(mxc("a"), "wave")} there <img src="${mxc("p")}" alt="photo">`,
                ),
            ).toBe(`Hi :wave: there <img src="${mxc("p")}" alt="photo">`);
        });

        it("should fall back to the title, then to nothing, and escape the text", () => {
            expect(
                replaceEmoticonsWithText(
                    `<img data-mx-emoticon title=":t:"><b>x</b><img data-mx-emoticon><img data-mx-emoticon alt="<i>">`,
                ),
            ).toBe(":t:<b>x</b>&lt;i&gt;");
        });

        it("should return HTML without emoticons as it is", () => {
            const html = "<p>unparsed &nbsp; <b>markup";
            expect(replaceEmoticonsWithText(html)).toBe(html);
        });
    });
});
