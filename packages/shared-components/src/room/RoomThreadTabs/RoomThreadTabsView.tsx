/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Button, IconButton, Text } from "@vector-im/compound-web";
import {
    GridIcon,
    HistoryIcon,
    NotificationsIcon,
    ThreadsIcon,
    VisibilityOffIcon,
    VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { _t } from "../../core/i18n/i18n";
import styles from "./RoomThreadTabsView.module.css";

/** A room's currently available thread conversations. */
export interface RoomThreadTabsSnapshot {
    board?: "room" | "all";
    canRemind?: boolean;
    threads: { id: string; title: string; archived: boolean }[];
    selectedId?: string;
    canArchive: boolean;
    busy: boolean;
    showArchived: boolean;
    error?: string;
}

/** Actions exposed by the room thread selector. */
export interface RoomThreadTabsActions {
    openBoard: (board: "room" | "all") => void;
    setReminder: () => Promise<void>;
    select: (id?: string) => void;
    browse: () => void;
    archive: (id: string, archived: boolean) => Promise<void>;
    toggleArchived: () => void;
    retry: () => Promise<void>;
}

/** Presentation contract for room thread tabs. */
export type RoomThreadTabsViewModel = ViewModel<RoomThreadTabsSnapshot, RoomThreadTabsActions>;

/** General and thread navigation above the current room conversation. */
export function RoomThreadTabsView({ vm }: { vm: RoomThreadTabsViewModel }): JSX.Element {
    const { threads, selectedId, canArchive, busy, showArchived, error, board, canRemind } = useViewModel(vm);
    const selected = threads.find((thread) => thread.id === selectedId);
    return (
        <Flex className={styles.container} direction="column">
            <Flex className={styles.toolbar} align="center">
                <Flex as="nav" aria-label={_t("matcha_threads|navigation")} className={styles.tabs}>
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
                    {threads.some((thread) => !thread.archived) && (
                        <span className={styles.separator} aria-hidden="true" />
                    )}
                    {threads
                        .filter((thread) => !thread.archived || thread.id === selectedId)
                        .map((thread) => (
                            <Button
                                key={thread.id}
                                kind="secondary"
                                size="md"
                                className={styles.tab}
                                title={thread.title}
                                aria-current={selectedId === thread.id ? "page" : undefined}
                                onClick={() => vm.select(thread.id)}
                            >
                                <span className={styles.tabLabel}>{thread.title}</span>
                            </Button>
                        ))}
                </Flex>
                <Flex className={styles.actions} align="center">
                    <IconButton
                        kind="secondary"
                        noBackground
                        size="32px"
                        onClick={vm.browse}
                        aria-label={_t("matcha_threads|browse")}
                        tooltip={_t("matcha_threads|browse") + ". " + _t("matcha_threads|create_hint")}
                    >
                        <ThreadsIcon />
                    </IconButton>
                    <IconButton
                        kind="secondary"
                        noBackground
                        size="32px"
                        aria-label={_t("matcha_threads|all_boards")}
                        tooltip={_t("matcha_threads|all_boards")}
                        aria-current={board === "all" ? "page" : undefined}
                        onClick={() => vm.openBoard("all")}
                    >
                        <GridIcon />
                    </IconButton>
                    {canRemind && (
                        <IconButton
                            kind="secondary"
                            noBackground
                            size="32px"
                            onClick={vm.setReminder}
                            disabled={busy}
                            aria-label={_t("matcha_threads|reminder")}
                            tooltip={_t("matcha_threads|reminder")}
                        >
                            <NotificationsIcon />
                        </IconButton>
                    )}
                    <IconButton
                        kind="secondary"
                        noBackground
                        size="32px"
                        onClick={vm.toggleArchived}
                        aria-expanded={showArchived}
                        aria-label={_t("matcha_threads|archived")}
                        tooltip={_t("matcha_threads|archived")}
                    >
                        <HistoryIcon />
                    </IconButton>
                    {selected && canArchive && (
                        <IconButton
                            kind="secondary"
                            noBackground
                            size="32px"
                            disabled={busy}
                            aria-label={selected.archived ? _t("matcha_threads|restore") : _t("matcha_threads|archive")}
                            tooltip={selected.archived ? _t("matcha_threads|restore") : _t("matcha_threads|archive")}
                            onClick={() => vm.archive(selected.id, !selected.archived)}
                        >
                            {selected.archived ? <VisibilityOnIcon /> : <VisibilityOffIcon />}
                        </IconButton>
                    )}
                </Flex>
            </Flex>
            {showArchived && (
                <Flex
                    direction="column"
                    className={styles.expanded}
                    gap="var(--cpd-space-2x)"
                    aria-label={_t("matcha_threads|archived")}
                >
                    <Text size="sm" weight="semibold">
                        {_t("matcha_threads|archived")}
                    </Text>
                    {threads
                        .filter((thread) => thread.archived)
                        .map((thread) => (
                            <Flex key={thread.id} align="center" gap="var(--cpd-space-2x)">
                                <Button
                                    className={styles.archivedTitle}
                                    kind="secondary"
                                    size="md"
                                    onClick={() => vm.select(thread.id)}
                                >
                                    {thread.title}
                                </Button>
                                {canArchive && (
                                    <Button
                                        kind="secondary"
                                        size="md"
                                        disabled={busy}
                                        onClick={() => vm.archive(thread.id, false)}
                                    >
                                        {_t("matcha_threads|restore")}
                                    </Button>
                                )}
                            </Flex>
                        ))}
                    {!threads.some((thread) => thread.archived) && (
                        <Text size="sm" className={styles.hint}>
                            {_t("matcha_threads|none_archived")}
                        </Text>
                    )}
                </Flex>
            )}
            {error && (
                <Flex className={styles.expanded} align="center" gap="var(--cpd-space-2x)">
                    <Text size="md" role="alert">
                        {error}
                    </Text>
                    <Button kind="tertiary" size="md" disabled={busy} onClick={vm.retry}>
                        {_t("action|retry")}
                    </Button>
                </Flex>
            )}
        </Flex>
    );
}
