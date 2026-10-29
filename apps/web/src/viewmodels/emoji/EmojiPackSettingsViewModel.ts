/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type EmojiPackImageUsage,
    type EmojiPackSettingsEmoji,
    type EmojiPackSettingsViewActions,
    type EmojiPackSettingsViewSnapshot,
} from "@element-hq/web-shared-components";
import {
    ClientEvent,
    MatrixError,
    RoomStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomState,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";
import { mediaFromMxc } from "../../customisations/Media";
import {
    ACCEPTED_EMOJI_TYPES,
    EMOTE_ROOMS_EVENT,
    MAX_EMOJI_FILE_SIZE,
    MAX_PACK_NAME_LENGTH,
    NEW_SHORTCODE_PATTERN,
    ROOM_EMOTES_EVENT,
    USER_EMOTES_EVENT,
    canEditRoomPacks,
    isUsedEverywhere,
    packDisplayName,
    parseEmojiImages,
    parseStickerImages,
    setPackUsedEverywhere,
    shortcodeFromFileName,
    withImage,
    withPackName,
    withRenamedImage,
    withoutImage,
    type CustomEmoji,
    type ImagePackContent,
    type ImagePackImage,
} from "../../utils/matcha/imagePacks";

/**
 * The pack being managed: one of a room's or Space's packs (its state key; "" is the default pack, also when left
 * out), or the user's personal pack.
 */
export type EmojiPackTarget = { kind: "room"; room: Room; stateKey?: string } | { kind: "user" };

/** Properties of {@link EmojiPackSettingsViewModel}. */
export interface EmojiPackSettingsViewModelProps {
    client: MatrixClient;
    target: EmojiPackTarget;
}

/** Widest or tallest emoji image Matcha uploads, in pixels; every viewer decodes the full image. */
const MAX_EMOJI_DIMENSION = 1024;
/** Room state events are limited to 64 KiB; this leaves room for the rest of the event. */
const MAX_PACK_BYTES = 60_000;
/** A generous size for one more image entry with its info, to refuse uploads into a full pack before uploading. */
const IMAGE_ENTRY_BYTES = 200;

function packBytes(content: ImagePackContent | undefined): number {
    return new TextEncoder().encode(JSON.stringify(content ?? {})).length;
}

/**
 * A JPEG redrawn without its metadata: EXIF can say where a photo was taken, and pack images are not encrypted.
 * ponytail: only JPEG is redrawn, since redrawing would stop an animated GIF, WebP or PNG.
 */
async function jpegWithoutMetadata(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.convertToBlob({ type: "image/jpeg" });
}

/** The pixel size of an image file, or undefined when the browser cannot decode it. */
async function imageSize(file: File): Promise<{ w: number; h: number } | undefined> {
    try {
        const bitmap = await createImageBitmap(file);
        const size = { w: bitmap.width, h: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        // Not every browser decodes every type this way; an image element is the fallback.
    }
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth && image.naturalHeight
            ? { w: image.naturalWidth, h: image.naturalHeight }
            : undefined;
    } catch {
        return undefined;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Uploads, renames and removes the custom emoji and stickers of one MSC2545 image pack, and names, deletes and
 * enables everywhere a room's pack. Images other clients stored in the pack, including ones we do not show, are kept
 * on every write.
 */
export class EmojiPackSettingsViewModel
    extends BaseViewModel<EmojiPackSettingsViewSnapshot, EmojiPackSettingsViewModelProps>
    implements EmojiPackSettingsViewActions
{
    /** Changes run one at a time, so each builds on the content the previous one wrote. */
    private queue: Promise<void> = Promise.resolve();
    private pendingChanges = 0;
    /**
     * The room pack content we last wrote, its event ID, and every pack event (or none) it supersedes: the ones our
     * writes replaced and our earlier writes. State echoes arrive after sendStateEvent resolves, so while room state
     * still shows a superseded event, our content is the latest.
     */
    private written?: { eventId: string; superseded: Set<string | undefined>; content: ImagePackContent };

    public constructor(props: EmojiPackSettingsViewModelProps) {
        super(props, { emojis: [], stickers: [], canEdit: false, busy: false });
        const { client, target } = props;
        this.disposables.trackListener(client, ClientEvent.AccountData, (event) => {
            const type = (event as MatrixEvent).getType();
            if (type === (target.kind === "user" ? USER_EMOTES_EVENT : EMOTE_ROOMS_EVENT)) this.refresh();
        });
        if (target.kind === "room") {
            this.disposables.trackListener(client, RoomStateEvent.Events, (event) => {
                const stateEvent = event as MatrixEvent;
                if (
                    stateEvent.getRoomId() === target.room.roomId &&
                    stateEvent.getType() === ROOM_EMOTES_EVENT &&
                    stateEvent.getStateKey() === this.stateKey
                ) {
                    this.refresh();
                }
            });
            // Unlike Events, Update fires once members' power levels and membership reflect the new state.
            this.disposables.trackListener(client, RoomStateEvent.Update, (state) => {
                if ((state as RoomState).roomId === target.room.roomId) {
                    const canEdit = this.canEdit();
                    this.snapshot.merge({ canEdit, canDelete: canEdit && this.stateKey !== "" });
                }
            });
        }
        this.refresh();
    }

    /** The managed pack's state key; "" for the user's pack too, which has none. */
    private get stateKey(): string {
        const { target } = this.props;
        return target.kind === "room" ? (target.stateKey ?? "") : "";
    }

    public upload = (files: File[], usage: EmojiPackImageUsage = "emoticon"): void => {
        // A started batch always finishes and writes, even if the settings close meanwhile.
        this.change(async () => {
            let error: string | undefined;
            const uploaded: { file: File; url: string; info: ImagePackImage["info"] }[] = [];
            const baseBytes = this.props.target.kind === "room" ? packBytes(this.latestContent()) : 0;
            // Rejected and failed files are skipped so the others still get added; the first problem is shown.
            for (const [index, file] of files.entries()) {
                if (!this.isDisposed) {
                    this.snapshot.merge({ uploading: { usage, current: index + 1, total: files.length } });
                }
                if (!ACCEPTED_EMOJI_TYPES.includes(file.type)) {
                    error ??= _t("matcha_emoji|error_type", { name: file.name });
                    continue;
                }
                if (file.size > MAX_EMOJI_FILE_SIZE) {
                    error ??= _t("matcha_emoji|error_size", { name: file.name });
                    continue;
                }
                const size = await imageSize(file);
                // A file that does not decode is not really an image of its type.
                if (!size) {
                    error ??= _t("matcha_emoji|error_type", { name: file.name });
                    continue;
                }
                if (size.w > MAX_EMOJI_DIMENSION || size.h > MAX_EMOJI_DIMENSION) {
                    error ??= _t("matcha_emoji|error_dimensions", { name: file.name });
                    continue;
                }
                if (baseBytes && baseBytes + (uploaded.length + 1) * IMAGE_ENTRY_BYTES > MAX_PACK_BYTES) {
                    error ??= _t("matcha_emoji|error_pack_full");
                    break;
                }
                try {
                    const blob = file.type === "image/jpeg" ? await jpegWithoutMetadata(file) : file;
                    // The file name would be public too, since pack images are not encrypted.
                    const { content_uri: url } = await this.props.client.uploadContent(blob, {
                        type: file.type,
                        includeFilename: false,
                    });
                    uploaded.push({ file, url, info: { ...size, mimetype: file.type, size: blob.size } });
                } catch (e) {
                    logger.warn("Failed to upload a custom emoji", e);
                    error ??= _t("matcha_emoji|error_upload", { name: file.name });
                }
            }
            if (!this.isDisposed) this.snapshot.merge({ uploading: undefined });
            if (!uploaded.length) return error;

            // Name the new images against the latest pack, so nobody's image is replaced.
            let content: ImagePackContent = this.latestContent() ?? {};
            const taken = new Set(Object.keys(content.images ?? {}));
            for (const { file, url, info } of uploaded) {
                const shortcode = shortcodeFromFileName(file.name, taken);
                taken.add(shortcode);
                // Every new image says what it is for, so emoji are not offered as stickers and stickers not as emoji.
                content = withImage(content, shortcode, { url, info, usage: [usage] });
            }
            await this.write(content);
            return error;
        });
    };

    public rename = (shortcode: string, newShortcode: string): void => {
        if (shortcode === newShortcode) return;
        this.change(async () => {
            if (!NEW_SHORTCODE_PATTERN.test(newShortcode)) return _t("matcha_emoji|error_shortcode_invalid");
            const content = this.latestContent();
            // Someone else removed or renamed it meanwhile; the list already follows room state.
            if (!Object.hasOwn(content?.images ?? {}, shortcode)) return;
            if (Object.hasOwn(content?.images ?? {}, newShortcode)) {
                return _t("matcha_emoji|error_shortcode_taken", { code: newShortcode });
            }
            await this.write(withRenamedImage(content, shortcode, newShortcode));
        });
    };

    public remove = (shortcode: string): void => {
        this.change(() => this.write(withoutImage(this.latestContent(), shortcode)));
    };

    public dismissError = (): void => {
        this.snapshot.merge({ error: undefined });
    };

    public renamePack = (name: string): void => {
        const trimmed = name.trim();
        if (this.props.target.kind === "user" || !trimmed || trimmed === this.snapshot.current.name) return;
        if (trimmed.length > MAX_PACK_NAME_LENGTH) {
            this.snapshot.merge({ error: _t("matcha_emoji|error_pack_name_length", { max: MAX_PACK_NAME_LENGTH }) });
            return;
        }
        this.change(() => this.write(withPackName(this.latestContent(), trimmed)));
    };

    public deletePack = (): void => {
        const { client, target } = this.props;
        // The default pack stays: other clients and Matcha's own emoji settings expect it.
        if (target.kind === "user" || this.stateKey === "") return;
        this.change(async () => {
            await this.write({});
            // Only the user's own list can be cleaned; other members keep a harmless entry for the deleted pack.
            const enabled = client.getAccountData(EMOTE_ROOMS_EVENT)?.getContent();
            if (isUsedEverywhere(enabled, target.room.roomId, this.stateKey)) {
                await setPackUsedEverywhere(client, target.room.roomId, this.stateKey, false);
            }
        });
    };

    public setUsedEverywhere = (usedEverywhere: boolean): void => {
        const { client, target } = this.props;
        if (target.kind === "user") return;
        this.change(async () => {
            await setPackUsedEverywhere(client, target.room.roomId, this.stateKey, usedEverywhere);
            if (!this.isDisposed) this.refresh();
        });
    };

    private refresh(): void {
        const { client, target } = this.props;
        const content = this.latestContent();
        const toEntry = (image: CustomEmoji): EmojiPackSettingsEmoji[] => {
            const src = mediaFromMxc(image.url, client).srcHttp;
            return src ? [{ shortcode: image.shortcode, src }] : [];
        };
        // An image usable as both is listed once, under emoji.
        const emojiImages = parseEmojiImages(content);
        const emojiCodes = new Set(emojiImages.map((image) => image.shortcode));
        const stickers = parseStickerImages(content)
            .filter((image) => !emojiCodes.has(image.shortcode))
            .flatMap(toEntry);
        const canEdit = this.canEdit();
        this.snapshot.merge({
            emojis: emojiImages.flatMap(toEntry),
            stickers,
            canEdit,
            canDelete: target.kind === "room" && canEdit && this.stateKey !== "",
            ...(target.kind === "room"
                ? {
                      name: packDisplayName(content) ?? (this.stateKey === "" ? target.room.name : this.stateKey),
                      usedEverywhere: isUsedEverywhere(
                          client.getAccountData(EMOTE_ROOMS_EVENT)?.getContent(),
                          target.room.roomId,
                          this.stateKey,
                      ),
                  }
                : {}),
        });
    }

    private canEdit(): boolean {
        const { client, target } = this.props;
        return target.kind === "user" || canEditRoomPacks(target.room, client.getSafeUserId());
    }

    private latestContent(): ImagePackContent | undefined {
        const { client, target } = this.props;
        // setAccountData resolves only once the update is in the local store, so it never needs `written`.
        if (target.kind === "user") return client.getAccountData(USER_EMOTES_EVENT)?.getContent<ImagePackContent>();
        const event = target.room.currentState.getStateEvents(ROOM_EMOTES_EVENT, this.stateKey);
        if (this.written?.superseded.has(event?.getId())) return this.written.content;
        return event?.getContent<ImagePackContent>();
    }

    /** Write fresh pack content; setAccountData skips content equal to what is stored. */
    private async write(content: ImagePackContent): Promise<void> {
        const { client, target } = this.props;
        if (target.kind === "user") {
            await client.setAccountData(USER_EMOTES_EVENT, content);
        } else {
            const replacedEventId = target.room.currentState.getStateEvents(ROOM_EMOTES_EVENT, this.stateKey)?.getId();
            const { event_id: eventId } = await client.sendStateEvent(
                target.room.roomId,
                ROOM_EMOTES_EVENT,
                content,
                this.stateKey,
            );
            // An earlier write's echo may have landed during this one, so everything it superseded still counts.
            const superseded = new Set(this.written?.superseded).add(replacedEventId);
            if (this.written) superseded.add(this.written.eventId);
            this.written = { eventId, superseded, content };
        }
        if (!this.isDisposed) this.refresh();
    }

    /** Queue a change. The task returns a translated message to show, if any, and throws when saving failed. */
    private change(task: () => Promise<string | void>): void {
        this.pendingChanges++;
        this.snapshot.merge({ busy: true, error: undefined });
        this.queue = this.queue.then(async () => {
            let error: string | undefined;
            try {
                // Changes the user made still get saved if the settings close before they run.
                error = (await task()) ?? undefined;
            } catch (e) {
                logger.warn("Failed to save the custom emoji pack", e);
                error =
                    e instanceof MatrixError && e.errcode === "M_TOO_LARGE"
                        ? _t("matcha_emoji|error_pack_full")
                        : _t("matcha_emoji|error_save");
            }
            this.pendingChanges--;
            if (this.isDisposed) return;
            this.snapshot.merge({ busy: this.pendingChanges > 0, ...(error ? { error } : {}) });
        });
    }
}
