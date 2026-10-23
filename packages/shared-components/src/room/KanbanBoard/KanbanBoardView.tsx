/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import { Button, Form, Heading, IconButton, Menu, MenuItem, Text } from "@vector-im/compound-web";
import ArchiveIcon from "@vector-im/compound-design-tokens/assets/web/icons/export-archive";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import GridIcon from "@vector-im/compound-design-tokens/assets/web/icons/grid";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import MoreIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import PlusIcon from "@vector-im/compound-design-tokens/assets/web/icons/plus";
import RoomIcon from "@vector-im/compound-design-tokens/assets/web/icons/room";
import ClockIcon from "@vector-im/compound-design-tokens/assets/web/icons/history";
import ReminderIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications";
import ThreadIcon from "@vector-im/compound-design-tokens/assets/web/icons/threads";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { _t } from "../../core/i18n/i18n";
import styles from "./KanbanBoardView.module.css";

/** The three shared workflow stages. */
export type KanbanColumn = "todo" | "doing" | "done";

/** A card projected from the latest valid Matrix revision. */
export interface KanbanCard {
    id: string;
    roomId: string;
    roomName: string;
    title: string;
    description: string;
    column: KanbanColumn;
    archived: boolean;
    canEdit: boolean;
    threadId?: string;
    dueAt?: number;
    reminderRequested?: { eventId: string; at: number };
    earlierCards?: {
        id: string;
        title: string;
        description: string;
        column: KanbanColumn;
        archived: boolean;
        dueAt?: number;
    }[];
}

/** Presentation state for one room or the joined-room recap. */
export interface KanbanBoardSnapshot {
    cards: KanbanCard[];
    universal: boolean;
    initialized: boolean;
    canCreateBoard: boolean;
    canAdd: boolean;
    loading: boolean;
    busy: boolean;
    hasMore: boolean;
    showArchived: boolean;
    error?: string;
    unreadable: boolean;
    canRemind?: boolean;
    editor?: { id?: string; roomId: string; title: string; description: string; threadId?: string; dueAt?: string };
    threads: { id: string; title: string }[];
    threadsLoading: boolean;
    threadError?: string;
}

/** Board commands; all persistence and permissions belong to the view model. */
export interface KanbanBoardActions {
    reload: () => Promise<void>;
    loadMore: () => Promise<void>;
    createBoard: () => Promise<void>;
    edit: (card?: KanbanCard) => void;
    setTitle: (value: string) => void;
    setDescription: (value: string) => void;
    setThread: (id: string) => void;
    setDueAt: (value: string) => void;
    remind: (card: KanbanCard) => Promise<void>;
    cancelEdit: () => void;
    save: () => Promise<void>;
    move: (card: KanbanCard, column: KanbanColumn) => Promise<void>;
    archive: (card: KanbanCard, archived: boolean) => Promise<void>;
    toggleArchived: () => void;
    openRoom: (roomId: string) => void;
    openThread: (card: KanbanCard) => Promise<void>;
}

/** Contract consumed by the board view. */
export type KanbanBoardViewModel = ViewModel<KanbanBoardSnapshot, KanbanBoardActions>;

const columns: KanbanColumn[] = ["todo", "doing", "done"];
const columnLabel = (column: KanbanColumn): string => {
    switch (column) {
        case "todo":
            return _t("matcha_kanban|todo");
        case "doing":
            return _t("matcha_kanban|doing");
        case "done":
            return _t("matcha_kanban|done");
    }
};

