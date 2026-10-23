/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { KanbanBoardView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { KanbanBoardViewModel } from "../../../viewmodels/room/KanbanBoardViewModel";

/** Connect a room board, or the current joined-room recap, to Matrix. */
export function KanbanBoard({ room, onOpenRoom }: { room?: Room; onOpenRoom?: () => void }): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new KanbanBoardViewModel({ room, client, onOpenRoom }));
    return <KanbanBoardView vm={vm} />;
}
