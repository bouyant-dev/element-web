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
    MatrixEvent,
    ThreadEvent,
    RoomEvent,
    RoomStateEvent,
    MatrixEventEvent,
    EventTimeline,
    RelationType,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import TextInputDialog from "../../components/views/dialogs/TextInputDialog";
import type RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import { scheduleRoomReminder } from "../../utils/matcha/reminders";
import {
    THREAD_ARCHIVE_EVENT,
    THREAD_METADATA_EVENT,
    canManageThreads,
    createNamedThread,
    readThreadMetadata,
    resolveThreadRoot,
    updateThreadMetadata,
    validThreadName,
    type ThreadMetadata,
} from "../../utils/matcha/threads";

export { THREAD_ARCHIVE_EVENT } from "../../utils/matcha/threads";

/** Matrix and navigation dependencies for one room's thread selector. */
export interface RoomThreadTabsProps {
    room: Room;
    client: MatrixClient;
    rightPanelStore: RightPanelStore;
    onBoardChange?: (board?: "room" | "all", initialThreadId?: string) => void;
    reminderBot?: string;
}

/** Native thread navigation with shared, encrypted metadata for ordinary room members. */
export class RoomThreadTabsViewModel
    extends BaseViewModel<RoomThreadTabsSnapshot, RoomThreadTabsProps>
    implements RoomThreadTabsActions
{
    private selectionRequest = 0;
    private metadata = new Map<string, ThreadMetadata>();
    private metadataErrors = new Set<string>();
    private dirty = new Set<string>();
    private revisions = new Map<string, number>();
    private loadingMetadata = false;
    private loadAgain = false;
    private refreshTimer?: ReturnType<typeof setTimeout>;

    public constructor(props: RoomThreadTabsProps) {
        super(props, {
            threads: [],
            canCreate: false,
            canLinkToBoard: false,
            busy: false,
            showHistory: false,
            hasMore: false,
            canRemind: !!props.reminderBot,
        });
        for (const event of [ThreadEvent.New, ThreadEvent.Update, ThreadEvent.Delete]) {
            this.disposables.trackListener(props.room, event, this.onThreadsChanged);
        }
        this.disposables.trackListener(props.client, RoomEvent.Timeline, (...args) => {
            if (args[0] instanceof MatrixEvent) this.onEvent(args[0]);
        });
        this.disposables.trackListener(props.client, MatrixEventEvent.Decrypted, (...args) => {
            // History decryption is part of loading; live encrypted relations arrive via Timeline.
            if (!this.loadingMetadata && args[0] instanceof MatrixEvent) this.onEvent(args[0]);
        });
        this.disposables.trackListener(props.client, RoomStateEvent.Events, this.refresh);
        this.disposables.trackListener(props.rightPanelStore, UPDATE_EVENT, this.onThreadsChanged);
        this.disposables.track(() => clearTimeout(this.refreshTimer));
        this.refresh();
        void this.retry();
    }

    private selectedRoot = (): MatrixEvent | undefined => {
        const { room, rightPanelStore } = this.props;
        const card = rightPanelStore.currentCardForRoom(room.roomId);
        return rightPanelStore.isOpenForRoom(room.roomId) && card.phase === RightPanelPhases.ThreadView
            ? card.state?.threadHeadEvent
            : undefined;
    };

    private roots = (): Map<string, MatrixEvent | undefined> => {
        const { room } = this.props;
        const roots = new Map(room.getThreads().map((thread) => [thread.id, thread.rootEvent]));
        const selected = this.selectedRoot();
        const selectedId = selected?.getId();
        if (selected && selectedId) roots.set(selectedId, selected);
        for (const event of room.currentState.getStateEvents(THREAD_ARCHIVE_EVENT)) {
            const id = event.getStateKey();
            if (event.getContent().archived === true && id && !roots.has(id)) roots.set(id, room.findEventById(id));
        }
        return roots;
    };

    private refresh = (): void => {
        if (this.isDisposed) return;
        const { room, client } = this.props;
        const canManage = canManageThreads(client, room);
        const roots = [...this.roots()].sort((a, b) => (b[1]?.getTs() ?? 0) - (a[1]?.getTs() ?? 0));
        this.snapshot.merge({
            selectedId: this.selectedRoot()?.getId(),
            canCreate: canManage && room.maySendMessage(),
            canLinkToBoard: room.getMyMembership() === "join" && room.maySendMessage(),
            hasMore: !!room.threadsTimelineSets[0]?.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS),
            threads: roots.map(([id, event]) => {
                const metadata = this.metadata.get(id);
                return {
                    id,
                    title:
                        metadata?.name ??
                        (typeof event?.getContent().body === "string"
                            ? event.getContent().body.replace(/\s+/g, " ").slice(0, 100)
                            : _t("common|thread") + " " + id.slice(1, 9)),
                    archived:
                        metadata?.archived ??
                        room.currentState.getStateEvents(THREAD_ARCHIVE_EVENT, id)?.getContent().archived === true,
                    canManage: canManage && !!metadata && !this.metadataErrors.has(id) && !this.dirty.has(id),
                };
            }),
        });
    };

    private onThreadsChanged = (): void => {
        this.refresh();
        this.scheduleMetadata();
    };

    private onEvent = (event: MatrixEvent): void => {
        if (event.getRoomId() !== this.props.room.roomId) return;
        const relation = event.getRelation();
        const id =
            event.getType() === THREAD_METADATA_EVENT || relation?.rel_type === RelationType.Reference
                ? relation?.event_id
                : event.getId();
        if (!id || !this.roots().has(id)) return;
        this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
        this.dirty.add(id);
        this.metadataErrors.delete(id);
        this.onThreadsChanged();
    };

    private scheduleMetadata = (): void => {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            if (!this.isDisposed) void this.loadMetadata();
        }, 250);
    };

    private loadMetadata = async (): Promise<void> => {
        if (this.loadingMetadata) {
            this.loadAgain = true;
            return;
        }
        this.loadingMetadata = true;
        try {
            const roots = [...this.roots()].filter(
                ([id]) => this.dirty.has(id) || (!this.metadata.has(id) && !this.metadataErrors.has(id)),
            );
            // Bound concurrent requests; each helper also bounds one thread's relation history.
            for (let offset = 0; offset < roots.length && !this.isDisposed; offset += 4) {
                await Promise.all(
                    roots.slice(offset, offset + 4).map(async ([id, knownRoot]) => {
                        const revision = this.revisions.get(id) ?? 0;
                        try {
                            const root = knownRoot ?? (await resolveThreadRoot(this.props.client, this.props.room, id));
                            const metadata = await readThreadMetadata(this.props.client, this.props.room, root);
                            if (!this.isDisposed && revision === (this.revisions.get(id) ?? 0)) {
                                this.metadata.set(id, metadata);
                                this.dirty.delete(id);
                                this.metadataErrors.delete(id);
                            } else if (!this.isDisposed) this.loadAgain = true;
                        } catch (error) {
                            logger.warn("Unable to read thread metadata", error);
                            if (!this.isDisposed && revision === (this.revisions.get(id) ?? 0)) {
                                this.metadataErrors.add(id);
                                this.dirty.delete(id);
                            }
                        }
                    }),
                );
            }
        } finally {
            this.loadingMetadata = false;
            if (!this.isDisposed) {
                if (this.metadataErrors.size) this.snapshot.merge({ error: _t("matcha_threads|metadata_error") });
                else if (this.getSnapshot().error === _t("matcha_threads|metadata_error"))
                    this.snapshot.merge({ error: undefined });
                this.refresh();
                if (this.loadAgain) {
                    this.loadAgain = false;
                    this.scheduleMetadata();
                }
            }
        }
    };

    /** Refresh the initial native thread page and metadata, preserving messages and drafts. */
    public retry = async (): Promise<void> => {
        this.snapshot.merge({ busy: true, error: undefined });
        this.metadataErrors.clear();
        for (const id of this.roots().keys()) {
            this.dirty.add(id);
            this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
        }
        try {
            await this.props.room.createThreadsTimelineSets();
            await this.props.room.fetchRoomThreads();
            await this.loadMetadata();
            this.refresh();
        } catch (error) {
            logger.warn("Unable to load room thread tabs", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|load_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Fetch one more native thread-list page for history. */
    public loadMore = async (): Promise<void> => {
        const timeline = this.props.room.threadsTimelineSets[0]?.getLiveTimeline();
        if (!timeline || !this.getSnapshot().hasMore || this.getSnapshot().busy) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            await this.props.client.paginateEventTimeline(timeline, { backwards: true, limit: 30 });
            await this.loadMetadata();
            this.refresh();
        } catch (error) {
            logger.warn("Unable to load older threads", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|load_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Open General or a validated native thread. */
    public select = async (id?: string): Promise<void> => {
        const request = ++this.selectionRequest;
        this.props.onBoardChange?.();
        const { room, client, rightPanelStore } = this.props;
        if (!id) {
            if (rightPanelStore.isOpenForRoom(room.roomId)) rightPanelStore.togglePanel(room.roomId);
            return;
        }
        try {
            const root = await resolveThreadRoot(client, room, id);
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

    /** Start a named native thread directly from the room toolbar. */
    public create = async (): Promise<void> => {
        if (this.getSnapshot().busy || !this.getSnapshot().canCreate) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const [confirmed, name] = await Modal.createDialog(TextInputDialog, {
                title: _t("matcha_threads|create_title"),
                placeholder: _t("matcha_threads|name_label"),
                button: _t("matcha_threads|create_button"),
                usePlaceholderAsHint: true,
                validator: async ({ value }) => ({
                    valid: validThreadName(value),
                    feedback: validThreadName(value) ? undefined : _t("matcha_threads|invalid_name"),
                }),
            }).finished;
            if (!confirmed || !validThreadName(name) || this.isDisposed) return;
            const root = await createNamedThread(this.props.client, this.props.room, name);
            if (this.isDisposed) return;
            this.metadata.set(root.getId()!, { name: name.trim(), archived: false });
            this.refresh();
            await this.select(root.getId());
        } catch (error) {
            logger.warn("Unable to create named thread", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|create_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Rename a thread for all members without editing its original message. */
    public rename = async (id: string): Promise<void> => {
        const selected = this.getSnapshot().threads.find((thread) => thread.id === id);
        if (this.getSnapshot().busy || !selected?.canManage) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const [confirmed, name] = await Modal.createDialog(TextInputDialog, {
                title: _t("matcha_threads|rename_title"),
                placeholder: _t("matcha_threads|name_label"),
                value: selected.title,
                button: _t("action|save"),
                usePlaceholderAsHint: true,
                validator: async ({ value }) => ({
                    valid: validThreadName(value),
                    feedback: validThreadName(value) ? undefined : _t("matcha_threads|invalid_name"),
                }),
            }).finished;
            if (!confirmed || !validThreadName(name) || this.isDisposed) return;
            const root = await resolveThreadRoot(this.props.client, this.props.room, id);
            await updateThreadMetadata(this.props.client, this.props.room, root, { name });
            this.metadata.set(id, { name: name.trim(), archived: selected.archived });
            this.refresh();
        } catch (error) {
            logger.warn("Unable to rename thread", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|rename_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    /** Open a board editor pre-linked to this native thread. */
    public linkToBoard = async (id: string): Promise<void> => {
        if (!this.getSnapshot().canLinkToBoard || this.getSnapshot().busy) return;
        try {
            await resolveThreadRoot(this.props.client, this.props.room, id);
            if (!this.isDisposed) this.props.onBoardChange?.("room", id);
        } catch (error) {
            logger.warn("Unable to link thread to board", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_threads|load_error") });
        }
    };

    public openBoard = (board: "room" | "all"): void => {
        this.selectionRequest++;
        this.props.onBoardChange?.(board);
    };
    public setBoard = (board?: "room" | "all"): void => {
        this.snapshot.merge({ board });
    };
    public toggleHistory = (): void => {
        this.snapshot.merge({ showHistory: !this.getSnapshot().showHistory });
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

    /** Archive/restore shared thread metadata using ordinary send permissions. */
    public archive = async (id: string, archived: boolean): Promise<void> => {
        const selected = this.getSnapshot().threads.find((thread) => thread.id === id);
        if (this.getSnapshot().busy || !selected?.canManage) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            if (archived) {
                const [confirmed] = await Modal.createDialog(QuestionDialog, {
                    title: _t("matcha_threads|archive"),
                    description: _t("matcha_threads|archive_description"),
                    button: _t("matcha_threads|archive"),
                }).finished;
                if (!confirmed || this.isDisposed) return;
            }
            const root = await resolveThreadRoot(this.props.client, this.props.room, id);
            await updateThreadMetadata(this.props.client, this.props.room, root, { archived });
            if (this.isDisposed) return;
            this.metadata.set(id, { name: selected.title, archived });
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