function CardMenu({
    card,
    vm,
    disabled,
    canRemind,
}: {
    card: KanbanCard;
    vm: KanbanBoardViewModel;
    disabled: boolean;
    canRemind: boolean;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={card.title}
            align="end"
            trigger={
                <IconButton
                    size="32px"
                    className={styles.cardMenu}
                    disabled={disabled}
                    tooltip={_t("matcha_kanban|card_actions", { title: card.title })}
                >
                    <MoreIcon />
                </IconButton>
            }
        >
            {!card.archived && (
                <MenuItem
                    Icon={EditIcon}
                    disabled={disabled}
                    label={_t("matcha_kanban|edit")}
                    onSelect={() => vm.edit(card)}
                    hideChevron
                />
            )}
            {canRemind && !card.archived && (
                <MenuItem
                    Icon={ReminderIcon}
                    disabled={disabled}
                    label={_t("matcha_kanban|remind")}
                    onSelect={() => void vm.remind(card)}
                    hideChevron
                />
            )}
            <MenuItem
                Icon={ArchiveIcon}
                disabled={disabled}
                label={card.archived ? _t("matcha_kanban|restore") : _t("matcha_kanban|archive")}
                onSelect={() => void vm.archive(card, !card.archived)}
                hideChevron
            />
        </Menu>
    );
}

