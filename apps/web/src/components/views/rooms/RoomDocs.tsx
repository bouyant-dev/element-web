/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import {
    RoomDocsView,
    useCreateAutoDisposedViewModel,
    useViewModel,
    type DocFormatCommand,
} from "@element-hq/web-shared-components";
import { EditorState, Compartment } from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
    placeholder,
    highlightActiveLine,
    highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { UndoManager } from "yjs";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { RoomDocsViewModel } from "../../../viewmodels/room/RoomDocsViewModel";
import { tryTransformPermalinkToLocalHref } from "../../../utils/permalinks/Permalinks";
import { formatMarkdown } from "../../../utils/matcha/markdownCommands";

const markdownHighlighting = HighlightStyle.define([
    {
        tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
        color: "var(--cpd-color-text-action-accent)",
        fontWeight: "700",
    },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: [tags.link, tags.url], color: "var(--cpd-color-text-link-external)", textDecoration: "underline" },
    { tag: [tags.monospace, tags.string], color: "var(--cpd-color-text-success-primary)" },
    { tag: [tags.quote, tags.comment], color: "var(--cpd-color-text-secondary)", fontStyle: "italic" },
    {
        tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.list],
        color: "var(--cpd-color-text-secondary)",
    },
]);

function MarkdownEditor({
    vm,
    editable,
    onReady,
}: {
    vm: RoomDocsViewModel;
    editable: boolean;
    onReady: (format: (command: DocFormatCommand) => void) => void;
}): JSX.Element {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const [permissions] = useState(() => new Compartment());
    useEffect(() => {
        const text = vm.getText();
        const undoManager = new UndoManager(text);
        const runFormat = (command: DocFormatCommand): boolean => {
            const state = vm.getSnapshot();
            if (!state.ready) return false;
            if (command === "find") return openSearchPanel(editor);
            if (!state.canEdit || editor.state.readOnly) return false;
            undoManager.stopCapturing();
            if (command === "undo") undoManager.undo();
            else if (command === "redo") undoManager.redo();
            else formatMarkdown(editor, command);
            undoManager.stopCapturing();
            editor.focus();
            return true;
        };
        const editor = new EditorView({
            parent: host.current!,
            state: EditorState.create({
                doc: vm.getMarkdown(),
                extensions: [
                    permissions.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
                    markdown(),
                    syntaxHighlighting(markdownHighlighting),
                    EditorState.allowMultipleSelections.of(true),
                    lineNumbers(),
                    highlightActiveLine(),
                    highlightActiveLineGutter(),
                    highlightSelectionMatches(),
                    drawSelection(),
                    EditorView.lineWrapping,
                    placeholder(_t("matcha_docs|placeholder")),
                    keymap.of([
                        { key: "Mod-b", run: () => runFormat("bold"), preventDefault: true },
                        { key: "Mod-i", run: () => runFormat("italic"), preventDefault: true },
                        { key: "Mod-k", run: () => runFormat("link"), preventDefault: true },
                        ...yUndoManagerKeymap.map((binding) => ({
                            ...binding,
                            run: (target: EditorView) =>
                                vm.getSnapshot().canEdit && !target.state.readOnly && !!binding.run?.(target),
                            shift: binding.shift
                                ? (target: EditorView) =>
                                      vm.getSnapshot().canEdit && !target.state.readOnly && !!binding.shift?.(target)
                                : undefined,
                        })),
                        ...searchKeymap,
                        indentWithTab,
                        ...defaultKeymap,
                    ]),
                    yCollab(text, undefined, { undoManager }),
                    EditorView.contentAttributes.of({
                        "aria-label": _t("matcha_docs|editor_label"),
                        "aria-multiline": "true",
                        "aria-description": _t("matcha_docs|keyboard_help"),
                    }),
                    EditorView.theme({
                        "&": {
                            height: "100%",
                            background: "var(--cpd-color-bg-canvas-default)",
                            color: "var(--cpd-color-text-primary)",
                        },
                        ".cm-scroller": {
                            overflow: "auto",
                            fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
                            fontSize: "14px",
                            lineHeight: "1.8",
                        },
                        ".cm-content": {
                            padding: "var(--cpd-space-6x) var(--cpd-space-4x)",
                            minHeight: "100%",
                            caretColor: "var(--cpd-color-text-primary)",
                        },
                        ".cm-gutters": {
                            background: "var(--cpd-color-bg-canvas-default)",
                            color: "var(--cpd-color-text-secondary)",
                            border: "none",
                        },
                        ".cm-gutterElement": { padding: "0 var(--cpd-space-3x) 0 var(--cpd-space-4x)" },
                        ".cm-activeLine, .cm-activeLineGutter": { background: "var(--cpd-color-bg-subtle-secondary)" },
                        ".cm-activeLineGutter": { color: "var(--cpd-color-text-primary)" },
                        ".cm-selectionMatch, .cm-searchMatch": {
                            background: "var(--cpd-color-bg-subtle-primary)",
                            outline: "1px solid var(--cpd-color-border-interactive-primary)",
                        },
                        ".cm-searchMatch-selected": {
                            background: "var(--cpd-color-bg-action-primary-rest)",
                            color: "var(--cpd-color-text-on-solid-primary)",
                        },
                        ".cm-panels": {
                            background: "var(--cpd-color-bg-canvas-default)",
                            color: "var(--cpd-color-text-primary)",
                        },
                        ".cm-panels-bottom": { borderTop: "1px solid var(--cpd-color-border-interactive-secondary)" },
                        ".cm-search": {
                            padding: "var(--cpd-space-3x) var(--cpd-space-4x)",
                            fontFamily: "var(--cpd-font-family-sans)",
                            lineHeight: "1.8",
                        },
                        ".cm-textfield": {
                            background: "var(--cpd-color-bg-subtle-secondary)",
                            color: "var(--cpd-color-text-primary)",
                            border: "1px solid var(--cpd-color-border-interactive-secondary)",
                            borderRadius: "var(--cpd-space-1x)",
                            padding: "var(--cpd-space-1x) var(--cpd-space-2x)",
                        },
                        ".cm-button": {
                            background: "var(--cpd-color-bg-subtle-secondary)",
                            color: "var(--cpd-color-text-primary)",
                            border: "1px solid var(--cpd-color-border-interactive-secondary)",
                            borderRadius: "var(--cpd-space-1x)",
                            textTransform: "none",
                        },
                        ".cm-cursor": { borderLeftColor: "var(--cpd-color-text-primary)" },
                        ".cm-selectionBackground": { background: "var(--cpd-color-bg-subtle-primary) !important" },
                        "&.cm-focused": { outline: "none" },
                    }),
                ],
            }),
        });
        view.current = editor;
        onReady(runFormat);
        return () => {
            view.current = null;
            onReady(() => {});
            editor.destroy();
            undoManager.destroy();
        };
    }, [vm, permissions, onReady]);
    useEffect(() => {
        view.current?.dispatch({
            effects: permissions.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
        });
    }, [editable, permissions]);
    return <div ref={host} style={{ height: "100%" }} />;
}

