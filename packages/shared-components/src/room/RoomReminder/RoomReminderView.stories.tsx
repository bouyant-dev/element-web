/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RoomReminderView, type RoomReminderSnapshot, type ReminderUnit } from "./RoomReminderView";
import { useMockedViewModel } from "../../core/viewmodel";

const initial: RoomReminderSnapshot = {
    mode: "in",
    duration: "10",
    unit: "m",
    dateTime: "2026-10-24T09:00:00",
    message: "Review the release checklist",
    timezone: "Asia/Jakarta",
    canSubmit: true,
};

function ReminderStory({ mode = "in" }: { mode?: "in" | "at" }) {
    const [state, setState] = useState({ ...initial, mode });
    const vm = useMockedViewModel(state, {
        setMode: (mode: "in" | "at") => setState((value) => ({ ...value, mode })),
        setDuration: (duration: string) => setState((value) => ({ ...value, duration })),
        setUnit: (unit: ReminderUnit) => setState((value) => ({ ...value, unit })),
        setDateTime: (dateTime: string) => setState((value) => ({ ...value, dateTime })),
        setMessage: (message: string) => setState((value) => ({ ...value, message })),
        submit: fn(),
    });
    return (
        <div style={{ maxWidth: 480 }}>
            <RoomReminderView vm={vm} />
        </div>
    );
}

const meta = { title: "Room/RoomReminder", component: RoomReminderView } satisfies Meta<typeof RoomReminderView>;
export default meta;
/** Remind after a clearly selected duration. */
export const In: StoryObj = { render: () => <ReminderStory /> };
/** Remind at a precise local date and time. */
export const At: StoryObj = { render: () => <ReminderStory mode="at" /> };
