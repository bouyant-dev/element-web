/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SpaceDocsSetupView, type SpaceDocsSetupSnapshot } from "./SpaceDocsSetupView";
import { useMockedViewModel } from "../../core/viewmodel";

function SetupStory({ overrides }: { overrides?: Partial<SpaceDocsSetupSnapshot> }) {
    const vm = useMockedViewModel(
        { spaceName: "Engineering", configured: false, canSetup: true, busy: false, ...overrides },
        { enable: fn(async () => {}), retry: fn(async () => {}) },
    );
    return <SpaceDocsSetupView vm={vm} />;
}
const meta = { title: "Room/SpaceDocsSetup", component: SpaceDocsSetupView } satisfies Meta<typeof SpaceDocsSetupView>;
export default meta;
/** Administrator can review and confirm the one-time setup. */
export const Administrator: StoryObj = { render: () => <SetupStory /> };
/** Ordinary members wait for the administrator and can check status. */
export const Member: StoryObj = { render: () => <SetupStory overrides={{ canSetup: false }} /> };
/** Partial setup remains explicit; no plaintext document is opened. */
export const Incomplete: StoryObj = {
    render: () => (
        <SetupStory
            overrides={{ error: "Setup is incomplete. Encryption may already be enabled and cannot be turned off." }}
        />
    ),
};
