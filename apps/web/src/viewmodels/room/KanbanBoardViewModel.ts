/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type KanbanBoardSnapshot,
    type KanbanBoardActions,
    type KanbanCard,
    type KanbanColumn,
} from "@element-hq/web-shared-components";
import {
    Direction,
    EventType,
    EventTimeline,
    MatrixEventEvent,
    RelationType,
    ClientEvent,
    RoomStateEvent,
    RoomMemberEvent,
    type MatrixClient,
    type MatrixEvent,
    type IThreadBundledRelationship,
    type RoomMember,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import type RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import {
    readThreadMetadata,
    resolveThreadRoot,
    createNamedThread,
    updateThreadMetadata,
    canManageThreads,
    validThreadName,
    THREAD_METADATA_EVENT,
    type ThreadMetadataPatch,
    type ThreadMetadata,
} from "../../utils/matcha/threads";
import { scheduleRoomReminder } from "../../utils/matcha/reminders";
import { decryptMatrixEventWithRetry } from "../../utils/matcha/encryption";
import { filterValidMDirect } from "../../utils/dm/filterValidMDirect";

/** Room state contains only this board's root event identifier, never card content. */
export const KANBAN_STATE_EVENT = "com.matchahoneylatte.kanban";
/** Timeline event used as the stable parent for encrypted card revisions. */
export const KANBAN_ROOT_EVENT = "com.matchahoneylatte.kanban.board";
/** A complete card revision, automatically encrypted by the SDK in encrypted rooms. */
export const KANBAN_CARD_EVENT = "com.matchahoneylatte.kanban.card";

interface BoardData {
    rootId: string;
    cards: Map<string, KanbanCard>;
    projected: Map<string, KanbanCard>;
    threads: Map<string, ThreadMetadata>;
    participants: Map<string, Set<string>>;
    participantPages: Map<string, string | undefined>;
    next?: string;
    unreadable: boolean;
}

/** An omitted room selects the recap of currently joined rooms. */
export interface KanbanBoardProps {
    client: MatrixClient;
    room?: Room;
    onOpenRoom?: () => void;
    rightPanelStore: Pick<RightPanelStore, "setCard">;
    initialThreadId?: string;
    reminderBot?: string;
}

function rootIdFromContent(content: Record<string, unknown>): string | undefined {
    return content.version === 1 && typeof content.event_id === "string" && content.event_id.startsWith("$")
        ? content.event_id
        : undefined;
}

function validTimestamp(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 253402300799999;
}

function localDateTime(at: number): string {
    const date = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function threadCardId(threadId: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(threadId));
    return "thread-" + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cardFromEvent(event: MatrixEvent, room: Room, rootId: string): KanbanCard | undefined {
    if (event.getType() !== KANBAN_CARD_EVENT || event.isRedacted() || event.getRoomId() !== room.roomId) return;
    const content = event.getContent();
    const relation = event.getRelation();
    if (relation?.rel_type !== RelationType.Reference || relation.event_id !== rootId) return;
    if (
        content.version !== 1 ||
        typeof content.card_id !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(content.card_id) ||
        typeof content.title !== "string" ||
        !content.title.trim() ||
        content.title.length > 200 ||
        typeof content.description !== "string" ||
        content.description.length > 4000 ||
        !["todo", "doing", "done"].includes(content.column) ||
        typeof content.archived !== "boolean" ||
        (content.show_to_room !== undefined && typeof content.show_to_room !== "boolean")
    )
        return;
    return {
        id: content.card_id,
        roomId: room.roomId,
        roomName: room.name,
        title: content.title,
        description: content.description,
        column: content.column,
        archived: content.archived,
        canEdit: false,
        showToRoom: content.show_to_room ?? true,
        dueAt: validTimestamp(content.due_at) ? content.due_at : undefined,
        reminderRequested:
            content.reminder_requested &&
            typeof content.reminder_requested.event_id === "string" &&
            /^\$\S{1,511}$/.test(content.reminder_requested.event_id) &&
            validTimestamp(content.reminder_requested.at)
                ? { eventId: content.reminder_requested.event_id, at: content.reminder_requested.at }
                : undefined,
        threadId:
            typeof content.thread_id === "string" && /^\$\S{1,511}$/.test(content.thread_id)
                ? content.thread_id
                : undefined,
    };
}

/** Shared per-room boards, reconstructed from paginated and decrypted Matrix revisions. */
export class KanbanBoardViewModel
    extends BaseViewModel<KanbanBoardSnapshot, KanbanBoardProps>
    implements KanbanBoardActions
{
    private boards = new Map<string, BoardData>();
    private generation = 0;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private createdRootId?: string;
    private initialThreadId?: string;
    private loaded = false;
    private readingHistory = 0;
    private historyDirty = false;

    public constructor(props: KanbanBoardProps) {
        super(props, {
            cards: [],
            universal: !props.room,
            initialized: false,
            canCreateBoard: false,
            canAdd: false,
            loading: false,
            busy: false,
            hasMore: false,
            showArchived: false,
            unreadable: false,
            threads: [],
            threadsLoading: false,
            canRemind: !!props.reminderBot,
            people: [],
            personFilter: "",
        });
        this.initialThreadId = props.initialThreadId;
        this.disposables.trackListener(props.client, ClientEvent.Event, (event) => this.onEvent(event as MatrixEvent));
        this.disposables.trackListener(props.client, MatrixEventEvent.Decrypted, (event) =>
            this.onDecrypted(event as MatrixEvent),
        );
        this.disposables.trackListener(props.client, RoomStateEvent.Events, (event) =>
            this.onState(event as MatrixEvent),
        );
        this.disposables.trackListener(props.client, RoomMemberEvent.Membership, (event, member) =>
            this.onMembership(event as MatrixEvent, member as RoomMember),
        );
        this.disposables.trackListener(props.client, ClientEvent.AccountData, (event) => {
            if ((event as MatrixEvent).getType() === EventType.Direct) this.publish();
        });
        this.disposables.trackListener(props.client, RoomMemberEvent.Name, () => this.publish());
        this.disposables.track(() => clearTimeout(this.refreshTimer));
        void this.reload();
    }

    private joinedRooms = (): Room[] =>
        (this.props.room ? [this.props.room] : this.props.client.getRooms()).filter(
            (room) => room.getMyMembership() === "join",
        );

    private canWrite = (room: Room): boolean => {
        const { client } = this.props;
        return (
            room.getMyMembership() === "join" &&
            room.currentState.maySendEvent(KANBAN_CARD_EVENT, client.getSafeUserId()) &&
            (!room.hasEncryptionStateEvent() ||
                (!!client.getCrypto() &&
                    room.currentState.maySendEvent(EventType.RoomMessageEncrypted, client.getSafeUserId())))
        );
    };

    private publish = (): void => {
        if (this.isDisposed) return;
        const rooms = this.joinedRooms();
        const room = this.props.room;
        const me = this.props.client.getSafeUserId();
        const direct = Object.entries(
            filterValidMDirect(this.props.client.getAccountData(EventType.Direct)?.getContent() ?? {}).filteredContent,
        );
        const active = rooms.flatMap((source) => {
            const board = this.boards.get(source.roomId);
            if (!board) return [];
            const dmPartners = direct.filter(([, ids]) => ids.includes(source.roomId)).map(([userId]) => userId);
            const inviter = source.getDMInviter();
            if (!dmPartners.length && inviter) dmPartners.push(inviter);
            return [...board.projected.values()].flatMap((card) => {
                const participantIds = new Set(board.participants.get(card.threadId ?? card.id));
                if (dmPartners.length) {
                    participantIds.add(me);
                    for (const partner of dmPartners)
                        participantIds.add(partner === me ? (source.guessDMUserId() ?? me) : partner);
                }
                const involvesMe = participantIds.has(me);
                if (!involvesMe && (!room || !card.showToRoom)) return [];
                return [
                    {
                        ...card,
                        roomName: source.name,
                        canEdit: this.canWrite(source),
                        participants: [...participantIds]
                            .filter((id) => id !== me)
                            .map((userId) => ({
                                userId,
                                name:
                                    source.getMember(userId)?.name ??
                                    this.props.client.getUser(userId)?.displayName ??
                                    userId,
                            })),
                    },
                ];
            });
        });
        const people = [
            ...new Map(active.flatMap((card) => card.participants).map((person) => [person.userId, person])).values(),
        ].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
        const selectedPerson = this.getSnapshot().personFilter;
        const personFilter = people.some((person) => person.userId === selectedPerson) ? selectedPerson : "";
        this.snapshot.merge({
            cards:
                room || !personFilter
                    ? active
                    : active.filter((card) => card.participants.some((person) => person.userId === personFilter)),
            people,
            personFilter,
            initialized: room ? rooms.includes(room) && this.boards.has(room.roomId) : this.boards.size > 0,
            canCreateBoard:
                !!room &&
                this.canWrite(room) &&
                room.currentState.maySendEvent(KANBAN_ROOT_EVENT, this.props.client.getSafeUserId()) &&
                room.currentState.maySendStateEvent(KANBAN_STATE_EVENT, this.props.client.getSafeUserId()),
            canAdd:
                !!room &&
                this.boards.has(room.roomId) &&
                this.canWrite(room) &&
                canManageThreads(this.props.client, room) &&
                room.maySendMessage(),
            hasMore: rooms.some(
                (source) =>
                    this.boards.has(source.roomId) &&
                    (!!this.boards.get(source.roomId)?.next ||
                        [...(this.boards.get(source.roomId)?.participantPages.values() ?? [])].some(Boolean) ||
                        !!source.threadsTimelineSets[0]?.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS)),
            ),
            unreadable: rooms.some((source) => !!this.boards.get(source.roomId)?.unreadable),
        });
    };

    private onEvent = (event: MatrixEvent): void => {
        const roomId = event.getRoomId() ?? "";
        const room = this.props.client.getRoom(roomId);
        if (!room || room.getMyMembership() !== "join" || (this.props.room && this.props.room !== room)) return;
        const rootId =
            this.boards.get(roomId)?.rootId ??
            rootIdFromContent(room.currentState.getStateEvents(KANBAN_STATE_EVENT, "")?.getContent() ?? {});
        if (!rootId) return;
        if (
            event.getType() === THREAD_METADATA_EVENT ||
            event.getRelation()?.rel_type === RelationType.Thread ||
            event.isThreadRoot ||
            rootId === event.getRelation()?.event_id ||
            (this.readingHistory > 0 && event.isEncrypted())
        ) {
            if (this.readingHistory > 0) this.historyDirty = true;
            else this.scheduleReload();
        }
    };

    private onDecrypted = (event: MatrixEvent): void => {
        // Decrypting fetched history must not trigger another history fetch.
        if (this.readingHistory === 0) this.onEvent(event);
    };

    private onState = (event: MatrixEvent): void => {
        if (event.getType() === KANBAN_STATE_EVENT || event.getType() === EventType.RoomPowerLevels) {
            this.publish();
            this.scheduleReload();
        }
    };

    private onMembership = (_event: MatrixEvent, member: RoomMember): void => {
        if (member.userId !== this.props.client.getSafeUserId()) return;
        // Drop inaccessible cards immediately; never wait for a network refresh after leaving a room.
        for (const roomId of this.boards.keys()) {
            if (this.props.client.getRoom(roomId)?.getMyMembership() !== "join") this.boards.delete(roomId);
        }
        this.snapshot.merge({ editor: undefined });
        this.publish();
        this.scheduleReload();
    };

    private scheduleReload = (): void => {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            if (this.isDisposed) return;
            if (this.readingHistory > 0) this.historyDirty = true;
            else void this.reload();
        }, 300);
    };

    private finishHistory = (): void => {
        this.readingHistory--;
        if (this.readingHistory === 0 && this.historyDirty) {
            this.historyDirty = false;
            this.scheduleReload();
        }
    };

    private loadPage = async (room: Room, board: BoardData, from?: string): Promise<void> => {
        if (room.getMyMembership() !== "join") return;
        this.readingHistory++;
        try {
            const result = await this.props.client.fetchRelations(
                room.roomId,
                board.rootId,
                RelationType.Reference,
                null,
                {
                    dir: Direction.Backward,
                    limit: 100,
                    from,
                },
            );
            for (const raw of result.chunk) {
                if (this.isDisposed || room.getMyMembership() !== "join") return;
                const wire = { ...raw, room_id: room.roomId };
                const event = await decryptMatrixEventWithRetry(
                    this.props.client,
                    this.props.client.getEventMapper()(wire),
                    wire,
                );
                if (event.isDecryptionFailure()) {
                    board.unreadable = true;
                    continue;
                }
                const card = cardFromEvent(event, room, board.rootId);
                // Backward pagination is newest first: retain the first revision, regardless of sender clock.
                if (card) {
                    if (!board.cards.has(card.id)) board.cards.set(card.id, card);
                    // Legacy standalone cards have no thread; their revision authors are their participants.
                    if (!card.threadId && event.getSender()) {
                        const authors = board.participants.get(card.id) ?? new Set<string>();
                        authors.add(event.getSender()!);
                        board.participants.set(card.id, authors);
                    }
                }
            }
            board.next = result.next_batch && result.next_batch !== from ? result.next_batch : undefined;
        } finally {
            this.readingHistory--;
        }
    };

    private loadParticipants = async (room: Room, board: BoardData, threadId: string, from?: string): Promise<void> => {
        const result = await this.props.client.fetchRelations(room.roomId, threadId, RelationType.Thread, null, {
            dir: Direction.Backward,
            limit: 100,
            from,
        });
        if (this.isDisposed || room.getMyMembership() !== "join") return;
        const participants = board.participants.get(threadId) ?? new Set<string>();
        // Sender, redaction and relation are cleartext: replies are never decrypted just to list people.
        for (const raw of result.chunk) {
            const relation = raw.content?.["m.relates_to"];
            if (
                (!raw.room_id || raw.room_id === room.roomId) &&
                !raw.unsigned?.redacted_because &&
                raw.sender &&
                relation?.rel_type === RelationType.Thread &&
                relation.event_id === threadId
            )
                participants.add(raw.sender);
        }
        board.participants.set(threadId, participants);
        if (result.next_batch && result.next_batch === from) throw new Error("Thread participant pagination stalled");
        // A live refresh must not move the user's older-history cursor back to the first page.
        if (from || !board.participantPages.has(threadId) || !result.next_batch)
            board.participantPages.set(threadId, result.next_batch);
    };

    private projectThreads = async (room: Room, board: BoardData, fetch = true): Promise<boolean> => {
        const { client } = this.props;
        this.readingHistory++;
        let failed = false;
        try {
            if (fetch) {
                try {
                    await room.createThreadsTimelineSets();
                    await room.fetchRoomThreads();
                } catch (error) {
                    logger.warn("Unable to load board threads", error);
                    failed = true;
                }
            }
            const grouped = new Map<string, KanbanCard[]>();
            board.projected = new Map();
            for (const card of board.cards.values()) {
                if (!card.threadId) board.projected.set(card.id, card);
                else grouped.set(card.threadId, [...(grouped.get(card.threadId) ?? []), card]);
            }
            const ids = new Set([...room.getThreads().map((thread) => thread.id), ...grouped.keys()]);
            if (room === this.props.room && this.initialThreadId) ids.add(this.initialThreadId);
            const threadIds = [...ids];
            for (let offset = 0; offset < threadIds.length; offset += 4) {
                if (this.isDisposed || room.getMyMembership() !== "join") return true;
                const results = await Promise.allSettled(
                    threadIds.slice(offset, offset + 4).map(async (id) => {
                        const root = await resolveThreadRoot(client, room, id);
                        const metadata = await readThreadMetadata(client, room, root);
                        const thread = room.getThread(id);
                        // Participant sets only grow and live replies merge from thread.events below, so read the
                        // first reply page only for a thread not yet paged that is not wholly loaded locally.
                        const needsParticipants =
                            !board.participantPages.has(id) &&
                            !(
                                thread?.initialEventsFetched &&
                                !thread.liveTimeline.getPaginationToken(Direction.Backward)
                            );
                        const participants = board.participants.get(id) ?? new Set<string>();
                        if (root.getSender()) participants.add(root.getSender()!);
                        if (
                            thread?.hasCurrentUserParticipated ||
                            root.getServerAggregatedRelation<IThreadBundledRelationship>(RelationType.Thread)
                                ?.current_user_participated
                        )
                            participants.add(client.getSafeUserId());
                        for (const reply of thread?.events ?? []) {
                            const relation = reply.getRelation();
                            if (
                                !reply.isRedacted() &&
                                reply.getSender() &&
                                relation?.rel_type === RelationType.Thread &&
                                relation.event_id === id
                            )
                                participants.add(reply.getSender()!);
                        }
                        board.participants.set(id, participants);
                        if (needsParticipants) {
                            try {
                                await this.loadParticipants(room, board, id);
                            } catch (error) {
                                logger.warn("Unable to load board participants", error);
                                failed = true;
                            }
                        }
                        board.threads.set(id, metadata);
                        const revisions = grouped.get(id) ?? [];
                        const existing = revisions[0];
                        const card: KanbanCard = {
                            id: existing?.id ?? (await threadCardId(id)),
                            roomId: room.roomId,
                            roomName: room.name,
                            title: metadata.name,
                            description: existing?.description ?? "",
                            column: existing?.column ?? "todo",
                            archived: metadata.archiveExplicit
                                ? metadata.archived
                                : (existing?.archived ?? metadata.archived),
                            canEdit: this.canWrite(room),
                            showToRoom: existing?.showToRoom ?? true,
                            threadId: id,
                            dueAt: existing?.dueAt,
                            reminderRequested: existing?.reminderRequested,
                            earlierCards: revisions.slice(1),
                        };
                        return card;
                    }),
                );
                results.forEach((result, index) => {
                    if (result.status === "fulfilled") board.projected.set(result.value.id, result.value);
                    else {
                        failed = true;
                        const previous = grouped.get(threadIds[offset + index]);
                        if (previous?.length)
                            board.projected.set(previous[0].id, { ...previous[0], earlierCards: previous.slice(1) });
                    }
                });
            }
            return failed;
        } finally {
            this.readingHistory--;
        }
    };

    /** Fetch at most one page per joined room; older cards remain available through Load more. */
    public reload = async (): Promise<void> => {
        this.readingHistory++;
        try {
            const generation = ++this.generation;
            this.snapshot.merge({ loading: !this.loaded });
            const boards = new Map<string, BoardData>();
            let failed = false;
            const loadRoom = async (room: Room): Promise<void> => {
                const rootId =
                    rootIdFromContent(room.currentState.getStateEvents(KANBAN_STATE_EVENT, "")?.getContent() ?? {}) ??
                    (room === this.props.room ? this.createdRootId : undefined);
                if (!rootId) return;
                const previousBoard = this.boards.get(room.roomId);
                const board: BoardData = {
                    rootId,
                    cards: new Map(),
                    projected: new Map(),
                    threads: new Map(),
                    participants:
                        previousBoard?.rootId === rootId
                            ? new Map([...previousBoard.participants].map(([id, users]) => [id, new Set(users)]))
                            : new Map(),
                    participantPages:
                        previousBoard?.rootId === rootId ? new Map(previousBoard.participantPages) : new Map(),
                    unreadable: false,
                };
                boards.set(room.roomId, board);
                try {
                    await this.loadPage(room, board);
                    const previous = this.boards.get(room.roomId);
                    if (previous?.rootId === rootId && (board.next || board.unreadable)) {
                        // Keep older cards the user already loaded; fresh revisions take precedence.
                        for (const [id, card] of previous.cards) if (!board.cards.has(id)) board.cards.set(id, card);
                    }
                } catch (error) {
                    logger.warn("Unable to load a Kanban board", error);
                    failed = true;
                    const previous = this.boards.get(room.roomId);
                    if (previous?.rootId === rootId) boards.set(room.roomId, previous);
                }
                failed = (await this.projectThreads(room, boards.get(room.roomId)!)) || failed;
            };
            // Four rooms at a time; each room already bounds its own thread reads.
            const queue = this.joinedRooms();
            await Promise.all(
                Array.from({ length: 4 }, async () => {
                    for (let room = queue.shift(); room; room = queue.shift()) {
                        if (this.isDisposed || generation !== this.generation) return;
                        await loadRoom(room);
                    }
                }),
            );
            if (this.isDisposed || generation !== this.generation) return;
            this.boards = boards;
            this.loaded = true;
            this.snapshot.merge({ loading: false, error: failed ? _t("matcha_kanban|load_error") : undefined });
            this.publish();
            if (this.initialThreadId && this.getSnapshot().canAdd && !this.getSnapshot().editor) this.edit();
        } finally {
            this.finishHistory();
        }
    };

    /** Retrieve the next page for every incomplete board without scanning unrelated room history. */
    public loadMore = async (): Promise<void> => {
        if (this.getSnapshot().loading || this.getSnapshot().busy) return;
        const generation = this.generation;
        this.readingHistory++;
        this.snapshot.merge({ loading: true, error: undefined });
        try {
            for (const room of this.joinedRooms()) {
                const board = this.boards.get(room.roomId);
                if (!board) continue;
                if (board.next) await this.loadPage(room, board, board.next);
                for (const [threadId, from] of board.participantPages) {
                    if (!from) continue;
                    await this.loadParticipants(room, board, threadId, from);
                    if (this.isDisposed || generation !== this.generation) return;
                }
                const timeline = room.threadsTimelineSets[0]?.getLiveTimeline();
                if (timeline?.getPaginationToken(EventTimeline.BACKWARDS))
                    await this.props.client.paginateEventTimeline(timeline, { backwards: true, limit: 30 });
                if (board && (await this.projectThreads(room, board, false)))
                    this.snapshot.merge({ error: _t("matcha_kanban|load_error") });
                if (this.isDisposed || generation !== this.generation) return;
            }
        } catch (error) {
            logger.warn("Unable to load older Kanban cards", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_kanban|load_error") });
        } finally {
            if (!this.isDisposed && generation === this.generation) {
                this.snapshot.merge({ loading: false });
                this.publish();
            }
            this.finishHistory();
        }
    };

    /** Initialize only the shared reference; card content is never written to room state. */
    public createBoard = async (): Promise<void> => {
        this.publish();
        const room = this.props.room;
        if (!room || !this.getSnapshot().canCreateBoard || this.getSnapshot().busy || this.getSnapshot().initialized)
            return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const { event_id } = await this.props.client.sendEvent(room.roomId, KANBAN_ROOT_EVENT, { version: 1 });
            await this.props.client.sendStateEvent(room.roomId, KANBAN_STATE_EVENT, { version: 1, event_id }, "");
            this.createdRootId = event_id;
            if (!this.isDisposed) await this.reload();
        } catch (error) {
            logger.warn("Unable to create Kanban board", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_kanban|save_error") });
        } finally {
            if (!this.isDisposed) {
                this.snapshot.merge({ busy: false });
                if (this.initialThreadId && this.getSnapshot().canAdd) this.edit();
            }
        }
    };

    public edit = (card?: KanbanCard): void => {
        if (this.getSnapshot().busy) return;
        const room = this.props.client.getRoom(card?.roomId ?? this.props.room?.roomId ?? "");
        if (!room || !this.canWrite(room) || !this.boards.has(room.roomId)) return;
        const board = this.boards.get(room.roomId)!;
        if (!card && this.initialThreadId)
            card = [...board.projected.values()].find((item) => item.threadId === this.initialThreadId);
        this.snapshot.merge({
            editor: {
                roomId: room.roomId,
                id: card?.id,
                title: card?.title ?? "",
                description: card?.description ?? "",
                threadId: card?.threadId ?? this.initialThreadId,
                dueAt: card?.dueAt ? localDateTime(card.dueAt) : "",
                showToRoom: card ? (card.showToRoom ?? true) : false,
            },
            threads: [...board.threads].map(([id, metadata]) => ({ id, title: metadata.name })),
            threadsLoading: false,
            threadError: undefined,
        });
        this.initialThreadId = undefined;
    };
    public setThread = (threadId: string): void => {
        const editor = this.getSnapshot().editor;
        if (!editor) return;
        const existing = [...(this.boards.get(editor.roomId)?.projected.values() ?? [])].find(
            (card) => card.threadId === threadId,
        );
        if ((existing && existing.id !== editor.id) || (editor.threadId && editor.threadId !== threadId)) {
            this.snapshot.merge({ threadError: _t("matcha_kanban|duplicate_thread") });
            return;
        }
        this.snapshot.merge({ editor: { ...editor, threadId: threadId || undefined }, threadError: undefined });
    };
    public setTitle = (title: string): void => {
        if (this.getSnapshot().editor) this.snapshot.merge({ editor: { ...this.getSnapshot().editor!, title } });
    };
    public setDescription = (description: string): void => {
        if (this.getSnapshot().editor) this.snapshot.merge({ editor: { ...this.getSnapshot().editor!, description } });
    };
    public setDueAt = (dueAt: string): void => {
        if (this.getSnapshot().editor) this.snapshot.merge({ editor: { ...this.getSnapshot().editor!, dueAt } });
    };
    public setShowToRoom = (showToRoom: boolean): void => {
        const editor = this.getSnapshot().editor;
        if (editor) this.snapshot.merge({ editor: { ...editor, showToRoom } });
    };
    public setPersonFilter = (personFilter: string): void => {
        this.snapshot.merge({ personFilter });
        this.publish();
    };
    public cancelEdit = (): void => {
        this.snapshot.merge({ editor: undefined, threadsLoading: false, threads: [], threadError: undefined });
    };
    public toggleArchived = (): void => {
        this.snapshot.merge({ showArchived: !this.getSnapshot().showArchived });
    };

    private write = async (card: KanbanCard, threadPatch?: ThreadMetadataPatch): Promise<boolean> => {
        const { client } = this.props;
        const room = client.getRoom(card.roomId);
        const board = this.boards.get(card.roomId);
        if (!room || !board || !this.canWrite(room) || this.getSnapshot().busy) return false;
        if (
            !card.title.trim() ||
            card.title.length > 200 ||
            card.description.length > 4000 ||
            !["todo", "doing", "done"].includes(card.column) ||
            (card.dueAt !== undefined && !validTimestamp(card.dueAt))
        )
            return false;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const current = rootIdFromContent(await client.getStateEvent(room.roomId, KANBAN_STATE_EVENT, ""));
            if (current !== board.rootId) throw new Error("Board reference changed; refresh before saving");
            if (!this.canWrite(room) || this.isDisposed) return false;
            if (card.threadId) {
                const duplicate = [...board.projected.values()].find(
                    (item) => item.threadId === card.threadId && item.id !== card.id,
                );
                if (duplicate) throw new Error("Thread already has a board card");
                const root = await resolveThreadRoot(client, room, card.threadId);
                if (threadPatch) await updateThreadMetadata(client, room, root, threadPatch);
                const metadata = await readThreadMetadata(client, room, root);
                card = {
                    ...card,
                    title: metadata.name,
                    archived: metadata.archiveExplicit ? metadata.archived : card.archived,
                };
            }
            if (!this.canWrite(room) || this.isDisposed) return false;
            await client.sendEvent(room.roomId, KANBAN_CARD_EVENT, {
                "version": 1,
                "card_id": card.id,
                "title": card.title.trim(),
                "description": card.description,
                "column": card.column,
                "archived": card.archived,
                "show_to_room": card.showToRoom ?? true,
                ...(card.threadId ? { thread_id: card.threadId } : {}),
                ...(card.dueAt !== undefined ? { due_at: card.dueAt } : {}),
                ...(card.reminderRequested
                    ? {
                          reminder_requested: {
                              event_id: card.reminderRequested.eventId,
                              at: card.reminderRequested.at,
                          },
                      }
                    : {}),
                "m.relates_to": { rel_type: RelationType.Reference, event_id: board.rootId },
            });
            if (!this.isDisposed) await this.reload();
            return true;
        } catch (error) {
            logger.warn("Unable to save Kanban card", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_kanban|save_error") });
            return false;
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    public save = async (): Promise<void> => {
        let editor = this.getSnapshot().editor;
        if (!editor || this.getSnapshot().busy || this.getSnapshot().threadError) return;
        const room = this.props.client.getRoom(editor.roomId);
        const board = this.boards.get(editor.roomId);
        if (!room || !board || !this.canWrite(room)) return;
        if (editor.description.length > 4000) {
            this.snapshot.merge({ error: _t("matcha_kanban|save_error") });
            return;
        }
        const previous = editor.id ? board.projected.get(editor.id) : undefined;
        if (editor.id && !previous) return;
        let dueAt: number | undefined;
        if (editor.dueAt) {
            dueAt = new Date(editor.dueAt).getTime();
            if (
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(editor.dueAt) ||
                !validTimestamp(dueAt) ||
                localDateTime(dueAt) !== editor.dueAt
            ) {
                this.snapshot.merge({ error: _t("matcha_kanban|invalid_deadline") });
                return;
            }
        }
        if ((!editor.id || editor.threadId) && !validThreadName(editor.title)) {
            this.snapshot.merge({ error: _t("matcha_kanban|invalid_thread_title") });
            return;
        }
        if (!editor.id && !editor.threadId) {
            if (!canManageThreads(this.props.client, room) || !room.maySendMessage()) return;
            this.snapshot.merge({ busy: true, error: undefined });
            try {
                const current = rootIdFromContent(
                    await this.props.client.getStateEvent(room.roomId, KANBAN_STATE_EVENT, ""),
                );
                if (current !== board.rootId) throw new Error("Board reference changed");
                const root = await createNamedThread(this.props.client, room, editor.title);
                const threadId = root.getId();
                if (!threadId?.startsWith("$")) throw new Error("Created thread has no identifier");
                editor = { ...editor, threadId };
                if (!this.isDisposed) this.snapshot.merge({ editor });
            } catch (error) {
                logger.warn("Unable to create board thread", error);
                if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_kanban|create_thread_error") });
                return;
            } finally {
                if (!this.isDisposed) this.snapshot.merge({ busy: false });
            }
        }
        if (this.isDisposed) return;
        const saved = await this.write(
            {
                id: editor.id ?? (await threadCardId(editor.threadId!)),
                roomId: editor.roomId,
                roomName: "",
                canEdit: true,
                title: editor.title,
                description: editor.description,
                column: previous?.column ?? "todo",
                archived: previous?.archived ?? false,
                threadId: editor.threadId,
                dueAt,
                reminderRequested: previous?.reminderRequested,
                showToRoom: editor.showToRoom ?? false,
            },
            previous?.threadId && previous.title !== editor.title.trim() ? { name: editor.title.trim() } : undefined,
        );
        if (saved && !this.isDisposed) this.cancelEdit();
    };

    /** Sending a command is a request; the bot confirms its schedule separately. */
    public remind = async (card: KanbanCard): Promise<void> => {
        const { client, reminderBot } = this.props;
        const room = client.getRoom(card.roomId);
        const current = this.boards.get(card.roomId)?.projected.get(card.id);
        if (!reminderBot || !room || !current || current.archived || !this.canWrite(room) || this.getSnapshot().busy)
            return;
        this.snapshot.merge({ busy: true });
        let request;
        try {
            request = await scheduleRoomReminder(client, room, reminderBot, {
                message: current.title,
                at: current.dueAt,
                threadId: current.threadId,
            });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
        const latest = this.boards.get(card.roomId)?.projected.get(card.id);
        if (request && latest && !this.isDisposed)
            await this.write({ ...latest, reminderRequested: { eventId: request.eventId, at: request.at } });
    };

    public move = async (card: KanbanCard, column: KanbanColumn): Promise<void> => {
        const current = this.boards.get(card.roomId)?.projected.get(card.id);
        if (current) await this.write({ ...current, column });
    };

    /** Archive is a reversible revision, never a destructive message deletion. */
    public archive = async (card: KanbanCard, archived: boolean): Promise<void> => {
        if (this.getSnapshot().busy) return;
        if (archived) {
            const [confirmed] = await Modal.createDialog(QuestionDialog, {
                title: _t("matcha_kanban|archive"),
                description: _t("matcha_kanban|archive_hint"),
                button: _t("matcha_kanban|archive"),
            }).finished;
            if (!confirmed || this.isDisposed) return;
        }
        const current = this.boards.get(card.roomId)?.projected.get(card.id);
        if (current) await this.write({ ...current, archived }, current.threadId ? { archived } : undefined);
    };

    public openRoom = (roomId: string): void => {
        if (this.props.client.getRoom(roomId)?.getMyMembership() === "join") {
            this.props.onOpenRoom?.();
            dispatcher.dispatch({ action: Action.ViewRoom, room_id: roomId });
        }
    };

    /** Open the native thread panel in the card's own room, including from the recap. */
    public openThread = async (card: KanbanCard): Promise<void> => {
        const room = this.props.client.getRoom(card.roomId);
        if (!room || room.getMyMembership() !== "join" || !card.threadId || this.getSnapshot().busy) return;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const root = await resolveThreadRoot(this.props.client, room, card.threadId);
            if (this.isDisposed || room.getMyMembership() !== "join") return;
            this.props.rightPanelStore.setCard(
                { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: root } },
                true,
                room.roomId,
            );
            this.props.onOpenRoom?.();
            dispatcher.dispatch({ action: Action.ViewRoom, room_id: room.roomId });
        } catch (error) {
            logger.warn("Unable to open linked board thread", error);
            if (!this.isDisposed) this.snapshot.merge({ error: _t("matcha_kanban|thread_open_error") });
        } finally {
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };
}
