/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type NewEmojiPackViewActions,
    type NewEmojiPackViewSnapshot,
} from "@element-hq/web-shared-components";
import {
    MatrixError,
    RoomStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomState,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { isEqual } from "lodash";

import { _t } from "../../languageHandler";
import {
    MAX_PACK_NAME_LENGTH,
    ROOM_EMOTES_EVENT,
    allRoomPackStateKeys,
    canEditRoomPacks,
    packStateKeyFromName,
    roomPackStateKeys,
    setPackUsedEverywhere,
    type ImagePackContent,
} from "../../utils/matcha/imagePacks";

/** Properties of {@link RoomEmojiPacksViewModel}. */
export interface RoomEmojiPacksViewModelProps {
    client: MatrixClient;
    /** The room or Space whose packs are listed. */
    room: Room;
}

/** The packs to show, plus the state of the "new pack" form. */
export interface RoomEmojiPacksSnapshot extends NewEmojiPackViewSnapshot {
    /** The packs' state keys, the default pack ("") first. */
    stateKeys: string[];
}

/** Lists the MSC2545 packs of a room or Space and creates new named packs in it. */
export class RoomEmojiPacksViewModel
    extends BaseViewModel<RoomEmojiPacksSnapshot, RoomEmojiPacksViewModelProps>
    implements NewEmojiPackViewActions
{
    public constructor(props: RoomEmojiPacksViewModelProps) {
        super(props, { stateKeys: [""], canCreate: false, busy: false });
        const { client, room } = props;
        this.disposables.trackListener(client, RoomStateEvent.Events, (event) => {
            const stateEvent = event as MatrixEvent;
            if (stateEvent.getRoomId() === room.roomId && stateEvent.getType() === ROOM_EMOTES_EVENT) this.refresh();
        });
        this.disposables.trackListener(client, RoomStateEvent.Update, (state) => {
            if ((state as RoomState).roomId === room.roomId) this.refresh();
        });
        this.refresh();
    }

    public createPack = (name: string): void => {
        const displayName = name.trim();
        if (!displayName) {
            this.snapshot.merge({ error: _t("matcha_emoji|error_pack_name") });
            return;
        }
        if (displayName.length > MAX_PACK_NAME_LENGTH) {
            this.snapshot.merge({ error: _t("matcha_emoji|error_pack_name_length", { max: MAX_PACK_NAME_LENGTH }) });
            return;
        }
        const { client, room } = this.props;
        const stateKey = packStateKeyFromName(displayName, allRoomPackStateKeys(room));
        const content: ImagePackContent = { pack: { display_name: displayName }, images: {} };
        this.snapshot.merge({ busy: true, error: undefined });
        client
            .sendStateEvent(room.roomId, ROOM_EMOTES_EVENT, content, stateKey)
            // ponytail: the pack is listed once its state echo arrives, so an upload never writes it without its name.
            .then(async () => {
                // Phones find a room's named packs only through this list, so the creator's phones get it straight away.
                await setPackUsedEverywhere(client, room.roomId, stateKey, true).catch((e) =>
                    logger.warn("Failed to offer a new custom emoji pack in every room", e),
                );
                if (!this.isDisposed) this.snapshot.merge({ busy: false });
            })
            .catch((e) => {
                logger.warn("Failed to create a custom emoji pack", e);
                if (this.isDisposed) return;
                this.snapshot.merge({
                    busy: false,
                    error:
                        e instanceof MatrixError && e.errcode === "M_FORBIDDEN"
                            ? _t("matcha_emoji|error_pack_create_forbidden")
                            : _t("matcha_emoji|error_pack_create"),
                });
            });
    };

    public dismissError = (): void => {
        this.snapshot.merge({ error: undefined });
    };

    private refresh(): void {
        if (this.isDisposed) return;
        const { client, room } = this.props;
        const next = roomPackStateKeys(room);
        const canCreate = canEditRoomPacks(room, client.getSafeUserId());
        this.snapshot.merge({
            // Keep the array when nothing changed, so the tab does not re-render every pack.
            stateKeys: isEqual(next, this.snapshot.current.stateKeys) ? this.snapshot.current.stateKeys : next,
            canCreate,
        });
    }
}