/** Accessible room board and cross-room recap, using text-only card content. */
export function KanbanBoardView({ vm }: { vm: KanbanBoardViewModel }): JSX.Element {
    const state = useViewModel(vm);
    const disabled = state.busy || state.loading;
    const visible = state.cards.filter((card) => card.archived === state.showArchived);
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Flex align="center" gap="var(--cpd-space-3x)" className={styles.headingGroup}>
                    <span className={styles.boardIcon} aria-hidden="true">
                        <GridIcon />
                    </span>
                    <div>
                        <Heading as="h2" size="md" className={styles.title}>
                            {state.universal ? _t("matcha_kanban|all_boards") : _t("matcha_kanban|board")}
                        </Heading>
                        <Text size="sm" className={styles.subtitle}>
                            {state.universal ? _t("matcha_kanban|recap_hint") : _t("matcha_kanban|room_hint")}
                        </Text>
                    </div>
                </Flex>
                {state.canAdd && (
                    <Button size="md" className={styles.addButton} disabled={disabled} onClick={() => vm.edit()}>
                        <PlusIcon aria-hidden="true" />
                        {_t("matcha_kanban|add")}
                    </Button>
                )}
            </header>
            <div className={styles.toolbar}>
                <Text size="sm" className={styles.cardCount}>
                    {_t("matcha_kanban|card_count", { count: visible.length })}
                </Text>
                <Flex align="center" gap="var(--cpd-space-2x)">
                    <Button
                        kind="tertiary"
                        size="md"
                        className={styles.archiveToggle}
                        onClick={vm.toggleArchived}
                        aria-pressed={state.showArchived}
                    >
                        <ArchiveIcon aria-hidden="true" />
                        {state.showArchived ? _t("matcha_kanban|active") : _t("matcha_kanban|archived")}
                    </Button>
                </Flex>
            </div>
            {state.error && (
                <div role="alert" className={styles.error}>
                    <Text size="sm">{state.error}</Text>
                    <Button kind="tertiary" size="md" disabled={disabled} onClick={vm.reload}>
                        {_t("matcha_kanban|retry")}
                    </Button>
                </div>
            )}
            {state.unreadable && (
                <Text size="sm" role="status" className={styles.notice}>
                    {_t("matcha_kanban|unreadable")}
                </Text>
            )}
            {!state.loading && !state.initialized && !state.universal && (
                <div className={styles.setup}>
                    <GridIcon aria-hidden="true" />
                    <Heading as="h3" size="sm">
                        {_t("matcha_kanban|setup_title")}
                    </Heading>
                    <Text size="sm">
                        {state.canCreateBoard ? _t("matcha_kanban|setup_hint") : _t("matcha_kanban|setup_permission")}
                    </Text>
                    {state.canCreateBoard && (
                        <Button size="md" disabled={disabled} onClick={vm.createBoard}>
                            {_t("matcha_kanban|create_board")}
                        </Button>
                    )}
                </div>
            )}
            {state.initialized && !state.universal && !state.canAdd && (
                <Text size="sm" className={styles.notice}>
                    {_t("matcha_kanban|read_only")}
                </Text>
            )}
            {state.editor && (
                <Form.Root
                    onSubmit={(event) => {
                        event.preventDefault();
                        void vm.save();
                    }}
                    className={styles.editor}
                >
                    <Heading as="h3" size="sm" className={styles.editorHeading}>
                        {state.editor.id ? _t("matcha_kanban|edit") : _t("matcha_kanban|add")}
                    </Heading>
                    <Form.Field name="kanban-title">
                        <Form.Label>{_t("matcha_kanban|title")}</Form.Label>
                        <Form.TextControl
                            value={state.editor.title}
                            maxLength={state.editor.threadId || !state.editor.id ? 100 : 200}
                            required
                            disabled={disabled}
                            onChange={(event) => vm.setTitle(event.target.value)}
                        />
                    </Form.Field>
                    <label className={styles.descriptionLabel}>
                        <Text as="span" size="sm">
                            {_t("matcha_kanban|description")}
                        </Text>
                        <textarea
                            value={state.editor.description}
                            maxLength={4000}
                            rows={3}
                            disabled={disabled}
                            onChange={(event) => vm.setDescription(event.target.value)}
                        />
                    </label>
                    <label className={styles.descriptionLabel}>
                        <Text as="span" size="sm">
                            {_t("matcha_kanban|deadline", {
                                timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
                            })}
                        </Text>
                        <input
                            type="datetime-local"
                            value={state.editor.dueAt ?? ""}
                            disabled={disabled}
                            onChange={(event) => vm.setDueAt(event.target.value)}
                        />
                    </label>
                    <Text size="sm" className={styles.subtitle}>
                        {state.editor.threadId || !state.editor.id
                            ? _t("matcha_kanban|thread_card_hint")
                            : _t("matcha_kanban|legacy_card_hint")}
                    </Text>
                    {state.threadError && (
                        <Text size="sm" role="alert">
                            {state.threadError}
                        </Text>
                    )}
                    <Flex justify="end" gap="var(--cpd-space-2x)">
                        <Button kind="secondary" size="md" disabled={disabled} onClick={vm.cancelEdit}>
                            {_t("matcha_kanban|cancel")}
                        </Button>
                        <Button type="submit" size="md" disabled={disabled || !state.editor.title.trim()}>
                            {_t("matcha_kanban|save")}
                        </Button>
                    </Flex>
                </Form.Root>
            )}
            {state.loading && (
                <Text size="sm" role="status" className={styles.notice}>
                    {_t("matcha_kanban|loading")}
                </Text>
            )}
            {(state.initialized || state.universal || state.loading) && (
                <div className={styles.columns} aria-busy={state.loading}>
                    {columns.map((column) => {
                        const cards = visible.filter((card) => card.column === column);
                        return (
                            <section
                                key={column}
                                aria-label={columnLabel(column)}
                                className={styles.column}
                                data-column={column}
                            >
                                <Flex align="center" gap="var(--cpd-space-2x)" className={styles.columnHeader}>
                                    <span className={styles.statusDot} aria-hidden="true" />
                                    <Heading as="h3" size="sm" className={styles.columnTitle}>
                                        {columnLabel(column)}
                                    </Heading>
                                    <span className={styles.columnCount}>{cards.length}</span>
                                </Flex>
                                <div className={styles.cardList}>
                                    {cards.map((card) => (
                                        <article
                                            key={card.roomId + card.id}
                                            className={styles.card}
                                            aria-label={card.title}
                                        >
                                            <div className={styles.cardHeader}>
                                                <Text as="h4" size="md" weight="semibold" className={styles.cardTitle}>
                                                    {card.title}
                                                </Text>
                                                {card.canEdit && (
                                                    <CardMenu
                                                        card={card}
                                                        vm={vm}
                                                        disabled={disabled}
                                                        canRemind={!!state.canRemind}
                                                    />
                                                )}
                                            </div>
                                            {card.description && (
                                                <Text size="sm" className={styles.description}>
                                                    {card.description}
                                                </Text>
                                            )}
                                            {card.dueAt && (
                                                <Text
                                                    as="time"
                                                    dateTime={new Date(card.dueAt).toISOString()}
                                                    size="sm"
                                                    className={styles.dueBadge}
                                                    data-overdue={
                                                        card.dueAt < Date.now() &&
                                                        card.column !== "done" &&
                                                        !card.archived
                                                    }
                                                >
                                                    <ClockIcon aria-hidden="true" />
                                                    {_t("matcha_kanban|due", {
                                                        date: new Date(card.dueAt).toLocaleString(undefined, {
                                                            month: "short",
                                                            day: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                            timeZoneName: "short",
                                                        }),
                                                    })}
                                                </Text>
                                            )}
                                            {card.reminderRequested && (
                                                <Text size="sm" className={styles.reminderStatus}>
                                                    {_t("matcha_kanban|reminder_requested", {
                                                        date: new Date(card.reminderRequested.at).toLocaleString(),
                                                    })}
                                                </Text>
                                            )}
                                            {!!card.earlierCards?.length && (
                                                <details className={styles.earlierCards}>
                                                    <summary>
                                                        {_t("matcha_kanban|earlier_cards", {
                                                            count: card.earlierCards.length,
                                                        })}
                                                    </summary>
                                                    {card.earlierCards.map((earlier) => (
                                                        <div key={earlier.id}>
                                                            <Text size="sm" weight="semibold">
                                                                {earlier.title}
                                                            </Text>
                                                            {earlier.description && (
                                                                <Text size="sm">{earlier.description}</Text>
                                                            )}
                                                            <Text size="sm">
                                                                {columnLabel(earlier.column)}
                                                                {earlier.archived
                                                                    ? ` · ${_t("matcha_kanban|archived")}`
                                                                    : ""}
                                                            </Text>
                                                            {earlier.dueAt && (
                                                                <Text size="sm">
                                                                    {_t("matcha_kanban|due", {
                                                                        date: new Date(earlier.dueAt).toLocaleString(),
                                                                    })}
                                                                </Text>
                                                            )}
                                                        </div>
                                                    ))}
                                                </details>
                                            )}
                                            {card.threadId && (
                                                <Button
                                                    kind="tertiary"
                                                    size="md"
                                                    className={styles.threadLink}
                                                    disabled={disabled}
                                                    onClick={() => void vm.openThread(card)}
                                                >
                                                    <ThreadIcon aria-hidden="true" />
                                                    {_t("matcha_kanban|open_thread")}
                                                </Button>
                                            )}
                                            <div className={styles.cardFooter}>
                                                {state.universal && (
                                                    <Button
                                                        kind="tertiary"
                                                        size="md"
                                                        className={styles.roomChip}
                                                        onClick={() => vm.openRoom(card.roomId)}
                                                        aria-label={_t("matcha_kanban|open_room", {
                                                            room: card.roomName,
                                                        })}
                                                    >
                                                        <RoomIcon aria-hidden="true" />
                                                        <span>{card.roomName}</span>
                                                    </Button>
                                                )}
                                                {card.canEdit && !card.archived && (
                                                    <select
                                                        className={styles.statusSelect}
                                                        aria-label={_t("matcha_kanban|status", { title: card.title })}
                                                        value={card.column}
                                                        disabled={disabled}
                                                        onChange={(event) =>
                                                            void vm.move(card, event.target.value as KanbanColumn)
                                                        }
                                                    >
                                                        {columns.map((target) => (
                                                            <option key={target} value={target}>
                                                                {columnLabel(target)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </div>
                                        </article>
                                    ))}
                                    {state.loading && cards.length === 0 && (
                                        <div className={styles.skeleton} aria-hidden="true">
                                            <span />
                                            <span />
                                            <span />
                                        </div>
                                    )}
                                    {!state.loading && cards.length === 0 && (
                                        <Text size="sm" className={styles.emptyColumn}>
                                            {_t("matcha_kanban|empty")}
                                        </Text>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
            {state.hasMore && (
                <div className={styles.historyNotice}>
                    <InfoIcon aria-hidden="true" />
                    <Text size="sm" role="status">
                        {_t("matcha_kanban|partial")}
                    </Text>
                    <Button
                        kind="tertiary"
                        size="md"
                        className={styles.historyButton}
                        disabled={disabled}
                        onClick={vm.loadMore}
                    >
                        {_t("matcha_kanban|load_more")}
                    </Button>
                </div>
            )}
        </div>
    );
}
