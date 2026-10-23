/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { KanbanBoardView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { KanbanBoardViewModel } from "../../../viewmodels/room/KanbanBoardViewModel";
import { SDKContext } from "../../../contexts/SDKContext";
import SdkConfig from "../../../SdkConfig";

/** Connect a room board, or the current joined-room recap, to Matrix. */
export function KanbanBoard({
    room,
    onOpenRoom,
    initialThreadId,
}: {
    room?: Room;
    onOpenRoom?: () => void;
    initialThreadId?: string;
}): JSX.Element {
    const client = useMatrixClientContext();
    const { rightPanelStore } = useContext(SDKContext);
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new KanbanBoardViewModel({
                room,
                client,
                onOpenRoom,
                rightPanelStore,
                initialThreadId,
                reminderBot: SdkConfig.get("matcha_reminder_bot"),
            }),
    );
    return <KanbanBoardView vm={vm} />;
}
