/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { escape } from "lodash";
import { EventType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

/** MSC2545 room or Space image pack; the empty state key is the pack Matcha manages. */
export const ROOM_EMOTES_EVENT = "im.ponies.room_emotes";
/** MSC2545 personal image pack, stored in account data. */
export const USER_EMOTES_EVENT = "im.ponies.user_emotes";
/** MSC2545 account data listing room packs the user enabled everywhere. */
export const EMOTE_ROOMS_EVENT = "im.ponies.emote_rooms";
/** Attribute marking an inline custom emoji image in a formatted body. */
export const EMOTICON_ATTRIBUTE = "data-mx-emoticon";

/** Shortcodes Matcha writes; other clients may have stored any shortcode without spaces or colons. */
export const NEW_SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;
/** Largest emoji image Matcha uploads, in bytes. */
export const MAX_EMOJI_FILE_SIZE = 512 * 1024;
/** Image types Matcha uploads as emoji. */
export const ACCEPTED_EMOJI_TYPES: readonly string[] = ["image/png", "image/gif", "image/webp", "image/jpeg"];

// No spaces or colons, nor control or format characters such as bidi overrides, which would garble the body.
const SHORTCODE_PATTERN = /^[^\s:\p{Cc}\p{Cf}]+$/u;
// MSC4027 caps a reaction's shortcode at 100 bytes, colons included.
const MAX_SHORTCODE_BYTES = 98;
// How far up nested Spaces to look for packs.
const MAX_SPACE_DEPTH = 5;
// Server name and media ID grammar from the spec; this also keeps quotes and markup out of HTML attributes.
const MXC_PATTERN = /^mxc:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9_-]+$/;
const MAX_TEXT_LENGTH = 1000;

/** What an image or a whole pack may be used for. */
export type ImagePackUsage = "emoticon" | "sticker";

/** One image of an MSC2545 pack, as stored. */
export interface ImagePackImage {
    url: string;
    body?: string;
    info?: { w?: number; h?: number; mimetype?: string; size?: number };
    /** Overrides the pack's usage when present and not empty. */
    usage?: ImagePackUsage[];
}

/** An MSC2545 pack, as stored in room state or account data. */
export interface ImagePackContent {
    images?: Record<string, ImagePackImage>;
    pack?: { display_name?: string; avatar_url?: string; usage?: ImagePackUsage[]; attribution?: string };
}

/** Packs enabled everywhere: room ID to the state keys of that room's packs. */
export interface EmoteRoomsContent {
    rooms?: Record<string, Record<string, object>>;
}

/** A validated custom emoji. */
export interface CustomEmoji {
    /** Without colons. */
    shortcode: string;
    /** The mxc URL of the image. */
    url: string;
    body?: string;
}

/** A validated sticker; `info` is what an m.sticker event carries. */
export interface CustomSticker extends CustomEmoji {
    info?: ImagePackImage["info"];
}

/** Where a pack comes from and what to call it. */
interface PackDetails {
    /** "user" for the personal pack, otherwise `${roomId}|${stateKey}`. */
    id: string;
    kind: "user" | "room";
    roomId?: string;
    stateKey?: string;
    name: string;
    /** The mxc URL of the pack avatar. */
    avatarUrl?: string;
}

/** Custom emoji from one pack, ready to offer in a room. */
export interface EmojiPack extends PackDetails {
    emojis: CustomEmoji[];
}

