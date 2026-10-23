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

/** The existing authenticated Matrix client and the currently joined chat. */
export interface RoomDocsProps {
    client: MatrixClient;
    room: Room;
    readOnly?: boolean;
}

function errorMessage(error?: RoomDocError): string | undefined {
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
    public constructor(props: RoomDocsProps) {
        super(props, {
            roomName: props.room.name,
            mode: props.readOnly ? "preview" : "edit",
            ready: false,
            canEdit: false,
            sync: "loading",
            pendingUpdates: 0,
            html: "",
        });
        this.session = getRoomDocumentSession(props.client, props.room);
        this.session.addEventListener("change", this.publish);
        this.disposables.track(() => {
            this.session.removeEventListener("change", this.publish);
            this.session.release();
        });
        this.disposables.trackListener(props.room, RoomEvent.Name, this.publish);
        this.publish();
    }
    private publish = (): void => {
        if (this.isDisposed) return;
        const state = this.session.getState();
        this.snapshot.merge({
            ...state,
            canEdit: state.canEdit && !this.props.readOnly,
            roomName: this.props.room.name,
            error: errorMessage(state.error),
            html: this.getSnapshot().mode === "preview" ? renderMarkdown(this.getMarkdown()) : this.getSnapshot().html,
        });
    };
    /** Shared text passed directly to the official Yjs CodeMirror binding. */
    public getText = (): Y.Text => this.session.text;
    /** Includes local unsent edits, so the user can download/copy recovery text. */
    public getMarkdown = (): string => this.session.text.toJSON();
    public setMode = (mode: "edit" | "preview"): void => {
        this.snapshot.merge({ mode });
        this.publish();
    };
    public retry = async (): Promise<void> => {
        await this.session.retry();
        await this.session.flush();
        this.publish();
    };
}
