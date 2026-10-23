/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import { Button, Heading, IconButton, Menu, MenuItem, Text } from "@vector-im/compound-web";
import {
    ChevronDownIcon,
    CloseIcon,
    EditIcon,
    GridIcon,
    HistoryIcon,
    LinkIcon,
    NotificationsIcon,
    PlusIcon,
    ThreadsIcon,
    VisibilityOffIcon,
    VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import styles from "./RoomThreadTabsView.module.css";

/** A thread conversation and the current member's management permission. */
export interface RoomThreadTab {
    id: string;
    title: string;
    archived: boolean;
    canManage: boolean;
}

/** A room's currently available thread conversations. */
export interface RoomThreadTabsSnapshot {
    board?: "room" | "all";
    canRemind?: boolean;
    threads: RoomThreadTab[];
    selectedId?: string;
    canCreate: boolean;
    canLinkToBoard: boolean;
    busy: boolean;
    showHistory: boolean;
    hasMore: boolean;
    error?: string;
}

/** Actions exposed by the room thread selector. */
export interface RoomThreadTabsActions {
    openBoard: (board: "room" | "all") => void;
    setReminder: () => Promise<void>;
    select: (id?: string) => void;
    create: () => Promise<void>;
    rename: (id: string) => Promise<void>;
    linkToBoard: (id: string) => Promise<void>;
    archive: (id: string, archived: boolean) => Promise<void>;
    toggleHistory: () => void;
    loadMore: () => Promise<void>;
    retry: () => Promise<void>;
}

/** Presentation contract for room thread tabs. */
export type RoomThreadTabsViewModel = ViewModel<RoomThreadTabsSnapshot, RoomThreadTabsActions>;

function ThreadActions({
    thread,
    vm,
    busy,
    canLinkToBoard,
}: {
    thread: RoomThreadTab;
    vm: RoomThreadTabsViewModel;
    busy: boolean;
    canLinkToBoard: boolean;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={thread.title}
            align="end"
            trigger={
                <IconButton size="32px" className={styles.threadMenu} tooltip={_t("matcha_threads|thread_actions")}>
                    <ChevronDownIcon />
                </IconButton>
            }
        >
            {thread.canManage && (
                <MenuItem
                    Icon={EditIcon}
                    label={_t("matcha_threads|rename")}
                    disabled={busy}
                    onSelect={() => void vm.rename(thread.id)}
                    hideChevron
                />
            )}
            {canLinkToBoard && (
                <MenuItem
                    Icon={LinkIcon}
                    label={_t("matcha_threads|link_to_board")}
                    disabled={busy}
                    onSelect={() => void vm.linkToBoard(thread.id)}
                    hideChevron
                />
            )}
            {thread.canManage && (
                <MenuItem
                    Icon={thread.archived ? VisibilityOnIcon : VisibilityOffIcon}
                    label={thread.archived ? _t("matcha_threads|restore") : _t("matcha_threads|archive")}
                    disabled={busy}
                    onSelect={() => void vm.archive(thread.id, !thread.archived)}
                    hideChevron
                />
            )}
        </Menu>
    );
}

/** General, boards, and a small set of thread tabs, with the complete thread history close by. */
export function RoomThreadTabsView({ vm }: { vm: RoomThreadTabsViewModel }): JSX.Element {
    const { threads, selectedId, canCreate, canLinkToBoard, busy, showHistory, hasMore, error, board, canRemind } =
        useViewModel(vm);
    const [moreOpen, setMoreOpen] = useState(false);
    const selected = threads.find((thread) => thread.id === selectedId);
    const visibleThreads = threads.filter((thread) => !thread.archived).slice(0, 4);
    if (selected && !visibleThreads.some((thread) => thread.id === selected.id)) {
        if (visibleThreads.length === 4) visibleThreads.pop();
        visibleThreads.push(selected);
    }
    return (
        <div className={styles.container}>
            <div className={styles.toolbar}>
                <nav aria-label={_t("matcha_threads|navigation")} className={styles.primaryTabs}>
                    <Button
                        className={styles.tab}
                        kind="secondary"
                        size="md"
                        aria-current={!selectedId && !board ? "page" : undefined}
                        onClick={() => vm.select()}
                    >
                        {_t("matcha_threads|general")}
                    </Button>
                    <Button
                        className={styles.tab}
                        kind="secondary"
                        size="md"
                        aria-current={board === "room" ? "page" : undefined}
                        onClick={() => vm.openBoard("room")}
                    >
                        {_t("matcha_threads|board")}
                    </Button>
                </nav>
                <div className={styles.actions}>
                    <Button
                        className={styles.newButton}
                        kind="secondary"
                        size="md"
                        disabled={busy || !canCreate}
                        onClick={vm.create}
                        title={!canCreate ? _t("matcha_threads|create_permission") : undefined}
                    >
                        <PlusIcon aria-hidden="true" />
                        {_t("matcha_threads|new_thread")}
                    </Button>
                    <Button
                        className={styles.quietButton}
                        kind="tertiary"
                        size="md"
                        onClick={vm.toggleHistory}
                        aria-expanded={showHistory}
                    >
                        <HistoryIcon aria-hidden="true" />
                        {_t("matcha_threads|history")}
                    </Button>
                    <Menu
                        open={moreOpen}
                        onOpenChange={setMoreOpen}
                        title={_t("matcha_threads|more")}
                        align="end"
                        trigger={
                            <Button className={styles.quietButton} kind="tertiary" size="md">
                                {_t("matcha_threads|more")}
                                <ChevronDownIcon aria-hidden="true" />
                            </Button>
                        }
                    >
                        <MenuItem
                            Icon={GridIcon}
                            label={_t("matcha_threads|all_boards")}
                            onSelect={() => vm.openBoard("all")}
                            hideChevron
                        />
                        {canRemind && (
                            <MenuItem
                                Icon={NotificationsIcon}
                                label={_t("matcha_threads|reminder")}
                                disabled={busy}
                                onSelect={() => void vm.setReminder()}
                                hideChevron
                            />
                        )}
                    </Menu>
                </div>
            </div>
            {visibleThreads.length > 0 && (
                <nav className={styles.threadTabs} aria-label={_t("matcha_threads|open_threads")}>
                    {visibleThreads.map((thread) => {
                        const active = selectedId === thread.id && !board;
                        return (
                            <div key={thread.id} className={styles.threadTab} data-selected={active}>
                                <Button
                                    kind="tertiary"
                                    size="md"
                                    className={styles.tab}
                                    title={thread.title}
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => vm.select(thread.id)}
                                >
                                    <ThreadsIcon aria-hidden="true" />
                                    <span className={styles.tabLabel}>{thread.title}</span>
                                </Button>
                                {active && (thread.canManage || canLinkToBoard) && (
                                    <ThreadActions
                                        thread={thread}
                                        vm={vm}
                                        busy={busy}
                                        canLinkToBoard={canLinkToBoard}
                                    />
                                )}
                            </div>
                        );
                    })}
                </nav>
            )}
            {showHistory && (
                <section className={styles.history} aria-label={_t("matcha_threads|history")}>
                    <div className={styles.historyHeader}>
                        <div>
                            <Heading as="h3" size="sm" className={styles.historyHeading}>
                                {_t("matcha_threads|history")}
                            </Heading>
                            <Text size="sm" className={styles.hint}>
                                {_t("matcha_threads|history_hint")}
                            </Text>
                        </div>
                        <IconButton size="32px" tooltip={_t("matcha_threads|close_history")} onClick={vm.toggleHistory}>
                            <CloseIcon />
                        </IconButton>
                    </div>
                    {threads.length > 0 ? (
                        <ul className={styles.historyList}>
                            {threads.map((thread) => (
                                <li key={thread.id} className={styles.historyRow}>
                                    <div className={styles.historyDetails}>
                                        <Button
                                            kind="tertiary"
                                            size="md"
                                            className={`${styles.quietButton} ${styles.historyTitle}`}
                                            title={thread.title}
                                            onClick={() => vm.select(thread.id)}
                                        >
                                            <span>{thread.title}</span>
                                        </Button>
                                        <Text as="span" className={styles.threadStatus} data-archived={thread.archived}>
                                            {thread.archived
                                                ? _t("matcha_threads|archived_status")
                                                : _t("matcha_threads|active_status")}
                                        </Text>
                                    </div>
                                    {thread.canManage && (
                                        <div className={styles.rowActions}>
                                            <Button
                                                className={styles.quietButton}
                                                kind="tertiary"
                                                size="md"
                                                disabled={busy}
                                                onClick={() => vm.rename(thread.id)}
                                            >
                                                {_t("matcha_threads|rename")}
                                            </Button>
                                            <Button
                                                className={styles.quietButton}
                                                kind="tertiary"
                                                size="md"
                                                disabled={busy}
                                                onClick={() => vm.archive(thread.id, !thread.archived)}
                                            >
                                                {thread.archived
                                                    ? _t("matcha_threads|restore")
                                                    : _t("matcha_threads|archive")}
                                            </Button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className={styles.historyEmpty}>
                            <ThreadsIcon aria-hidden="true" />
                            <div>
                                <Text size="sm" weight="semibold">
                                    {busy ? _t("matcha_threads|loading") : _t("matcha_threads|empty_title")}
                                </Text>
                                <Text size="sm" className={styles.hint}>
                                    {canCreate
                                        ? _t("matcha_threads|empty_hint")
                                        : _t("matcha_threads|create_permission")}
                                </Text>
                            </div>
                        </div>
                    )}
                    <div className={styles.historyFooter}>
                        <Text size="sm" className={styles.hint}>
                            {_t("matcha_threads|history_permissions")}
                        </Text>
                        {hasMore && (
                            <Button
                                className={styles.quietButton}
                                kind="tertiary"
                                size="md"
                                disabled={busy}
                                onClick={vm.loadMore}
                            >
                                {_t("matcha_threads|load_more")}
                            </Button>
                        )}
                    </div>
                </section>
            )}
            {error && (
                <div className={styles.error}>
                    <Text size="sm" role="alert">
                        {error}
                    </Text>
                    <Button className={styles.quietButton} kind="tertiary" size="md" disabled={busy} onClick={vm.retry}>
                        {_t("action|retry")}
                    </Button>
                </div>
            )}
        </div>
    );
}
