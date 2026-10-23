/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { RoomReminderView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";

import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import { _t } from "../../../languageHandler";
import { RoomReminderViewModel, type RoomReminderProps } from "../../../viewmodels/room/RoomReminderViewModel";

/** Hosts the shared reminder controls in Element's existing accessible modal shell. */
export function RoomReminderDialog(props: RoomReminderProps): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new RoomReminderViewModel(props));
    const state = useViewModel(vm);
    return (
        <BaseDialog title={_t("matcha_reminders|title")} onFinished={vm.cancel}>
            <RoomReminderView vm={vm} />
            <DialogButtons
                primaryButton={_t("matcha_reminders|schedule")}
                primaryDisabled={!state.canSubmit}
                hasCancel
                onCancel={vm.cancel}
                onPrimaryButtonClick={vm.submit}
            />
        </BaseDialog>
    );
}