/** Stickers from one pack, ready to offer in a room. */
export interface StickerPack extends PackDetails {
    stickers: CustomSticker[];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMxc(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_TEXT_LENGTH && MXC_PATTERN.test(value);
}

function isValidShortcode(shortcode: string): boolean {
    return SHORTCODE_PATTERN.test(shortcode) && new TextEncoder().encode(shortcode).length <= MAX_SHORTCODE_BYTES;
}

function usages(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/**
 * What an image is for: its own usage when not empty, else the pack's. Empty means every usage, as MSC2545 says.
 * Malformed usage values count as empty.
 */
export function effectiveUsage(content: unknown, image: unknown): unknown[] {
    const imageUsage = usages(isObject(image) ? image.usage : undefined);
    if (imageUsage.length) return imageUsage;
    return usages(isObject(content) && isObject(content.pack) ? content.pack.usage : undefined);
}

function isCount(value: unknown, min: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/** The image info fields that are well formed, or nothing. */
function imageInfo(value: unknown): ImagePackImage["info"] | undefined {
    if (!isObject(value)) return undefined;
    const info: NonNullable<ImagePackImage["info"]> = {
        ...(isCount(value.w, 1) ? { w: value.w } : {}),
        ...(isCount(value.h, 1) ? { h: value.h } : {}),
        ...(typeof value.mimetype === "string" && /^image\/[\w.+-]{1,100}$/.test(value.mimetype)
            ? { mimetype: value.mimetype }
            : {}),
        ...(isCount(value.size, 0) ? { size: value.size } : {}),
    };
    return Object.keys(info).length ? info : undefined;
}

/** Validated images of a pack usable for `usage`, sorted by shortcode; malformed images are skipped. */
function parseImages(content: unknown, usage: ImagePackUsage): CustomSticker[] {
    if (!isObject(content) || !isObject(content.images)) return [];
    const images: CustomSticker[] = [];
    for (const [shortcode, image] of Object.entries(content.images)) {
        if (!isValidShortcode(shortcode) || !isObject(image) || !isMxc(image.url)) continue;
        const body = typeof image.body === "string" ? image.body : undefined;
        if (body && body.length > MAX_TEXT_LENGTH) continue;
        const imageUsage = effectiveUsage(content, image);
        if (imageUsage.length && !imageUsage.includes(usage)) continue;
        const info = imageInfo(image.info);
        images.push({ shortcode, url: image.url, ...(body ? { body } : {}), ...(info ? { info } : {}) });
    }
    return images.sort((a, b) => a.shortcode.localeCompare(b.shortcode));
}

/** Validated emoji of a pack, sorted by shortcode; malformed images are skipped so other clients' data cannot break us. */
export function parseEmojiImages(content: unknown): CustomEmoji[] {
    return parseImages(content, "emoticon").map(({ info, ...emoji }) => emoji);
}

/** Validated stickers of a pack, sorted by shortcode, with their well-formed image info. */
export function parseStickerImages(content: unknown): CustomSticker[] {
    return parseImages(content, "sticker");
}

/** The pack's own display name and avatar, when valid. */
function packDetails(content: unknown): { name?: string; avatarUrl?: string } {
    const pack = isObject(content) && isObject(content.pack) ? content.pack : {};
    const name = typeof pack.display_name === "string" ? pack.display_name.trim() : "";
    return {
        ...(name && name.length <= MAX_TEXT_LENGTH ? { name } : {}),
        ...(isMxc(pack.avatar_url) ? { avatarUrl: pack.avatar_url } : {}),
    };
}

/** The pack's own display name, when it has a valid one. */
export function packDisplayName(content: unknown): string | undefined {
    return packDetails(content).name;
}

/** Pack content with this display name, keeping every other field; the input is not changed. */
export function withPackName(content: ImagePackContent | undefined, name: string): ImagePackContent {
    const base = isObject(content) ? content : {};
    return { ...base, pack: { ...(isObject(base.pack) ? base.pack : {}), display_name: name } };
}

/** The packs a room has in im.ponies.emote_rooms, or none. */
function enabledPacksOf(content: unknown, roomId: string): Record<string, unknown> {
    const rooms = isObject(content) && isObject(content.rooms) ? content.rooms : {};
    const packs = Object.hasOwn(rooms, roomId) ? rooms[roomId] : undefined;
    return isObject(packs) ? packs : {};
}

/** Whether im.ponies.emote_rooms enables this room pack everywhere. */
export function isUsedEverywhere(content: unknown, roomId: string, stateKey: string): boolean {
    const packs = enabledPacksOf(content, roomId);
    return Object.hasOwn(packs, stateKey) && isObject(packs[stateKey]);
}

/**
 * im.ponies.emote_rooms content with this room pack enabled or not, keeping every other entry and field; the input is
 * not changed. Rooms left without packs are dropped.
 */
export function withUsedEverywhere(
    content: EmoteRoomsContent | undefined,
    roomId: string,
    stateKey: string,
    used: boolean,
): EmoteRoomsContent {
    const base = isObject(content) ? content : {};
    const packs = enabledPacksOf(base, roomId);
    // fromEntries makes own properties even for keys such as "__proto__".
    const others = Object.entries(packs).filter(([key]) => key !== stateKey);
    const kept = Object.hasOwn(packs, stateKey) && isObject(packs[stateKey]) ? packs[stateKey] : {};
    const roomPacks = Object.fromEntries(used ? [...others, [stateKey, kept]] : others);
    const rooms = Object.entries(isObject(base.rooms) ? base.rooms : {}).filter(([id]) => id !== roomId);
    if (Object.keys(roomPacks).length) rooms.push([roomId, roomPacks]);
    return { ...base, rooms: Object.fromEntries(rooms) as EmoteRoomsContent["rooms"] };
}

/**
 * The Spaces whose packs apply in a room, nearest first: those the room names in its own m.space.parent state, then
 * theirs. A Space cannot add its packs to a room just by listing it as a child.
 */
export function getParentSpaceIds(client: MatrixClient, roomId: string): string[] {
    const found = new Set([roomId]);
    let level = [roomId];
    for (let depth = 0; depth < MAX_SPACE_DEPTH && level.length; depth++) {
        const next: string[] = [];
        for (const id of level) {
            for (const event of client.getRoom(id)?.currentState.getStateEvents(EventType.SpaceParent) ?? []) {
                const parentId = event.getStateKey();
                if (!parentId || found.has(parentId) || !Array.isArray(event.getContent().via)) continue;
                found.add(parentId);
                next.push(parentId);
            }
        }
        level = next;
    }
    found.delete(roomId);
    return [...found];
}

/**
 * Custom emoji packs usable in a room, in picker order: the personal pack, packs the user enabled everywhere (so they
 * keep their place from room to room, as MSC2545 asks), the room's own packs, then packs of the given parent Spaces.
 * Only joined parent and enabled rooms count, each pack appears once, and packs without emoji are left out.
 */
export function getEmojiPacks(
    client: MatrixClient,
    room: Room | undefined,
    parentSpaceIds: Iterable<string>,
    userPackName: string,
): EmojiPack[] {
    return getPacks(client, room, parentSpaceIds, userPackName, parseEmojiImages).map(({ images, ...pack }) => ({
        ...pack,
        emojis: images,
    }));
}

/** Sticker packs usable in a room, in the same order and with the same rules as {@link getEmojiPacks}. */
export function getStickerPacks(
    client: MatrixClient,
    room: Room | undefined,
    parentSpaceIds: Iterable<string>,
    userPackName: string,
): StickerPack[] {
    return getPacks(client, room, parentSpaceIds, userPackName, parseStickerImages).map(({ images, ...pack }) => ({
        ...pack,
        stickers: images,
    }));
}

function getPacks<T>(
    client: MatrixClient,
    room: Room | undefined,
    parentSpaceIds: Iterable<string>,
    userPackName: string,
    parse: (content: unknown) => T[],
): (PackDetails & { images: T[] })[] {
    const packs: (PackDetails & { images: T[] })[] = [];
    const userContent = client.getAccountData(USER_EMOTES_EVENT)?.getContent();
    const userImages = parse(userContent);
    if (userImages.length) {
        packs.push({ id: "user", kind: "user", ...packDetails(userContent), name: userPackName, images: userImages });
    }

    const seen = new Set<string>();
    const addPack = (packRoom: Room, event: MatrixEvent | null): void => {
        if (!event) return;
        const stateKey = event.getStateKey() ?? "";
        const id = `${packRoom.roomId}|${stateKey}`;
        if (seen.has(id)) return;
        seen.add(id);
        const content = event.getContent();
        const images = parse(content);
        if (!images.length) return;
        const { name, avatarUrl } = packDetails(content);
        packs.push({
            id,
            kind: "room",
            roomId: packRoom.roomId,
            stateKey,
            name: name ?? packRoom.name,
            ...(avatarUrl ? { avatarUrl } : {}),
            images,
        });
    };
    // The managed pack (empty state key) sorts first; other clients' packs follow in a stable order.
    const addRoomPacks = (packRoom: Room | undefined): void => {
        if (!packRoom) return;
        const events = [...packRoom.currentState.getStateEvents(ROOM_EMOTES_EVENT)];
        events.sort((a, b) => (a.getStateKey() ?? "").localeCompare(b.getStateKey() ?? ""));
        for (const event of events) addPack(packRoom, event);
    };
    const joinedRoom = (roomId: string): Room | undefined => {
        const candidate = client.getRoom(roomId);
        return candidate?.getMyMembership() === KnownMembership.Join ? candidate : undefined;
    };

    const enabled: unknown = client.getAccountData(EMOTE_ROOMS_EVENT)?.getContent().rooms;
    if (isObject(enabled)) {
        for (const [roomId, stateKeys] of Object.entries(enabled)) {
            const packRoom = joinedRoom(roomId);
            if (!packRoom || !isObject(stateKeys)) continue;
            for (const stateKey of Object.keys(stateKeys)) {
                addPack(packRoom, packRoom.currentState.getStateEvents(ROOM_EMOTES_EVENT, stateKey));
            }
        }
    }
    addRoomPacks(room);
    for (const spaceId of parentSpaceIds) addRoomPacks(joinedRoom(spaceId));
    return packs;
}

/** Every state key a room uses for packs, deleted ones included. */
export function allRoomPackStateKeys(room: Room): Set<string> {
    return new Set(room.currentState.getStateEvents(ROOM_EMOTES_EVENT).map((event) => event.getStateKey() ?? ""));
}

/**
 * The room's packs to manage, by state key: the default pack ("") first, whether it exists yet or not, then every other
 * pack in a stable order. Content {} marks a deleted pack, which is left out.
 */
export function roomPackStateKeys(room: Room): string[] {
    const named = room.currentState
        .getStateEvents(ROOM_EMOTES_EVENT)
        .filter((event) => {
            const content: unknown = event.getContent();
            return !!event.getStateKey() && isObject(content) && Object.keys(content).length > 0;
        })
        .map((event) => event.getStateKey()!)
        .sort((a, b) => a.localeCompare(b));
    return ["", ...named];
}

/** A state key for a new pack, from its name, unique among `taken`. */
export function packStateKeyFromName(name: string, taken: ReadonlySet<string>): string {
    const base =
        name
            .normalize("NFKD")
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 32) || "pack";
    let stateKey = base;
    for (let n = 2; taken.has(stateKey); n++) stateKey = `${base}-${n}`;
    return stateKey;
}

/** The first emoji with this shortcode (without colons), searching packs in order. */
export function findEmojiByShortcode(packs: EmojiPack[], shortcode: string): CustomEmoji | undefined {
    return packs.flatMap((pack) => pack.emojis).find((emoji) => emoji.shortcode === shortcode);
}

/** A new shortcode from an uploaded file's name, unique among `taken`. */
export function shortcodeFromFileName(fileName: string, taken: ReadonlySet<string>): string {
    const cleaned = fileName
        .replace(/\.[^.]*$/, "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const base = (cleaned || "emoji").slice(0, 32).padEnd(2, "_");
    let shortcode = base;
    for (let n = 2; taken.has(shortcode); n++) {
        const suffix = `_${n}`;
        shortcode = base.slice(0, 32 - suffix.length) + suffix;
    }
    return shortcode;
}

/** A copy of the stored images, or none when other data is stored there. */
function copyImages(content: ImagePackContent | undefined): Record<string, ImagePackImage> {
    const images: unknown = isObject(content) ? content.images : undefined;
    // Other clients' images are kept exactly as stored, even ones we would not display.
    return isObject(images) ? ({ ...images } as Record<string, ImagePackImage>) : {};
}

/** Fresh content with these images, keeping every other field of the content and of its pack. */
function withImages(content: ImagePackContent | undefined, images: Record<string, ImagePackImage>): ImagePackContent {
    const base = isObject(content) ? content : {};
    return { ...base, ...(isObject(base.pack) ? { pack: { ...base.pack } } : {}), images };
}

/** Pack content with the image added or replaced; the input is not changed. */
export function withImage(
    content: ImagePackContent | undefined,
    shortcode: string,
    image: ImagePackImage,
): ImagePackContent {
    return withImages(content, { ...copyImages(content), [shortcode]: image });
}

/** Pack content without the image; the input is not changed. */
export function withoutImage(content: ImagePackContent | undefined, shortcode: string): ImagePackContent {
    return withImages(
        content,
        Object.fromEntries(Object.entries(copyImages(content)).filter(([code]) => code !== shortcode)),
    );
}

/**
 * Pack content with an image moved to a new shortcode, keeping the image object; the input is not changed.
 * Renaming an image to its current shortcode returns an unchanged copy.
 * @throws Error if `from` does not exist or `to` is already used by another image.
 */
export function withRenamedImage(content: ImagePackContent | undefined, from: string, to: string): ImagePackContent {
    const images = copyImages(content);
    if (!Object.hasOwn(images, from)) throw new Error(`No image :${from}:`);
    if (from === to) return withImages(content, images);
    if (Object.hasOwn(images, to)) throw new Error(`An image named :${to}: already exists`);
    return withImages(
        content,
        Object.fromEntries(Object.entries(images).map(([code, image]) => [code === from ? to : code, image])),
    );
}

/** The formatted-body markup for an inline custom emoji. */
export function emoticonHtml(url: string, shortcode: string): string {
    const text = escape(`:${shortcode}:`);
    return `<img ${EMOTICON_ATTRIBUTE} src="${escape(url)}" alt="${text}" title="${text}" height="32" />`;
}

/** Replace inline custom emoji with their `:shortcode:` text, for previews and notifications. */
export function replaceEmoticonsWithText(html: string): string {
    if (!html.includes(EMOTICON_ATTRIBUTE)) return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const image of doc.body.querySelectorAll(`img[${EMOTICON_ATTRIBUTE}]`)) {
        image.replaceWith(image.getAttribute("alt") || image.getAttribute("title") || "");
    }
    return doc.body.innerHTML;
}
