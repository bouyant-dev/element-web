/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, type MouseEvent, useEffect, useRef, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { RoomDocsView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, drawSelection, placeholder } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { UndoManager } from "yjs";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { RoomDocsViewModel } from "../../../viewmodels/room/RoomDocsViewModel";
import { tryTransformPermalinkToLocalHref } from "../../../utils/permalinks/Permalinks";

function MarkdownEditor({ vm, editable }: { vm: RoomDocsViewModel; editable: boolean }): JSX.Element {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const [permissions] = useState(() => new Compartment());
    useEffect(() => {
        const text = vm.getText();
        const undoManager = new UndoManager(text);
        const editor = new EditorView({
            parent: host.current!,
            state: EditorState.create({
                doc: vm.getMarkdown(),
                extensions: [
                    permissions.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
                    markdown(),
                    lineNumbers(),
                    drawSelection(),
                    EditorView.lineWrapping,
                    placeholder(_t("matcha_docs|placeholder")),
                    keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
                    yCollab(text, undefined, { undoManager }),
                    EditorView.contentAttributes.of({
                        "aria-label": _t("matcha_docs|editor_label"),
                        "aria-multiline": "true",
                    }),
                    EditorView.theme({
                        "&": {
                            height: "100%",
                            background: "var(--cpd-color-bg-canvas-default)",
                            color: "var(--cpd-color-text-primary)",
                        },
                        ".cm-scroller": { overflow: "auto", fontFamily: "monospace", lineHeight: "1.7" },
                        ".cm-content": {
                            padding: "var(--cpd-space-5x) var(--cpd-space-4x)",
                            caretColor: "var(--cpd-color-text-primary)",
                        },
                        ".cm-gutters": {
                            background: "var(--cpd-color-bg-canvas-default)",
                            color: "var(--cpd-color-text-secondary)",
                            border: "none",
                        },
                        ".cm-lineNumbers": { paddingTop: "var(--cpd-space-5x)" },
                        ".cm-cursor": { borderLeftColor: "var(--cpd-color-text-primary)" },
                        ".cm-selectionBackground": { background: "var(--cpd-color-bg-subtle-primary) !important" },
                        "&.cm-focused": { outline: "none" },
                    }),
                ],
            }),
        });
        view.current = editor;
        return () => {
            view.current = null;
            editor.destroy();
            undoManager.destroy();
        };
    }, [vm, permissions]);
    useEffect(() => {
        view.current?.dispatch({
            effects: permissions.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
        });
    }, [editable, permissions]);
    return <div ref={host} style={{ height: "100%" }} />;
}

/** Bind the room's encrypted collaborative document to the open-source Markdown editor. */
export function RoomDocs({ room, readOnly = false }: { room: Room; readOnly?: boolean }): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new RoomDocsViewModel({ room, client, readOnly }));
    const state = useViewModel(vm);
    const download = (): void => {
        const url = URL.createObjectURL(new Blob([vm.getMarkdown()], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "room-docs.md";
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
            editor={<MarkdownEditor vm={vm} editable={state.ready && state.canEdit} />}
            onDownload={download}
            onContentClick={onContentClick}
            readOnlyMessage={readOnly ? _t("matcha_docs|legacy_read_only") : undefined}
        />
    );
}
