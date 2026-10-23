/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type SpaceDocsSetupSnapshot,
    type SpaceDocsSetupActions,
} from "@element-hq/web-shared-components";
import {
    EventType,
    RoomStateEvent,
    RoomMemberEvent,
    RoomEvent,
    type MatrixClient,
    type Room,
} from "matrix-js-sdk/src/matrix";

import { _t } from "../../languageHandler";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import { ROOM_DOC_EVENT } from "../../utils/matcha/documents";
import { waitForRoomEncryption } from "../../createRoom";

/** The actual Space and authenticated client; child rooms are never mutated. */
export interface SpaceDocsProps {
    space: Room;
    client: MatrixClient;
}

const ALGORITHM = "m.megolm.v1.aes-sha2";

/** One-time, explicitly confirmed encrypted Docs setup for an actual Matrix Space. */
export class SpaceDocsViewModel
    extends BaseViewModel<SpaceDocsSetupSnapshot, SpaceDocsProps>
    implements SpaceDocsSetupActions
{
    private cancelWait?: () => void;

    public constructor(props: SpaceDocsProps) {
        super(props, { spaceName: props.space.name, configured: false, canSetup: false, busy: false });
        this.disposables.trackListener(props.space.currentState, RoomStateEvent.Events, this.refresh);
        this.disposables.trackListener(props.space, RoomEvent.MyMembership, this.refresh);
        this.disposables.trackListener(props.client, RoomMemberEvent.Membership, this.refresh);
        this.disposables.trackListener(props.space, RoomEvent.Name, this.refresh);
        this.disposables.track(() => this.cancelWait?.());
        this.refresh();
    }

    private canSetup = (): boolean => {
        const { space, client } = this.props;
        const userId = client.getSafeUserId();
        return (
            space.isSpaceRoom() &&
            space.getMyMembership() === "join" &&
            space.currentState.maySendStateEvent(EventType.RoomEncryption, userId) &&
            space.currentState.maySendStateEvent(EventType.RoomPowerLevels, userId)
        );
    };

    private refresh = (): void => {
        if (this.isDisposed) return;
        const { space } = this.props;
        const encryption = space.currentState.getStateEvents(EventType.RoomEncryption, "")?.getContent();
        const powers = space.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent();
        const configured =
            space.isSpaceRoom() &&
            space.getMyMembership() === "join" &&
            encryption?.algorithm === ALGORITHM &&
            powers?.events?.[ROOM_DOC_EVENT] === 0 &&
            powers?.events?.[EventType.RoomMessageEncrypted] === 0;
        this.snapshot.merge({
            spaceName: space.name,
            configured,
            canSetup: this.canSetup(),
            ...(configured ? { error: undefined } : {}),
        });
    };

    private readEncryption = async (): Promise<Record<string, unknown> | undefined> => {
        try {
            return await this.props.client.getStateEvent(this.props.space.roomId, EventType.RoomEncryption, "");
        } catch (error) {
            if (typeof error === "object" && error !== null && "errcode" in error && error.errcode === "M_NOT_FOUND")
                return;
            throw error;
        }
    };

    private waitForConfiguration = (): Promise<void> => {
        this.refresh();
        if (this.getSnapshot().configured) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = (error?: Error): void => {
                clearTimeout(timer);
                unsubscribe();
                this.cancelWait = undefined;
                if (error) reject(error);
                else resolve();
            };
            const unsubscribe = this.subscribe(() => {
                if (this.getSnapshot().configured) finish();
            });
            const timer = setTimeout(() => finish(new Error("Waiting for Space state sync")), 10_000);
            this.cancelWait = () => finish(new Error("Space view closed"));
        });
    };

    /** Check current server state without changing permissions or encryption. */
    public retry = async (): Promise<void> => {
        if (this.getSnapshot().busy || this.isDisposed) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const [encryption, powers] = await Promise.all([
                this.readEncryption(),
                this.props.client.getStateEvent(this.props.space.roomId, EventType.RoomPowerLevels, ""),
            ]);
            if (this.isDisposed) return;
            if (
                encryption?.algorithm === ALGORITHM &&
                powers.events?.[ROOM_DOC_EVENT] === 0 &&
                powers.events?.[EventType.RoomMessageEncrypted] === 0
            ) {
                await this.waitForConfiguration();
            }
            this.refresh();
        } catch {
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_space_docs|setup_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Confirm first, enable encryption, then narrowly grant the required timeline permissions. */
    public enable = async (): Promise<void> => {
        this.refresh();
        if (this.isDisposed || this.getSnapshot().busy || this.getSnapshot().configured || !this.canSetup()) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const [confirmed] = await Modal.createDialog(QuestionDialog, {
                title: _t("matcha_space_docs|enable"),
                description: _t("matcha_space_docs|confirm", { space: this.props.space.name }),
                button: _t("matcha_space_docs|enable"),
            }).finished;
            if (!confirmed || this.isDisposed) return;
            if (!this.canSetup()) throw new Error("Space permissions changed");
            if (this.getSnapshot().configured) return;
            const { client, space } = this.props;
            const encryption = await this.readEncryption();
            if (encryption && encryption.algorithm !== ALGORITHM) throw new Error("Unsupported Space encryption");
            if (!encryption)
                await client.sendStateEvent(space.roomId, EventType.RoomEncryption, { algorithm: ALGORITHM }, "");
            await waitForRoomEncryption(space, 10_000);
            if (this.isDisposed || !this.canSetup()) throw new Error("Space permissions changed");
            const powers = await client.getStateEvent(space.roomId, EventType.RoomPowerLevels, "");
            if (this.isDisposed || !this.canSetup()) throw new Error("Space permissions changed");
            await client.sendStateEvent(
                space.roomId,
                EventType.RoomPowerLevels,
                {
                    ...powers,
                    events: { ...powers.events, [ROOM_DOC_EVENT]: 0, [EventType.RoomMessageEncrypted]: 0 },
                },
                "",
            );
            await this.waitForConfiguration();
        } catch {
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_space_docs|setup_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };
}
