/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ClientEvent,
    EventType,
    MatrixError,
    MatrixEvent,
    Room,
    RoomStateEvent,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { EmojiPackSettingsViewModel } from "./EmojiPackSettingsViewModel";
import {
    MAX_EMOJI_FILE_SIZE,
    ROOM_EMOTES_EVENT,
    USER_EMOTES_EVENT,
    type ImagePackContent,
} from "../../utils/matcha/imagePacks";

describe("EmojiPackSettingsViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let vm: EmojiPackSettingsViewModel;
    let me: string;

    /** Apply a state event to the room; the room state emits it, re-emitted by the client as sync does. */
    const setState = (type: string, content: object, eventId: string, stateKey = ""): void => {
        const event = new MatrixEvent({
            type,
            state_key: stateKey,
            room_id: room.roomId,
            event_id: eventId,
            sender: "@owner:server",
            content,
        });
        room.currentState.setStateEvents([event]);
    };
    const image = (name: string, type = "image/png", size = 10): File =>
        new File([new Uint8Array(size)], name, { type });
    const idle = (): Promise<void> => vi.waitFor(() => expect(vm.getSnapshot().busy).toBe(false));
    const written = (call = 0): ImagePackContent =>
        vi.mocked(client.sendStateEvent).mock.calls[call][2] as unknown as ImagePackContent;

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        me = client.getSafeUserId();
        room = new Room("!crew:server", client, me);
        room.currentState.on(RoomStateEvent.Events, (...args) => client.emit(RoomStateEvent.Events, ...args));
        room.currentState.on(RoomStateEvent.Update, (...args) => client.emit(RoomStateEvent.Update, ...args));
        // Members only get power levels from a power levels event once the room has a create event.
        setState(EventType.RoomCreate, { room_version: "10" }, "$create");
        setState(EventType.RoomMember, { membership: KnownMembership.Join }, "$join", me);
        setState(EventType.RoomPowerLevels, { users: { [me]: 100 }, state_default: 50 }, "$pl");
        setState(
            ROOM_EMOTES_EVENT,
            {
                images: {
                    wave: { url: "mxc://server/wave" },
                    hidden: { url: "mxc://server/hidden", usage: ["sticker"] },
                    broken: { url: "https://example.org/broken.png" },
                },
                pack: { display_name: "Crew", custom: 1 },
                other_client_field: true,
            },
            "$pack",
        );
        vi.mocked(client.uploadContent).mockImplementation(async (file) => ({
            content_uri: `mxc://server/${(file as File).name.replace(/\W/g, "")}`,
        }));
        vi.mocked(client.sendStateEvent).mockResolvedValue({ event_id: "$sent" });
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 64, height: 32, close: vi.fn() }));
        vm = new EmojiPackSettingsViewModel({ client, target: { kind: "room", room } });
    });

    afterEach(() => {
        vm.dispose();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("shows the pack's valid emoji with http URLs", () => {
        expect(vm.getSnapshot()).toEqual({
            emojis: [{ shortcode: "wave", src: "http://this.is.a.url/server/wave" }],
            canEdit: true,
            busy: false,
        });
    });

    it("follows power levels, membership and pack changes", () => {
        // Room state emits Events before it updates members' power levels, so these need the later Update.
        setState(EventType.RoomPowerLevels, { users: { [me]: 0 }, state_default: 50 }, "$pl2");
        expect(vm.getSnapshot().canEdit).toBe(false);

        setState(EventType.RoomPowerLevels, { users: { [me]: 50 }, state_default: 50 }, "$pl3");
        expect(vm.getSnapshot().canEdit).toBe(true);

        setState(EventType.RoomPowerLevels, { users: { [me]: 0 }, events: { [ROOM_EMOTES_EVENT]: 0 } }, "$pl4");
        expect(vm.getSnapshot().canEdit).toBe(true);

        setState(ROOM_EMOTES_EVENT, { images: { cat: { url: "mxc://server/cat" } } }, "$pack2");
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["cat"]);

        // The room only recalculates getMyMembership() after applying the state, so it is not consulted.
        setState(EventType.RoomMember, { membership: KnownMembership.Leave }, "$leave", me);
        expect(vm.getSnapshot().canEdit).toBe(false);
    });

    it("rejects unsupported, oversized and unreadable files with a message naming the file", async () => {
        vm.upload([image("notes.txt", "text/plain")]);
        await idle();
        expect(vm.getSnapshot().error).toContain("notes.txt");

        vm.upload([image("huge.png", "image/png", MAX_EMOJI_FILE_SIZE + 1)]);
        await idle();
        expect(vm.getSnapshot().error).toContain("huge.png");
        expect(vm.getSnapshot().error).toContain("512 KB");

        // Neither decoder can read it: createImageBitmap fails and the image element reports no size.
        vi.mocked(createImageBitmap).mockRejectedValue(new Error("not an image"));
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        vm.upload([image("fake.png")]);
        await idle();
        expect(vm.getSnapshot().error).toContain("fake.png");
        expect(revoke).toHaveBeenCalled();

        expect(client.uploadContent).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        vm.dismissError();
        expect(vm.getSnapshot().error).toBeUndefined();
    });

    it("uploads valid files and writes one state event with info and unique shortcodes", async () => {
        const gif = image("wave.gif", "image/gif", 300);
        const again = image("wave.gif", "image/gif", 400);
        const hidden = image("hidden!.webp", "image/webp");
        vm.upload([gif, image("notes.txt", "text/plain"), again, hidden]);
        expect(vm.getSnapshot().busy).toBe(true);
        await idle();

        expect(client.uploadContent).toHaveBeenCalledTimes(3);
        // The file name would be public, since pack images are not encrypted.
        expect(client.uploadContent).toHaveBeenCalledWith(gif, { type: "image/gif", includeFilename: false });
        expect(client.sendStateEvent).toHaveBeenCalledTimes(1);
        expect(client.sendStateEvent).toHaveBeenCalledWith(room.roomId, ROOM_EMOTES_EVENT, expect.anything(), "");
        const content = written();
        expect(content).toMatchObject({ pack: { display_name: "Crew", custom: 1 }, other_client_field: true });
        // Other clients' images are kept, including ones not shown here; new names never replace them.
        expect(Object.keys(content.images!).sort()).toEqual([
            "broken",
            "hidden",
            "hidden_2",
            "wave",
            "wave_2",
            "wave_3",
        ]);
        expect(content.images!.wave_2).toEqual({
            url: "mxc://server/wavegif",
            info: { w: 64, h: 32, mimetype: "image/gif", size: 300 },
        });
        expect(content.images!.wave_3.info?.size).toBe(400);
        expect(content.images!.hidden_2.info?.mimetype).toBe("image/webp");

        // The rejected file is reported, and the new emoji show before the state echo arrives.
        expect(vm.getSnapshot().error).toContain("notes.txt");
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual([
            "hidden_2",
            "wave",
            "wave_2",
            "wave_3",
        ]);
    });

    it("rejects images larger than 1024 pixels on a side", async () => {
        vi.mocked(createImageBitmap).mockResolvedValue({ width: 1025, height: 64, close: vi.fn() } as never);
        vm.upload([image("photo.png")]);
        await idle();
        expect(vm.getSnapshot().error).toBe("photo.png is larger than 1024 × 1024 pixels.");
        expect(client.uploadContent).not.toHaveBeenCalled();
    });

    it("redraws JPEGs to drop their metadata before uploading", async () => {
        const redrawn = new Blob([new Uint8Array(7)], { type: "image/jpeg" });
        const drawImage = vi.fn();
        vi.stubGlobal(
            "OffscreenCanvas",
            class {
                public constructor(
                    public width: number,
                    public height: number,
                ) {}
                public getContext = (): object => ({ drawImage });
                public convertToBlob = vi.fn().mockResolvedValue(redrawn);
            },
        );
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/photo" });
        vm.upload([image("photo.jpg", "image/jpeg", 300)]);
        await idle();

        expect(drawImage).toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(redrawn, { type: "image/jpeg", includeFilename: false });
        expect(written().images!.photo.info).toEqual({ w: 64, h: 32, mimetype: "image/jpeg", size: 7 });
    });

    it("marks new emoji as emoticons in a pack another client made for stickers", async () => {
        setState(
            ROOM_EMOTES_EVENT,
            { images: { sticker: { url: "mxc://server/sticker" } }, pack: { usage: ["sticker"] } },
            "$stickers",
        );
        expect(vm.getSnapshot().emojis).toEqual([]);

        vm.upload([image("cat.png")]);
        await idle();
        expect(written().images!.cat.usage).toEqual(["emoticon"]);
        expect(written().images!.sticker).toEqual({ url: "mxc://server/sticker" });
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["cat"]);
    });

    it("refuses to upload into a full pack, and explains when the server says the pack is too large", async () => {
        setState(
            ROOM_EMOTES_EVENT,
            { images: { big: { url: "mxc://server/big", body: "x".repeat(59_800) } } },
            "$full",
        );
        vm.upload([image("cat.png")]);
        await idle();
        expect(vm.getSnapshot().error).toBe("This pack is full. Remove some emoji before adding more.");
        expect(client.uploadContent).not.toHaveBeenCalled();

        vi.mocked(client.sendStateEvent).mockRejectedValue(new MatrixError({ errcode: "M_TOO_LARGE" }, 413));
        vm.rename("big", "bigger");
        await idle();
        expect(vm.getSnapshot().error).toBe("This pack is full. Remove some emoji before adding more.");
    });

    it("finishes an upload started before the settings closed", async () => {
        let finishUpload!: (value: { content_uri: string }) => void;
        vi.mocked(client.uploadContent).mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
        vm.upload([image("cat.png")]);
        await vi.waitFor(() => expect(client.uploadContent).toHaveBeenCalled());

        vm.dispose();
        finishUpload({ content_uri: "mxc://server/cat" });
        await vi.waitFor(() => expect(client.sendStateEvent).toHaveBeenCalled());
        expect(written().images!.cat).toMatchObject({ url: "mxc://server/cat" });
    });

    it("still adds the files that uploaded when another upload fails", async () => {
        vi.mocked(client.uploadContent).mockImplementation(async (file) => {
            if ((file as File).name === "bad.png") throw new Error("offline");
            return { content_uri: "mxc://server/good" };
        });
        vm.upload([image("bad.png"), image("good.png")]);
        await idle();

        expect(Object.keys(written().images!)).toContain("good");
        expect(Object.keys(written().images!)).not.toContain("bad");
        expect(vm.getSnapshot().error).toContain("bad.png");
    });

    it("builds each change on the previous write until the state echo arrives", async () => {
        vm.upload([image("cat.png")]);
        vm.remove("wave");
        await idle();

        expect(client.sendStateEvent).toHaveBeenCalledTimes(2);
        expect(Object.keys(written(1).images!).sort()).toEqual(["broken", "cat", "hidden"]);
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["cat"]);

        // Once room state moves on, it is the source of truth again.
        setState(ROOM_EMOTES_EVENT, { images: { dog: { url: "mxc://server/dog" } } }, "$other");
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["dog"]);
    });

    it("keeps building on its own writes when an earlier write's echo lands during a later one", async () => {
        setState(ROOM_EMOTES_EVENT, { images: { a: { url: "mxc://server/a" }, b: { url: "mxc://server/b" } } }, "$e0");
        const shortcodes = (content: ImagePackContent): string[] => Object.keys(content.images!).sort();

        vi.mocked(client.sendStateEvent).mockResolvedValueOnce({ event_id: "$e1" });
        vm.remove("a");
        await idle();

        let finishSecond!: (value: { event_id: string }) => void;
        vi.mocked(client.sendStateEvent).mockReturnValueOnce(new Promise((resolve) => (finishSecond = resolve)));
        vm.upload([image("cat.png")]);
        await vi.waitFor(() => expect(client.sendStateEvent).toHaveBeenCalledTimes(2));
        // The first write's echo arrives while the second is being sent.
        setState(ROOM_EMOTES_EVENT, written(0), "$e1");
        finishSecond({ event_id: "$e2" });
        await idle();
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["b", "cat"]);

        vi.mocked(client.sendStateEvent).mockResolvedValueOnce({ event_id: "$e3" });
        vm.remove("b");
        await idle();
        expect(shortcodes(written(2))).toEqual(["cat"]);

        // An echo older than the write before ours still shows our latest content.
        vi.mocked(client.sendStateEvent).mockResolvedValueOnce({ event_id: "$e4" });
        vm.rename("cat", "kitty");
        await idle();
        setState(ROOM_EMOTES_EVENT, written(1), "$e2");
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["kitty"]);

        // Once room state moves past our writes, it is the source of truth again.
        setState(ROOM_EMOTES_EVENT, { images: { dog: { url: "mxc://server/dog" } } }, "$other");
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["dog"]);
    });

    it("ignores renaming an emoji someone else just removed", async () => {
        setState(ROOM_EMOTES_EVENT, { images: {} }, "$emptied");
        vm.rename("wave", "hello");
        await idle();
        expect(vm.getSnapshot().error).toBeUndefined();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });

    it("validates new names and keeps the image object when renaming", async () => {
        vm.rename("wave", "a");
        await idle();
        expect(vm.getSnapshot().error).toBe("Emoji names must be 2 to 32 letters, numbers, hyphens or underscores.");

        vm.rename("wave", "hidden");
        await idle();
        expect(vm.getSnapshot().error).toBe("An emoji named :hidden: already exists in this pack.");
        expect(client.sendStateEvent).not.toHaveBeenCalled();

        vm.rename("wave", "hello-there");
        await idle();
        expect(vm.getSnapshot().error).toBeUndefined();
        expect(written().images).toEqual({
            "hello-there": { url: "mxc://server/wave" },
            "hidden": { url: "mxc://server/hidden", usage: ["sticker"] },
            "broken": { url: "https://example.org/broken.png" },
        });
    });

    it("removes an emoji", async () => {
        vm.remove("wave");
        await idle();
        expect(written().images).not.toHaveProperty("wave");
        expect(written().images).toHaveProperty("hidden");
    });

    it("shows an error when saving fails", async () => {
        vi.mocked(client.sendStateEvent).mockRejectedValue(new Error("forbidden"));
        vm.remove("wave");
        await idle();
        expect(vm.getSnapshot().error).toBe(
            "The emoji could not be saved. Check your connection and permissions, then try again.",
        );
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["wave"]);
    });

    it("manages the personal pack through account data", async () => {
        vm.dispose();
        let userPack = new MatrixEvent({
            type: USER_EMOTES_EVENT,
            content: { images: { smile: { url: "mxc://server/smile" } } },
        });
        vi.mocked(client.getAccountData).mockImplementation((type) =>
            type === USER_EMOTES_EVENT ? userPack : undefined,
        );
        vi.mocked(client.setAccountData).mockResolvedValue({});
        vm = new EmojiPackSettingsViewModel({ client, target: { kind: "user" } });
        expect(vm.getSnapshot()).toMatchObject({ canEdit: true, emojis: [{ shortcode: "smile" }] });

        vm.upload([image("smile.png")]);
        await idle();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
        expect(client.setAccountData).toHaveBeenCalledWith(USER_EMOTES_EVENT, {
            images: {
                smile: { url: "mxc://server/smile" },
                smile_2: { url: "mxc://server/smilepng", info: { w: 64, h: 32, mimetype: "image/png", size: 10 } },
            },
        });

        userPack = new MatrixEvent({
            type: USER_EMOTES_EVENT,
            content: { images: { wink: { url: "mxc://server/w" } } },
        });
        client.emit(ClientEvent.AccountData, userPack);
        expect(vm.getSnapshot().emojis.map((emoji) => emoji.shortcode)).toEqual(["wink"]);
    });
});
