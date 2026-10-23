/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Form, Text } from "@vector-im/compound-web";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import styles from "./RoomReminderView.module.css";

/** Units accepted by the reminder form and durable bot. */
export type ReminderUnit = "s" | "m" | "h" | "d";

/** The reminder draft, kept separate from its Matrix command. */
export interface RoomReminderSnapshot {
    mode: "in" | "at";
    duration: string;
    unit: ReminderUnit;
    dateTime: string;
    message: string;
    timezone: string;
    canSubmit: boolean;
    error?: string;
}

/** Input actions; validation and time conversion belong to the host view model. */
export interface RoomReminderActions {
    setMode: (mode: "in" | "at") => void;
    setDuration: (duration: string) => void;
    setUnit: (unit: ReminderUnit) => void;
    setDateTime: (dateTime: string) => void;
    setMessage: (message: string) => void;
    submit: () => void;
}

/** Contract consumed by the reminder form. */
export type RoomReminderViewModel = ViewModel<RoomReminderSnapshot, RoomReminderActions>;

/** A labelled reminder form for either a duration or a precise local date and time. */
export function RoomReminderView({ vm }: { vm: RoomReminderViewModel }): JSX.Element {
    const state = useViewModel(vm);
    return (
        <Form.Root
            className={styles.form}
            onSubmit={(event) => {
                event.preventDefault();
                vm.submit();
            }}
        >
            <Text size="sm" className={styles.hint}>
                {_t("matcha_reminders|room_hint")}
            </Text>
            <label className={styles.field}>
                <Text as="span" size="sm" weight="medium">
                    {_t("matcha_reminders|when")}
                </Text>
                <select value={state.mode} onChange={(event) => vm.setMode(event.target.value as "in" | "at")}>
                    <option value="in">{_t("matcha_reminders|in")}</option>
                    <option value="at">{_t("matcha_reminders|at")}</option>
                </select>
            </label>
            {state.mode === "in" ? (
                <div className={styles.duration}>
                    <Form.Field name="reminder-duration">
                        <Form.Label>{_t("matcha_reminders|duration")}</Form.Label>
                        <Form.TextControl
                            type="number"
                            min="1"
                            max="31536000"
                            step="1"
                            required
                            value={state.duration}
                            onChange={(event) => vm.setDuration(event.target.value)}
                        />
                    </Form.Field>
                    <label className={styles.field}>
                        <Text as="span" size="sm" weight="medium">
                            {_t("matcha_reminders|unit")}
                        </Text>
                        <select value={state.unit} onChange={(event) => vm.setUnit(event.target.value as ReminderUnit)}>
                            <option value="s">{_t("matcha_reminders|seconds")}</option>
                            <option value="m">{_t("matcha_reminders|minutes")}</option>
                            <option value="h">{_t("matcha_reminders|hours")}</option>
                            <option value="d">{_t("matcha_reminders|days")}</option>
                        </select>
                    </label>
                </div>
            ) : (
                <Form.Field name="reminder-date-time">
                    <Form.Label>{_t("matcha_reminders|date_time")}</Form.Label>
                    <Form.TextControl
                        type="datetime-local"
                        step="1"
                        required
                        value={state.dateTime}
                        onChange={(event) => vm.setDateTime(event.target.value)}
                    />
                    <Text size="sm" className={styles.hint}>
                        {_t("matcha_reminders|timezone", { timezone: state.timezone })}
                    </Text>
                </Form.Field>
            )}
            <label className={styles.field}>
                <Text as="span" size="sm" weight="medium">
                    {_t("matcha_reminders|message")}
                </Text>
                <textarea
                    rows={3}
                    maxLength={2000}
                    required
                    value={state.message}
                    onChange={(event) => vm.setMessage(event.target.value)}
                />
            </label>
            {state.error && (
                <Text size="sm" role="alert" className={styles.error}>
                    {state.error}
                </Text>
            )}
        </Form.Root>
    );
}
