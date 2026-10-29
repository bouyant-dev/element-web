/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type StickerPickerSticker,
    type StickerPickerViewActions,
    type StickerPickerViewSnapshot,
} from "@element-hq/web-shared-components";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { mediaFromMxc } from "../../customisations/Media";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { UserTab } from "../../components/views/dialogs/UserTab";
import { type StickerPack } from "../../utils/matcha/imagePacks";

/** Properties of {@link StickerPickerViewModel}. */
export interface StickerPickerViewModelProps {
    client: MatrixClient;
    /** The sticker packs usable in the room, in picker order. */
    packs: StickerPack[];
    /** The thread the composer sends to, if any. */
    threadId: string | null;
    /** Close the picker. */
    onFinished: () => void;
}

/** Offers the MSC2545 sticker packs of a room and sends the chosen sticker as an m.sticker event. */
export class StickerPickerViewModel
    extends BaseViewModel<StickerPickerViewSnapshot, StickerPickerViewModelProps>
    implements StickerPickerViewActions
{
    private selectedPackId?: string;
    private query = "";

    public constructor(props: StickerPickerViewModelProps) {
        super(props, { tabs: [], query: "", stickers: [] });
        this.update();
    }

    /** Follow pack changes while the picker is open. */
    public setPacks(packs: StickerPack[]): void {
        if (packs === this.props.packs) return;
        this.props = { ...this.props, packs };
        this.update();
    }

    public setQuery = (query: string): void => {
        this.query = query;
        this.update();
    };

    public selectPack = (packId: string): void => {
        this.selectedPackId = packId;
        this.query = "";
        this.update();
    };

    public sendSticker = (packId: string, shortcode: string): void => {
        const sticker = this.props.packs
            .find((pack) => pack.id === packId)
            ?.stickers.find((candidate) => candidate.shortcode === shortcode);
        if (!sticker) return;
        // RoomView sends it, as it does for integration-manager stickers, so guests and threads are handled the same.
        defaultDispatcher.dispatch({
            action: "post_sticker_message",
            data: {
                content: { url: sticker.url, info: sticker.info ?? {} },
                description: sticker.body ?? sticker.shortcode,
                threadId: this.props.threadId,
            },
        });
        this.props.onFinished();
    };

    public openSettings = (): void => {
        defaultDispatcher.dispatch({ action: Action.ViewUserSettings, initialTabId: UserTab.Emoji });
        this.props.onFinished();
    };

    private update(): void {
        const { client, packs } = this.props;
        // ponytail: full images, not thumbnails, so animated GIF and WebP stickers animate; the grid lazy-loads them.
        const src = (url: string): string | undefined => mediaFromMxc(url, client).srcHttp ?? undefined;
        const tabs = packs.map((pack) => {
            const icon = pack.avatarUrl ?? pack.stickers[0]?.url;
            const iconSrc = icon ? src(icon) : undefined;
            return { id: pack.id, name: pack.name, ...(iconSrc ? { iconSrc } : {}) };
        });

        const query = this.query.trim().toLowerCase();
        const selected = packs.find((pack) => pack.id === this.selectedPackId) ?? packs[0];
        const shown = query
            ? packs.flatMap((pack) =>
                  pack.stickers
                      .filter(
                          (sticker) =>
                              sticker.shortcode.toLowerCase().includes(query) ||
                              !!sticker.body?.toLowerCase().includes(query),
                      )
                      .map((sticker) => ({ pack, sticker })),
              )
            : (selected?.stickers.map((sticker) => ({ pack: selected, sticker })) ?? []);
        const stickers = shown.flatMap(({ pack, sticker }): StickerPickerSticker[] => {
            const stickerSrc = src(sticker.url);
            if (!stickerSrc) return [];
            return [
                {
                    packId: pack.id,
                    shortcode: sticker.shortcode,
                    src: stickerSrc,
                    label: sticker.body ?? `:${sticker.shortcode}:`,
                },
            ];
        });

        this.snapshot.merge({ tabs, selectedPackId: query ? undefined : selected?.id, query: this.query, stickers });
    }
}
