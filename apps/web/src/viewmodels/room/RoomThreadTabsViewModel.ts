/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type RoomThreadTabsSnapshot,
    type RoomThreadTabsActions,
} from "@element-hq/web-shared-components";
import {
    type MatrixClient,
    type Room,
    ThreadEvent,
    RoomEvent,
    RoomStateEvent,
    MatrixEventEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import type RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import { scheduleRoomReminder } from "../../utils/matcha/reminders";

/** Per-thread shared archive status; message content stays in the room timeline. */
export const THREAD_ARCHIVE_EVENT = "com.matchahoneylatte.thread_archive";

/** Matrix and navigation dependencies for one room's thread selector. */
export interface RoomThreadTabsProps {
    room: Room;
    client: MatrixClient;
    rightPanelStore: RightPanelStore;
    onBoardChange?: (board?: "room" | "all") => void;
    reminderBot?: string;
}

/** Reuses native Matrix threads and stores reversible archive status in room state. */
export class RoomThreadTabsViewModel
    extends BaseViewModel<RoomThreadTabsSnapshot, RoomThreadTabsProps>
    implements RoomThreadTabsActions
{
    private selectionRequest = 0;

    public constructor(props: RoomThreadTabsProps) {
        super(props, {
            threads: [],
            canArchive: false,
            busy: false,
            showArchived: false,
            canRemind: !!props.reminderBot,
        });
        for (const event of [ThreadEvent.New, ThreadEvent.Update, ThreadEvent.Delete, RoomEvent.Timeline]) {
            this.disposables.trackListener(props.room, event, this.refresh);
        }
        this.disposables.trackListener(props.client, RoomStateEvent.Events, this.refresh);
        this.disposables.trackListener(props.client, MatrixEventEvent.Decrypted, this.refresh);
        this.disposables.trackListener(props.rightPanelStore, UPDATE_EVENT, this.refresh);
        this.refresh();
        void this.retry();
    }

    private canArchive = (): boolean =>
        this.props.room.currentState.maySendStateEvent(THREAD_ARCHIVE_EVENT, this.props.client.getSafeUserId());

    private refresh = (): void => {
        if (this.isDisposed) return;
        const { room, rightPanelStore } = this.props;
        const card = rightPanelStore.currentCardForRoom(room.roomId);
        const selectedRoot =
            rightPanelStore.isOpenForRoom(room.roomId) && card.phase === RightPanelPhases.ThreadView
                ? card.state?.threadHeadEvent
                : undefined;
        const roots = new Map(room.getThreads().map((thread) => [thread.id, thread.rootEvent]));
        const selectedId = selectedRoot?.getId();
        if (selectedId && selectedRoot) roots.set(selectedId, selectedRoot);
        for (const event of room.currentState.getStateEvents(THREAD_ARCHIVE_EVENT)) {
            const id = event.getStateKey();
            if (event.getContent().archived === true && id) {
                if (!roots.has(id)) roots.set(id, room.findEventById(id));
            }
        }
        this.snapshot.merge({
            selectedId,
            canArchive: this.canArchive(),
            threads: [...roots].map(([id, event]) => ({
                id,
                title:
                    typeof event?.getContent().body === "string" && !event.isRedacted()
                        ? event.getContent().body.replace(/\s+/g, " ").slice(0, 100)
                        : _t("common|thread") + " " + id.slice(1, 9),
                archived: room.currentState.getStateEvents(THREAD_ARCHIVE_EVENT, id)?.getContent().archived === true,
            })),
        });
    };

    /** Load the native thread list; Browse threads supplies its existing pagination. */
    public retry = async (): Promise<void> => {
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            await this.props.room.createThreadsTimelineSets();
            await this.props.room.fetchRoomThreads();
            this.refresh();
        } catch (error) {
            logger.warn("Unable to load room thread tabs", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|load_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Open the main timeline, or an existing thread through the native thread card. */
    public select = async (id?: string): Promise<void> => {
        const request = ++this.selectionRequest;
        this.props.onBoardChange?.();
        const { room, client, rightPanelStore } = this.props;
        if (!id) {
            if (rightPanelStore.isOpenForRoom(room.roomId)) rightPanelStore.togglePanel(room.roomId);
            return;
        }
        try {
            const root =
                room.getThread(id)?.rootEvent ??
                room.findEventById(id) ??
                client.getEventMapper()(await client.fetchRoomEvent(room.roomId, id));
            await client.decryptEventIfNeeded(root);
            if (this.isDisposed || request !== this.selectionRequest) return;
            rightPanelStore.setCard(
                { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: root } },
                true,
                room.roomId,
            );
        } catch (error) {
            logger.warn("Unable to open room thread", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|load_error") });
        }
    };

    /** Open the existing paginated thread browser. */
    public browse = (): void => {
        this.props.onBoardChange?.();
        this.props.rightPanelStore.setCard({ phase: RightPanelPhases.ThreadPanel }, true, this.props.room.roomId);
    };

    /** Switch to this room's board or the aggregate board. */
    public openBoard = (board: "room" | "all"): void => {
        this.selectionRequest++;
        this.props.onBoardChange?.(board);
    };

    /** Mirror the active board selected by the containing room view. */
    public setBoard = (board?: "room" | "all"): void => {
        this.snapshot.merge({ board });
    };

    /** Schedule a reminder through the configured Matrix bot. */
    public setReminder = async (): Promise<void> => {
        if (!this.props.reminderBot || this.getSnapshot().busy) return;
        this.snapshot.merge({ busy: true });
        try {
            await scheduleRoomReminder(this.props.client, this.props.room, this.props.reminderBot);
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Show or hide archived conversations without changing messages. */
    public toggleArchived = (): void => {
        this.snapshot.merge({ showArchived: !this.getSnapshot().showArchived });
    };

    /** Archive for all beta users, or restore, only when current room permissions allow it. */
    public archive = async (id: string, archived: boolean): Promise<void> => {
        if (this.getSnapshot().busy || !this.canArchive()) return;
        if (archived) {
            const [confirmed] = await Modal.createDialog(QuestionDialog, {
                title: _t("matcha_threads|archive"),
                description: _t("matcha_threads|archive_description"),
                button: _t("matcha_threads|archive"),
            }).finished;
            if (!confirmed || this.isDisposed || !this.canArchive()) return;
        }
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            await this.props.client.sendStateEvent(this.props.room.roomId, THREAD_ARCHIVE_EVENT, { archived }, id);
            if (this.isDisposed) return;
            if (archived && this.getSnapshot().selectedId === id) await this.select();
            if (!archived) await this.select(id);
            this.refresh();
        } catch (error) {
            logger.warn("Unable to change room thread archive status", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|archive_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };
}
