/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, type ReactNode, type MouseEventHandler } from "react";
import { Button, Heading, Text } from "@vector-im/compound-web";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import { MarkdownViewerView } from "../right-panel/MarkdownViewerView";
import styles from "./RoomDocsView.module.css";

/** Shared document state; the host sanitizes html before publishing it. */
export interface RoomDocsSnapshot {
    roomName: string;
    documentName?: string;
    mode: "edit" | "preview";
    ready: boolean;
    canEdit: boolean;
    sync: "loading" | "saved" | "saving" | "offline" | "error";
    pendingUpdates: number;
    html: string;
    error?: string;
}

/** Document navigation and recovery actions. */
export interface RoomDocsActions {
    setMode: (mode: "edit" | "preview") => void;
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

/** A stable editor slot and safe Markdown preview, with explicit save status. */
export function RoomDocsView({
    vm,
    editor,
    onDownload,
    onContentClick,
    readOnlyMessage,
}: {
    vm: RoomDocsViewModel;
    editor: ReactNode;
    onDownload: () => void;
    onContentClick?: MouseEventHandler<HTMLDivElement>;
    readOnlyMessage?: string;
}): JSX.Element {
    const state = useViewModel(vm);
    return (
        <section className={styles.container} aria-label={_t("matcha_docs|title")}>
            <header className={styles.header}>
                <div>
                    <Heading as="h2" size="md">
                        {state.documentName ?? _t("matcha_docs|title")}
                    </Heading>
                    <Text size="sm" className={styles.subtitle}>
                        {_t("matcha_docs|subtitle", { room: state.roomName })}
                    </Text>
                </div>
                <Text size="sm" role="status" className={styles.status}>
                    {syncLabel(state.sync)}
                </Text>
            </header>
            <div className={styles.toolbar}>
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
                        aria-pressed={state.mode === "preview"}
                        onClick={() => vm.setMode("preview")}
                    >
                        {_t("matcha_docs|preview")}
                    </Button>
                </div>
                <Button kind="tertiary" size="md" onClick={onDownload}>
                    {_t("matcha_docs|download")}
                </Button>
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
                <Text size="sm" className={styles.notice}>
                    {readOnlyMessage ?? _t("matcha_docs|read_only")}
                </Text>
            )}
            <div className={styles.body}>
                <div className={styles.editor} hidden={state.mode !== "edit"}>
                    {editor}
                </div>
                {state.mode === "preview" &&
                    (state.ready && !state.html ? (
                        <Text className={styles.notice}>{_t("matcha_docs|empty")}</Text>
                    ) : (
                        <MarkdownViewerView
                            status={state.ready ? "ready" : "loading"}
                            html={state.html}
                            onContentClick={onContentClick}
                        />
                    ))}
            </div>
            <Text size="sm" className={styles.footer}>
                {_t("matcha_docs|hint")}
            </Text>
        </section>
    );
}
