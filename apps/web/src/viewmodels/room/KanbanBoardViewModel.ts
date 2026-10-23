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
    MatrixEventEvent,
    RelationType,
    ClientEvent,
    RoomStateEvent,
    RoomMemberEvent,
    type MatrixClient,
    type MatrixEvent,
    type RoomMember,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";

/** Room state contains only this board's root event identifier, never card content. */
export const KANBAN_STATE_EVENT = "com.matchahoneylatte.kanban";
/** Timeline event used as the stable parent for encrypted card revisions. */
export const KANBAN_ROOT_EVENT = "com.matchahoneylatte.kanban.board";
/** A complete card revision, automatically encrypted by the SDK in encrypted rooms. */
export const KANBAN_CARD_EVENT = "com.matchahoneylatte.kanban.card";

interface BoardData {
    rootId: string;
    cards: Map<string, KanbanCard>;
    next?: string;
    unreadable: boolean;
}

/** An omitted room selects the recap of currently joined rooms. */
export interface KanbanBoardProps {
    client: MatrixClient;
    room?: Room;
    onOpenRoom?: () => void;
}

function rootIdFromContent(content: Record<string, unknown>): string | undefined {
    return content.version === 1 && typeof content.event_id === "string" && content.event_id.startsWith("$")
        ? content.event_id
        : undefined;
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
        typeof content.archived !== "boolean"
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
        });
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
        const active = rooms.flatMap((source) => {
            const board = this.boards.get(source.roomId);
            return board
                ? [...board.cards.values()].map((card) => ({
                      ...card,
                      roomName: source.name,
                      canEdit: this.canWrite(source),
                  }))
                : [];
        });
        this.snapshot.merge({
            cards: active,
            initialized: room ? rooms.includes(room) && this.boards.has(room.roomId) : this.boards.size > 0,
            canCreateBoard:
                !!room &&
                this.canWrite(room) &&
                room.currentState.maySendEvent(KANBAN_ROOT_EVENT, this.props.client.getSafeUserId()) &&
                room.currentState.maySendStateEvent(KANBAN_STATE_EVENT, this.props.client.getSafeUserId()),
            canAdd: !!room && this.boards.has(room.roomId) && this.canWrite(room),
            hasMore: rooms.some((source) => !!this.boards.get(source.roomId)?.next),
            unreadable: rooms.some((source) => !!this.boards.get(source.roomId)?.unreadable),
        });
    };

    private onEvent = (event: MatrixEvent): void => {
        if (this.boards.get(event.getRoomId() ?? "")?.rootId === event.getRelation()?.event_id) this.scheduleReload();
    };

    private onDecrypted = (event: MatrixEvent): void => {
        // Decrypting fetched history must not trigger another history fetch.
        if (!this.getSnapshot().loading) this.onEvent(event);
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
            if (!this.isDisposed) void this.reload();
        }, 300);
    };

    private loadPage = async (room: Room, board: BoardData, from?: string): Promise<void> => {
        if (room.getMyMembership() !== "join") return;
        const result = await this.props.client.fetchRelations(room.roomId, board.rootId, RelationType.Reference, null, {
            dir: Direction.Backward,
            limit: 100,
            from,
        });
        for (const raw of result.chunk) {
            if (this.isDisposed || room.getMyMembership() !== "join") return;
            const event = this.props.client.getEventMapper()({ ...raw, room_id: room.roomId });
            await this.props.client.decryptEventIfNeeded(event);
            if (event.isDecryptionFailure()) {
                board.unreadable = true;
                continue;
            }
            const card = cardFromEvent(event, room, board.rootId);
            // Backward pagination is newest first: retain the first revision, regardless of sender clock.
            if (card && !board.cards.has(card.id)) board.cards.set(card.id, card);
        }
        board.next = result.next_batch && result.next_batch !== from ? result.next_batch : undefined;
    };

    /** Fetch at most one page per joined room; older cards remain available through Load more. */
    public reload = async (): Promise<void> => {
        const generation = ++this.generation;
        this.snapshot.merge({ loading: true, error: undefined });
        const boards = new Map<string, BoardData>();
        let failed = false;
        for (const room of this.joinedRooms()) {
            if (this.isDisposed || generation !== this.generation) return;
            const rootId =
                rootIdFromContent(room.currentState.getStateEvents(KANBAN_STATE_EVENT, "")?.getContent() ?? {}) ??
                (room === this.props.room ? this.createdRootId : undefined);
            if (!rootId) continue;
            const board: BoardData = { rootId, cards: new Map(), unreadable: false };
            boards.set(room.roomId, board);
            try {
                await this.loadPage(room, board);
            } catch (error) {
                logger.warn("Unable to load a Kanban board", error);
                failed = true;
            }
        }
        if (this.isDisposed || generation !== this.generation) return;
        this.boards = boards;
        this.snapshot.merge({ loading: false, error: failed ? _t("matcha_kanban|load_error") : undefined });
        this.publish();
    };

    /** Retrieve the next page for every incomplete board without scanning unrelated room history. */
    public loadMore = async (): Promise<void> => {
        if (this.getSnapshot().loading || this.getSnapshot().busy) return;
        const generation = this.generation;
        this.snapshot.merge({ loading: true, error: undefined });
        try {
            for (const room of this.joinedRooms()) {
                const board = this.boards.get(room.roomId);
                if (board?.next) await this.loadPage(room, board, board.next);
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
            if (!this.isDisposed) this.snapshot.merge({ busy: false });
        }
    };

    public edit = (card?: KanbanCard): void => {
        if (this.getSnapshot().busy) return;
        const room = this.props.client.getRoom(card?.roomId ?? this.props.room?.roomId ?? "");
        if (!room || !this.canWrite(room) || !this.boards.has(room.roomId)) return;
        this.snapshot.merge({
            editor: {
                roomId: room.roomId,
                id: card?.id,
                title: card?.title ?? "",
                description: card?.description ?? "",
            },
        });
    };
    public setTitle = (title: string): void => {
        if (this.getSnapshot().editor) this.snapshot.merge({ editor: { ...this.getSnapshot().editor!, title } });
    };
    public setDescription = (description: string): void => {
        if (this.getSnapshot().editor) this.snapshot.merge({ editor: { ...this.getSnapshot().editor!, description } });
    };
    public cancelEdit = (): void => {
        this.snapshot.merge({ editor: undefined });
    };
    public toggleArchived = (): void => {
        this.snapshot.merge({ showArchived: !this.getSnapshot().showArchived });
    };

    private write = async (card: KanbanCard): Promise<boolean> => {
        const { client } = this.props;
        const room = client.getRoom(card.roomId);
        const board = this.boards.get(card.roomId);
        if (!room || !board || !this.canWrite(room) || this.getSnapshot().busy) return false;
        if (
            !card.title.trim() ||
            card.title.length > 200 ||
            card.description.length > 4000 ||
            !["todo", "doing", "done"].includes(card.column)
        )
            return false;
        this.snapshot.merge({ busy: true, error: undefined });
        try {
            const current = rootIdFromContent(await client.getStateEvent(room.roomId, KANBAN_STATE_EVENT, ""));
            if (current !== board.rootId) throw new Error("Board reference changed; refresh before saving");
            if (!this.canWrite(room) || this.isDisposed) return false;
            await client.sendEvent(room.roomId, KANBAN_CARD_EVENT, {
                "version": 1,
                "card_id": card.id,
                "title": card.title.trim(),
                "description": card.description,
                "column": card.column,
                "archived": card.archived,
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
        const editor = this.getSnapshot().editor;
        if (!editor) return;
        const previous = editor.id ? this.boards.get(editor.roomId)?.cards.get(editor.id) : undefined;
        if (editor.id && !previous) return;
        const saved = await this.write({
            id: editor.id ?? crypto.randomUUID(),
            roomId: editor.roomId,
            roomName: "",
            canEdit: true,
            title: editor.title,
            description: editor.description,
            column: previous?.column ?? "todo",
            archived: previous?.archived ?? false,
        });
        if (saved && !this.isDisposed) this.cancelEdit();
    };

    public move = async (card: KanbanCard, column: KanbanColumn): Promise<void> => {
        const current = this.boards.get(card.roomId)?.cards.get(card.id);
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
        const current = this.boards.get(card.roomId)?.cards.get(card.id);
        if (current) await this.write({ ...current, archived });
    };

    public openRoom = (roomId: string): void => {
        if (this.props.client.getRoom(roomId)?.getMyMembership() === "join") {
            this.props.onOpenRoom?.();
            dispatcher.dispatch({ action: Action.ViewRoom, room_id: roomId });
        }
    };
}
