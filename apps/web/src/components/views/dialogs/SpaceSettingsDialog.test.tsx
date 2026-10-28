/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";
import { Room, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import SpaceSettingsDialog, { SpaceSettingsTab } from "./SpaceSettingsDialog";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import SdkConfig from "../../../SdkConfig";
import DMRoomMap from "../../../utils/DMRoomMap";

describe("<SpaceSettingsDialog />", () => {
    let client: MatrixClient;
    let space: Room;

    const renderDialog = (): ReturnType<typeof render> =>
        render(<SpaceSettingsDialog matrixClient={client} space={space} onFinished={vi.fn()} />);

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        space = new Room("!space:server", client, client.getSafeUserId());
        space.name = "Crew";
        vi.spyOn(space, "isSpaceRoom").mockReturnValue(true);
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getUserIdForRoomId: vi.fn() } as unknown as DMRoomMap);
    });

    afterEach(() => {
        SdkConfig.reset();
        vi.restoreAllMocks();
    });

    it("does not render the emoji tab without Matcha features", () => {
        renderDialog();
        expect(screen.queryByTestId(`settings-tab-${SpaceSettingsTab.Emoji}`)).not.toBeInTheDocument();
    });

    it("renders the Space's emoji pack when Matcha features are on", () => {
        SdkConfig.add({ matcha_thread_tabs: true });
        renderDialog();
        fireEvent.click(screen.getByTestId(`settings-tab-${SpaceSettingsTab.Emoji}`));
        expect(
            screen.getByText(/Upload custom emoji for everyone in this space\. They work in every room of the space/),
        ).toBeInTheDocument();
    });
});
