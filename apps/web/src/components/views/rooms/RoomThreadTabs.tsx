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
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { UPDATE_SELECTED_SPACE } from "../../../stores/spaces";
import { spaceForRoomDocuments } from "../../../utils/matcha/spaceDocuments";

/** Connect one room's thread tabs to the existing Matrix client and panel navigation. */
export function RoomThreadTabs({
    room,
    board,
    docs,
    onBoardChange,
    onOpenDocs,
    onOpenLegacyDocs,
}: {
    room: Room;
    board?: "room" | "all";
    docs?: boolean;
    onBoardChange: (board?: "room" | "all", initialThreadId?: string) => void;
    onOpenDocs: () => void;
    onOpenLegacyDocs: () => void;
}): JSX.Element {
    const client = useMatrixClientContext();
    const { rightPanelStore, spaceStore } = useContext(SDKContext);
    const canOpenSpaceDocs = useEventEmitterState(
        spaceStore,
        UPDATE_SELECTED_SPACE,
        () => !!spaceForRoomDocuments(spaceStore, room),
    );
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new RoomThreadTabsViewModel({
                room,
                client,
                rightPanelStore,
                onBoardChange,
                onOpenDocs,
                onOpenLegacyDocs,
                reminderBot: SdkConfig.get("matcha_reminder_bot"),
            }),
    );
    useEffect(() => vm.setBoard(board), [vm, board]);
    useEffect(() => vm.setDocs(!!docs), [vm, docs]);
    useEffect(() => vm.setSpaceDocsAvailable(canOpenSpaceDocs), [vm, canOpenSpaceDocs]);
    return <RoomThreadTabsView vm={vm} />;
}
