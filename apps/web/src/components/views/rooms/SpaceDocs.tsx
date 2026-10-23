/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { SpaceDocsSetupView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { SpaceDocsViewModel } from "../../../viewmodels/room/SpaceDocsViewModel";
import { RoomDocs } from "./RoomDocs";

/** Never mount the document transport until Space encryption and shared editing permissions are synced. */
export function SpaceDocs({ space }: { space: Room }): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new SpaceDocsViewModel({ space, client }));
    const state = useViewModel(vm);
    return state.configured ? <RoomDocs room={space} /> : <SpaceDocsSetupView vm={vm} />;
}
