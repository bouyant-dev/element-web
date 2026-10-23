/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import React from "react";
import { type Meta, type StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RoomDocsView } from "./RoomDocsView";
import { useMockedViewModel } from "../../core/viewmodel";

function DocsPreview() {
    const vm = useMockedViewModel(
        {
            roomName: "Product studio",
            mode: "preview" as const,
            ready: true,
            canEdit: true,
            sync: "saved" as const,
            pendingUpdates: 0,
            html: "<h1>Release plan</h1><p>A shared place for this chat’s decisions.</p><h2>Next steps</h2><ul><li>Review the navigation</li><li>Try the reminder bot together</li></ul>",
        },
        { setMode: fn(), retry: fn(async () => {}) },
    );
    return (
        <div style={{ height: "600px" }}>
            <RoomDocsView vm={vm} editor={<div />} onDownload={fn()} />
        </div>
    );
}
const meta = { title: "Room/RoomDocs", component: RoomDocsView, parameters: { layout: "fullscreen" } } satisfies Meta<
    typeof RoomDocsView
>;
export default meta;
/** Shared Markdown preview with an explicit saved status. */
export const Preview: StoryObj = { render: () => <DocsPreview /> };
