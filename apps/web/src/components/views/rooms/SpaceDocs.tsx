/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, lazy, Suspense } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { SpaceDocsSetupView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { SpaceDocsViewModel } from "../../../viewmodels/room/SpaceDocsViewModel";
import Spinner from "../elements/Spinner";

// CodeMirror, y-codemirror and marked load only when Docs opens, not at every startup.
const RoomDocs = lazy(() => import("./RoomDocs").then((module) => ({ default: module.RoomDocs })));

/** Never mount the document transport until Space encryption and shared editing permissions are synced. */
export function SpaceDocs({ space, documentId = "main" }: { space: Room; documentId?: string }): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new SpaceDocsViewModel({ space, client }));
    const state = useViewModel(vm);
    return state.configured ? (
        <Suspense fallback={<Spinner />}>
            <RoomDocs key={`${space.roomId}:${documentId}`} room={space} documentId={documentId} />
        </Suspense>
    ) : (
        <SpaceDocsSetupView vm={vm} />
    );
}