/** Bind the room's encrypted collaborative document to the open-source Markdown editor. */
export function RoomDocs({
    room,
    readOnly = false,
    documentId = "main",
}: {
    room: Room;
    readOnly?: boolean;
    documentId?: string;
}): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new RoomDocsViewModel({ room, client, readOnly, documentId }));
    const state = useViewModel(vm);
    const format = useRef<(command: DocFormatCommand) => void>(() => {});
    const onEditorReady = useCallback((runFormat: (command: DocFormatCommand) => void): void => {
        format.current = runFormat;
    }, []);
    const onFormat = (command: DocFormatCommand): void => {
        if (state.mode === "preview") {
            vm.setMode("edit");
            requestAnimationFrame(() => format.current(command));
        } else format.current(command);
    };
    const download = (): void => {
        const url = URL.createObjectURL(new Blob([vm.getMarkdown()], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = state.documentName ? `${state.documentName.replace(/[\\/:*?"<>|]/g, "-")}.md` : "room-docs.md";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const onContentClick = (event: MouseEvent<HTMLDivElement>): void => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        const localHref = tryTransformPermalinkToLocalHref(link.href);
        if (localHref !== link.href) {
            event.preventDefault();
            window.location.hash = localHref;
        }
    };
    return (
        <RoomDocsView
            vm={vm}
            editor={<MarkdownEditor vm={vm} editable={state.ready && state.canEdit} onReady={onEditorReady} />}
            onFormat={onFormat}
            onDownload={download}
            onContentClick={onContentClick}
            readOnlyMessage={readOnly ? _t("matcha_docs|legacy_read_only") : undefined}
        />
    );
}
