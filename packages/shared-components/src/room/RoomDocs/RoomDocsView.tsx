/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useState, type JSX, type ReactNode, type MouseEventHandler } from "react";
import { Button, Heading, IconButton, Menu, MenuItem, Text } from "@vector-im/compound-web";
import {
    BoldIcon,
    CheckIcon,
    ChevronDownIcon,
    DocumentIcon,
    DownloadIcon,
    InlineCodeIcon,
    ItalicIcon,
    LinkIcon,
    ListBulletedIcon,
    PlusIcon,
    RotateLeftIcon,
    RotateRightIcon,
    SearchIcon,
    StrikethroughIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import { MarkdownViewerView } from "../right-panel/MarkdownViewerView";
import styles from "./RoomDocsView.module.css";

/** Editing commands implemented by the host's Markdown editor. */
export type DocFormatCommand =
    | "bold"
    | "italic"
    | "strike"
    | "heading1"
    | "heading2"
    | "heading3"
    | "bulletList"
    | "orderedList"
    | "taskList"
    | "quote"
    | "inlineCode"
    | "codeBlock"
    | "link"
    | "table"
    | "undo"
    | "redo"
    | "find";

/** Shared document state; the host sanitizes html before publishing it. */
export interface RoomDocsSnapshot {
    roomName: string;
    documentName?: string;
    mode: "edit" | "split" | "preview";
    ready: boolean;
    canEdit: boolean;
    sync: "loading" | "saved" | "saving" | "offline" | "error";
    pendingUpdates: number;
    html: string;
    wordCount?: number;
    characterCount?: number;
    error?: string;
}

/** Document navigation and recovery actions. */
export interface RoomDocsActions {
    setMode: (mode: "edit" | "split" | "preview") => void;
    retry: () => Promise<void>;
}

/** Presentation contract for a room's live Markdown document. */
export type RoomDocsViewModel = ViewModel<RoomDocsSnapshot, RoomDocsActions>;

const syncLabel = (sync: RoomDocsSnapshot["sync"]): string => {
    switch (sync) {
        case "loading":
            return _t("matcha_docs|loading");
        case "saved":
            return _t("matcha_docs|saved");
        case "saving":
            return _t("matcha_docs|saving");
        case "offline":
            return _t("matcha_docs|offline");
        case "error":
            return _t("matcha_docs|unsaved");
    }
};

function FormatMenu({
    label,
    trigger,
    commands,
    disabled,
    onFormat,
}: {
    label: string;
    trigger: ReactNode;
    commands: { command: DocFormatCommand; label: string }[];
    disabled: boolean;
    onFormat?: (command: DocFormatCommand) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={label}
            align="start"
            trigger={
                <IconButton size="32px" tooltip={label} disabled={disabled} className={styles.formatMenu}>
                    <span className={styles.menuTrigger}>
                        {trigger}
                        <ChevronDownIcon className={styles.menuChevron} />
                    </span>
                </IconButton>
            }
        >
            {commands.map(({ command, label: commandLabel }) => (
                <MenuItem
                    key={command}
                    label={commandLabel}
                    disabled={disabled}
                    onSelect={() => onFormat?.(command)}
                    hideChevron
                />
            ))}
        </Menu>
    );
}

/** A full-height Markdown workspace with a stable editor and optional live preview beside it. */
export function RoomDocsView({
    vm,
    editor,
    onDownload,
    onFormat,
    onContentClick,
    readOnlyMessage,
}: {
    vm: RoomDocsViewModel;
    editor: ReactNode;
    onDownload: () => void;
    onFormat?: (command: DocFormatCommand) => void;
    onContentClick?: MouseEventHandler<HTMLDivElement>;
    readOnlyMessage?: string;
}): JSX.Element {
    const state = useViewModel(vm);
    const canFormat = state.ready && state.canEdit && !!onFormat;
    const formatButton = (command: DocFormatCommand, label: string, icon: ReactNode): JSX.Element => (
        <IconButton
            key={command}
            size="32px"
            tooltip={label}
            disabled={command === "find" ? !state.ready || !onFormat : !canFormat}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFormat?.(command)}
        >
            {icon}
        </IconButton>
    );

    return (
        <section className={styles.container} aria-label={_t("matcha_docs|title")}>
            <header className={styles.header}>
                <div className={styles.titleBlock}>
                    <Text size="sm" className={styles.breadcrumb}>
                        <DocumentIcon aria-hidden="true" />
                        <span>{state.roomName}</span>
                        <span aria-hidden="true" className={styles.breadcrumbSeparator}>
                            /
                        </span>
                        <span>{_t("matcha_docs|title")}</span>
                    </Text>
                    <Heading as="h2" size="md" className={styles.title}>
                        {state.documentName ?? _t("matcha_docs|title")}
                    </Heading>
                </div>
                <div className={styles.headerActions}>
                    <Text size="sm" role="status" className={styles.status} data-sync={state.sync}>
                        {state.sync === "saved" ? (
                            <CheckIcon aria-hidden="true" />
                        ) : (
                            <span className={styles.statusDot} />
                        )}
                        {syncLabel(state.sync)}
                    </Text>
                    {formatButton("find", _t("matcha_docs|find"), <SearchIcon />)}
                    <IconButton size="32px" tooltip={_t("matcha_docs|download")} onClick={onDownload}>
                        <DownloadIcon />
                    </IconButton>
                </div>
            </header>
            <div className={styles.toolbar}>
                <div
                    className={styles.formatting}
                    role="group"
                    aria-label={_t("matcha_docs|formatting")}
                    hidden={state.mode === "preview"}
                >
                    <div className={styles.formatGroup} role="group" aria-label={_t("matcha_docs|text_style")}>
                        <FormatMenu
                            label={_t("matcha_docs|headings")}
                            trigger={
                                <span className={styles.headingSymbol} aria-hidden="true">
                                    H
                                </span>
                            }
                            commands={[
                                { command: "heading1", label: _t("matcha_docs|heading1") },
                                { command: "heading2", label: _t("matcha_docs|heading2") },
                                { command: "heading3", label: _t("matcha_docs|heading3") },
                            ]}
                            disabled={!canFormat}
                            onFormat={onFormat}
                        />
                        {formatButton("bold", _t("matcha_docs|bold"), <BoldIcon />)}
                        {formatButton("italic", _t("matcha_docs|italic"), <ItalicIcon />)}
                        {formatButton("strike", _t("matcha_docs|strike"), <StrikethroughIcon />)}
                    </div>
                    <div className={styles.formatGroup} role="group" aria-label={_t("matcha_docs|lists")}>
                        <FormatMenu
                            label={_t("matcha_docs|lists")}
                            trigger={<ListBulletedIcon />}
                            commands={[
                                { command: "bulletList", label: _t("matcha_docs|bulletList") },
                                { command: "orderedList", label: _t("matcha_docs|orderedList") },
                                { command: "taskList", label: _t("matcha_docs|taskList") },
                            ]}
                            disabled={!canFormat}
                            onFormat={onFormat}
                        />
                    </div>
                    <div className={styles.formatGroup} role="group" aria-label={_t("matcha_docs|insert")}>
                        {formatButton("link", _t("matcha_docs|link"), <LinkIcon />)}
                        {formatButton("inlineCode", _t("matcha_docs|inlineCode"), <InlineCodeIcon />)}
                        <FormatMenu
                            label={_t("matcha_docs|more_formatting")}
                            trigger={<PlusIcon />}
                            commands={[
                                { command: "quote", label: _t("matcha_docs|quote") },
                                { command: "codeBlock", label: _t("matcha_docs|codeBlock") },
                                { command: "table", label: _t("matcha_docs|table") },
                            ]}
                            disabled={!canFormat}
                            onFormat={onFormat}
                        />
                    </div>
                    <div className={styles.formatGroup} role="group" aria-label={_t("matcha_docs|history")}>
                        {formatButton("undo", _t("matcha_docs|undo"), <RotateLeftIcon />)}
                        {formatButton("redo", _t("matcha_docs|redo"), <RotateRightIcon />)}
                    </div>
                </div>
                <div className={styles.modes} role="group" aria-label={_t("matcha_docs|mode")}>
                    <Button
                        kind="tertiary"
                        size="md"
                        aria-pressed={state.mode === "edit"}
                        onClick={() => vm.setMode("edit")}
                    >
                        {_t("matcha_docs|edit")}
                    </Button>
                    <Button
                        kind="tertiary"
                        size="md"
                        aria-pressed={state.mode === "split"}
                        onClick={() => vm.setMode("split")}
                    >
                        {_t("matcha_docs|split")}
                    </Button>
                    <Button
                        kind="tertiary"
                        size="md"
                        aria-pressed={state.mode === "preview"}
                        onClick={() => vm.setMode("preview")}
                    >
                        {_t("matcha_docs|preview")}
                    </Button>
                </div>
            </div>
            {state.error && (
                <div role="alert" className={styles.notice}>
                    <Text size="sm">{state.error}</Text>
                    <Button kind="secondary" size="md" onClick={() => void vm.retry()}>
                        {_t("action|retry")}
                    </Button>
                </div>
            )}
            {state.ready && !state.canEdit && (
                <Text size="sm" className={styles.readOnly}>
                    {readOnlyMessage ?? _t("matcha_docs|read_only")}
                </Text>
            )}
            <div className={styles.body} data-mode={state.mode}>
                <section
                    className={styles.pane}
                    aria-label={_t("matcha_docs|markdown_source")}
                    hidden={state.mode === "preview"}
                >
                    <div className={styles.paneLabel}>
                        <Text size="sm">{_t("matcha_docs|markdown_source")}</Text>
                        <InlineCodeIcon aria-hidden="true" />
                    </div>
                    <div className={styles.editor}>{editor}</div>
                </section>
                <section
                    className={`${styles.pane} ${styles.previewPane}`}
                    aria-label={_t("matcha_docs|live_preview")}
                    hidden={state.mode === "edit"}
                >
                    <div className={styles.paneLabel}>
                        <Text size="sm">{_t("matcha_docs|live_preview")}</Text>
                        <span className={styles.previewDot} aria-hidden="true" />
                    </div>
                    <div className={styles.preview}>
                        {state.ready && !state.html ? (
                            <div className={styles.emptyPreview}>
                                <DocumentIcon aria-hidden="true" />
                                <Text>{_t("matcha_docs|empty")}</Text>
                            </div>
                        ) : (
                            <MarkdownViewerView
                                className={styles.previewDocument}
                                status={state.ready ? "ready" : "loading"}
                                html={state.html}
                                onContentClick={onContentClick}
                            />
                        )}
                    </div>
                </section>
            </div>
            <footer className={styles.footer}>
                <div className={styles.counts}>
                    {state.wordCount !== undefined && (
                        <span>{_t("matcha_docs|word_count", { count: state.wordCount })}</span>
                    )}
                    {state.characterCount !== undefined && (
                        <span>{_t("matcha_docs|character_count", { count: state.characterCount })}</span>
                    )}
                </div>
                <span className={styles.footerHint} title={_t("matcha_docs|keyboard_help")}>
                    {_t("matcha_docs|markdown_hint")}
                </span>
            </footer>
        </section>
    );
}
