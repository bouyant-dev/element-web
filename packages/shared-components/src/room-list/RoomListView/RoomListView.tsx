/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type ReactNode } from "react";
import { Button, IconButton, Text } from "@vector-im/compound-web";
import { ChatIcon, DocumentIcon, EditIcon, PlusIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useViewModel, type ViewModel } from "../../core/viewmodel";
import { RoomListPrimaryFilters, type FilterId } from "../RoomListPrimaryFilters";
import { RoomListLoadingSkeleton } from "./RoomListLoadingSkeleton";
import { RoomListEmptyStateView } from "./RoomListEmptyStateView";
import { VirtualizedRoomListView, type RoomListViewState } from "../VirtualizedRoomListView";
import { type Room, type RoomListItemViewModel } from "../VirtualizedRoomListView/RoomListItemWrapper/RoomListItemView";
import { type RoomListSectionHeaderViewModel } from "../VirtualizedRoomListView/RoomListSectionHeaderView";
import { type ToastType, RoomListToast } from "./RoomListToast";
import styles from "./RoomListView.module.css";
import { Flex } from "../../core/utils/Flex";
import { AutoHideScrollbar } from "../../core/utils/Scrollbar";
import { _t } from "../../core/i18n/i18n";

export type RoomListSection = {
    /** Unique identifier for the section */
    id: string;
    /** Array of room IDs that belong to this section */
    roomIds: string[];
};

/**
 * Snapshot for the room list view
 */
export type RoomListViewSnapshot = {
    /** Whether the rooms are currently loading */
    isLoadingRooms: boolean;
    /** Whether the room list is empty */
    isRoomListEmpty: boolean;
    /** Array of filter IDs */
    filterIds: FilterId[];
    /** Currently active filter ID (if any) */
    activeFilterId?: FilterId;
    /** Room list state */
    roomListState: RoomListViewState;
    /** Array of sections in the room list */
    sections: RoomListSection[];
    /** Optional description for the empty state */
    emptyStateDescription?: string;
    /** Optional action element for the empty state */
    emptyStateAction?: ReactNode;
    /** Whether the user can create rooms */
    canCreateRoom?: boolean;
    /** Whether the room list is displayed as a flat list */
    isFlatList: boolean;
    /** Active content in a joined Space; absent outside a Space. */
    spaceContent?: "chats" | "docs";
    /** Saved documents belonging to the selected Space only. */
    spaceDocuments?: {
        items: { id: string; name: string }[];
        selectedId?: string;
        loading: boolean;
        sync?: "loading" | "saved" | "saving" | "offline" | "error";
        canEdit: boolean;
        busy: boolean;
        error?: string;
    };
    /**
     * The single toast to display (if any). The view model owns which toast wins when more
     * than one applies (e.g. a transient "chat_moved" event toast takes precedence over the
     * persistent "unread_activity" toast), so the view just renders whatever it is given.
     */
    toast?: ToastType;
};

/**
 * Actions interface for room list operations
 */
export interface RoomListViewActions {
    /** Open the selected Space's chats or shared document. */
    openSpaceContent: (content: "chats" | "docs") => void;
    /** Open one document from the selected Space's saved documents. */
    openSpaceDocument: (id: string) => void;
    /** Create and name a document in the selected Space. */
    createSpaceDocument: () => Promise<void>;
    /** Rename a document for all members of its Space. */
    renameSpaceDocument: (id: string) => Promise<void>;
    /** Retry loading or saving the document list. */
    retrySpaceDocuments: () => Promise<void>;
    /** Called when a filter is toggled */
    onToggleFilter: (filterId: FilterId) => void;
    /** Called to create a new chat room */
    createChatRoom: () => void;
    /** Called to create a new room */
    createRoom: () => void;
    /**
     * Get view model for a specific room (virtualization API)
     * Allow undefined to be returned if we don't have a view model for the room. In this case the room will not be rendered.
     */
    getRoomItemViewModel: (roomId: string) => RoomListItemViewModel | undefined;
    /**
     * Called when the rendered range changes (virtualization API). Indices are in room-index
     * space (section header entries excluded): startIndex is inclusive, endIndex exclusive.
     */
    updateVisibleRooms: (startIndex: number, endIndex: number) => void;
    /**
     * Called when the last genuinely-visible item index changes (excluding the rendered
     * overscan buffer), used to decide whether unread activity is below the fold.
     */
    updateVisibleFold: (visibleEndIndex: number) => void;
    /** Get view model for a specific section header (virtualization API) */
    getSectionHeaderViewModel: (sectionId: string) => RoomListSectionHeaderViewModel;
    /** Called to close the toast message */
    closeToast: () => void;
    /** Called to scroll the next unread room below the visible area of the list into view */
    scrollToUnreadActivity: () => void;
    /**
     * Registers (or, with `undefined`, clears) the imperative scroll handler the view model
     * uses to scroll a virtualized item index into view. The view owns the scroll handle, so
     * it provides this on mount; the view model calls it in response to user actions such as
     * clicking the "unread activity" toast.
     */
    setScrollToIndex: (scrollToIndex: ((index: number) => void) | undefined) => void;
    /** Called to change the section of a room */
    changeRoomSection: (roomId: string, tag: string) => void;
    /** Called to change the order of sections */
    changeSectionOrder: (sourceTag: string, targetTag: string) => void;
    /** Called when a section drag starts — collapses all sections */
    onSectionOrRoomDragStart: () => void;
    /** Called when a section drag ends (drop or cancel) — restores expansion states */
    onSectionOrRoomDragEnd: () => void;
}

