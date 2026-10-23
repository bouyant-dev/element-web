/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useContext, useEffect, type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { RoomThreadTabsView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { SDKContext } from "../../../contexts/SDKContext";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { RoomThreadTabsViewModel } from "../../../viewmodels/room/RoomThreadTabsViewModel";
import SdkConfig from "../../../SdkConfig";

/** Connect one room's thread tabs to the existing Matrix client and panel navigation. */
export function RoomThreadTabs({
    room,
    board,
    onBoardChange,
}: {
    room: Room;
    board?: "room" | "all";
    onBoardChange: (board?: "room" | "all", initialThreadId?: string) => void;
}): JSX.Element {
    const client = useMatrixClientContext();
    const { rightPanelStore } = useContext(SDKContext);
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new RoomThreadTabsViewModel({
                room,
                client,
                rightPanelStore,
                onBoardChange,
                reminderBot: SdkConfig.get("matcha_reminder_bot"),
            }),
    );
    useEffect(() => vm.setBoard(board), [vm, board]);
    return <RoomThreadTabsView vm={vm} />;
}
