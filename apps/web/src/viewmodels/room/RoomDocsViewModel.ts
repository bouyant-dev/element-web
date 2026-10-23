/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { BaseViewModel, type RoomDocsSnapshot, type RoomDocsActions } from "@element-hq/web-shared-components";
import { RoomEvent, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import type * as Y from "yjs";

import { getRoomDocumentSession, type RoomDocumentSession, type RoomDocError } from "../../utils/matcha/documents";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { _t } from "../../languageHandler";
import { SpaceDocumentCatalog } from "../../utils/matcha/documentCatalog";

/** The existing authenticated Matrix client and the currently joined chat. */
export interface RoomDocsProps {
    client: MatrixClient;
    room: Room;
    readOnly?: boolean;
    documentId?: string;
}

/** Shared recovery messages for document contents and the encrypted document list. */
export function documentErrorMessage(error?: RoomDocError): string | undefined {
    switch (error) {
        case "load_error":
            return _t("matcha_docs|load_error");
        case "decrypt_error":
            return _t("matcha_docs|decrypt_error");
        case "invalid_update":
            return _t("matcha_docs|invalid_update");
        case "incomplete_update":
            return _t("matcha_docs|incomplete_update");
        case "permission_error":
            return _t("matcha_docs|permission_error");
        case "send_error":
            return _t("matcha_docs|send_error");
        case "too_large_error":
            return _t("matcha_docs|too_large_error");
        case "anchor_error":
            return _t("matcha_docs|anchor_error");
    }
}

/** Bridges the shared Markdown editor/preview to the persistent in-memory room session. */
export class RoomDocsViewModel extends BaseViewModel<RoomDocsSnapshot, RoomDocsProps> implements RoomDocsActions {
    private readonly session: RoomDocumentSession;
    private readonly catalog?: SpaceDocumentCatalog;
    private previewTimer?: ReturnType<typeof setTimeout>;
    private renderedMarkdown?: string;
    public constructor(props: RoomDocsProps) {
        super(props, {
            roomName: props.room.name,
            mode: props.readOnly ? "preview" : "split",
            ready: false,
            canEdit: false,
            sync: "loading",
            pendingUpdates: 0,
            html: "",
        });
        this.session = getRoomDocumentSession(props.client, props.room, props.documentId ?? "main");
        if (props.room.isSpaceRoom()) {
            this.catalog = new SpaceDocumentCatalog(props.client, props.room);
            this.catalog.addEventListener("change", this.publish);
            this.disposables.track(() => {
                this.catalog?.removeEventListener("change", this.publish);
                this.catalog?.release();
            });
        }
        this.session.addEventListener("change", this.publish);
        this.disposables.track(() => {
            this.session.removeEventListener("change", this.publish);
            this.session.release();
            clearTimeout(this.previewTimer);
        });
        this.disposables.trackListener(props.room, RoomEvent.Name, this.publish);
        this.publish();
    }
    private publish = (): void => {
        if (this.isDisposed) return;
        const state = this.session.getState();
        const catalog = this.catalog?.getState();
        const document = catalog?.documents.find(({ id }) => id === (this.props.documentId ?? "main"));
        const missingDocument = catalog?.ready && !document;
        const error =
            documentErrorMessage(catalog?.error ?? state.error) ??
            (missingDocument ? _t("matcha_space_docs|not_found") : undefined);
        const markdown = this.getMarkdown();
        this.snapshot.merge({
            ...state,
            ready: state.ready && (!catalog || (catalog.ready && !!document)),
            canEdit: state.canEdit && !this.props.readOnly && (!catalog || (catalog.canEdit && !!document)),
            sync: error ? "error" : catalog && catalog.sync !== "saved" ? catalog.sync : state.sync,
            pendingUpdates: state.pendingUpdates + (catalog?.pendingUpdates ?? 0),
            documentName: catalog ? (document?.title ?? _t("matcha_space_docs|default_name")) : undefined,
            roomName: this.props.room.name,
            error,
            wordCount: markdown.trim() ? markdown.trim().split(/\s+/u).length : 0,
            characterCount: markdown.length,
        });
        if (this.getSnapshot().mode !== "edit" && markdown !== this.renderedMarkdown) {
            clearTimeout(this.previewTimer);
            if (this.renderedMarkdown === undefined) this.renderPreview();
            else this.previewTimer = setTimeout(this.renderPreview, 150);
        }
    };
    private renderPreview = (): void => {
        if (this.isDisposed || this.getSnapshot().mode === "edit") return;
        const markdown = this.getMarkdown();
        this.renderedMarkdown = markdown;
        this.snapshot.merge({ html: renderMarkdown(markdown) });
    };
    /** Shared text passed directly to the official Yjs CodeMirror binding. */
    public getText = (): Y.Text => this.session.text;
    /** Includes local unsent edits, so the user can download/copy recovery text. */
    public getMarkdown = (): string => this.session.text.toJSON();
    public setMode = (mode: "edit" | "split" | "preview"): void => {
        clearTimeout(this.previewTimer);
        this.snapshot.merge({ mode });
        this.publish();
        this.renderPreview();
    };
    public retry = async (): Promise<void> => {
        await this.catalog?.retry();
        await this.session.retry();
        await this.session.flush();
        this.publish();
    };
}