/**
 * The view model type for the room list view
 */
export type RoomListViewModel = ViewModel<RoomListViewSnapshot, RoomListViewActions>;

/**
 * Props for RoomListView component
 */
export interface RoomListViewProps {
    /** The view model containing all data and callbacks */
    vm: RoomListViewModel;
    /** Render function for room avatar */
    renderAvatar: (room: Room) => ReactNode;
    /** Optional callback for keyboard events on the room list */
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Room list view component that manages filters, loading states, empty states, and the room list.
 */
export const RoomListView: React.FC<RoomListViewProps> = ({ vm, renderAvatar, onKeyDown }): JSX.Element => {
    const snapshot = useViewModel(vm);
    let listBody: ReactNode;

    if (snapshot.spaceContent === "docs") {
        const documents = snapshot.spaceDocuments;
        listBody = (
            <section className={styles.documents} aria-label={_t("matcha_space_docs|document_list")}>
                <Button
                    className={styles.newDocument}
                    kind="secondary"
                    size="md"
                    Icon={PlusIcon}
                    disabled={!documents?.canEdit || documents.busy}
                    onClick={() => void vm.createSpaceDocument()}
                >
                    {_t("matcha_space_docs|new_document")}
                </Button>
                {documents?.error && (
                    <div className={styles.documentNotice} role="alert">
                        <Text size="sm">{documents.error}</Text>
                        <Button kind="tertiary" size="md" onClick={() => void vm.retrySpaceDocuments()}>
                            {_t("action|retry")}
                        </Button>
                    </div>
                )}
                {documents?.sync && ["saving", "offline", "error"].includes(documents.sync) && (
                    <Text size="sm" role="status" className={styles.documentNotice}>
                        {documents.sync === "saving"
                            ? _t("matcha_docs|saving")
                            : documents.sync === "offline"
                              ? _t("matcha_docs|offline")
                              : _t("matcha_docs|unsaved")}
                    </Text>
                )}
                {documents?.loading && (
                    <Text size="sm" role="status" className={styles.documentNotice}>
                        {_t("matcha_space_docs|catalog_loading")}
                    </Text>
                )}
                {!documents?.loading && !documents?.error && !documents?.items.length && (
                    <Text size="sm" className={styles.documentNotice}>
                        {_t("matcha_space_docs|empty")}
                    </Text>
                )}
                <ul className={styles.documentList}>
                    {documents?.items.map((document) => (
                        <li key={document.id} className={styles.documentRow}>
                            <Button
                                kind="tertiary"
                                size="md"
                                Icon={DocumentIcon}
                                className={styles.documentLink}
                                title={document.name}
                                aria-current={document.id === documents.selectedId ? "page" : undefined}
                                onClick={() => vm.openSpaceDocument(document.id)}
                            >
                                <span>{document.name}</span>
                            </Button>
                            {documents.canEdit && (
                                <IconButton
                                    className={styles.documentRename}
                                    size="32px"
                                    tooltip={_t("matcha_space_docs|rename_named_document", { name: document.name })}
                                    disabled={documents.busy}
                                    onClick={() => void vm.renameSpaceDocument(document.id)}
                                >
                                    <EditIcon />
                                </IconButton>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
        );
    } else if (snapshot.isLoadingRooms) {
        listBody = <RoomListLoadingSkeleton />;
    } else if (snapshot.isRoomListEmpty) {
        listBody = <RoomListEmptyStateView vm={vm} />;
    } else {
        listBody = <VirtualizedRoomListView vm={vm} renderAvatar={renderAvatar} onKeyDown={onKeyDown} />;
    }

    return (
        <>
            <div hidden={snapshot.spaceContent === "docs"}>
                <RoomListPrimaryFilters
                    filterIds={snapshot.filterIds}
                    activeFilterId={snapshot.activeFilterId}
                    onToggleFilter={vm.onToggleFilter}
                />
            </div>
            {snapshot.spaceContent && (
                <nav className={styles.spaceContent} aria-label={_t("matcha_space_docs|navigation")}>
                    <Button
                        kind="tertiary"
                        size="md"
                        Icon={ChatIcon}
                        aria-current={snapshot.spaceContent === "chats" ? "page" : undefined}
                        onClick={() => vm.openSpaceContent("chats")}
                    >
                        {_t("matcha_space_docs|chats")}
                    </Button>
                    <Button
                        kind="tertiary"
                        size="md"
                        Icon={DocumentIcon}
                        aria-current={snapshot.spaceContent === "docs" ? "page" : undefined}
                        onClick={() => vm.openSpaceContent("docs")}
                    >
                        {_t("matcha_space_docs|docs")}
                    </Button>
                </nav>
            )}
            <Flex direction="column" className={styles.list}>
                <AutoHideScrollbar className={styles.scrollbar}>
                    {listBody}
                    {snapshot.spaceContent !== "docs" && snapshot.toast && (
                        <RoomListToast
                            type={snapshot.toast}
                            onClose={vm.closeToast}
                            onClick={vm.scrollToUnreadActivity}
                        />
                    )}
                </AutoHideScrollbar>
            </Flex>
        </>
    );
};
