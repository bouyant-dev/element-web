/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type RoomReminderSnapshot,
    type RoomReminderActions,
    type ReminderUnit,
} from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";

/** A precise requested deadline and the separate user-facing message. */
export interface ReminderDraft {
    at: number;
    message: string;
    delaySeconds?: number;
}

/** Optional starting values supplied by a card or room. */
export interface RoomReminderProps {
    initial?: { at?: number; message?: string };
    onFinished: (confirmed: boolean, draft?: ReminderDraft) => void;
    now?: () => number;
}

const MAX_DELAY = 365 * 86400 * 1000;
const units: Record<ReminderUnit, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function localDateTime(at: number): string {
    const date = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Validate again at the send boundary, since the dialog may stay open past its selected time. */
export function isValidReminderDraft(draft: ReminderDraft, now = Date.now()): boolean {
    if (draft.delaySeconds !== undefined && (!Number.isSafeInteger(draft.delaySeconds) || draft.delaySeconds <= 0))
        return false;
    const at = draft.delaySeconds === undefined ? draft.at : now + draft.delaySeconds * 1000;
    return (
        Number.isSafeInteger(at) &&
        at > now &&
        at - now <= MAX_DELAY &&
        typeof draft.message === "string" &&
        draft.message.trim().length > 0 &&
        draft.message.trim().length <= 2000
    );
}

/** Converts the two clear scheduling controls into a bounded, unambiguous request. */
export class RoomReminderViewModel
    extends BaseViewModel<RoomReminderSnapshot, RoomReminderProps>
    implements RoomReminderActions
{
    private finished = false;

    public constructor(props: RoomReminderProps) {
        const now = (props.now ?? Date.now)();
        const initialAt = props.initial?.at;
        super(props, {
            mode: Number.isSafeInteger(initialAt) ? "at" : "in",
            duration: "10",
            unit: "m",
            dateTime: localDateTime(Number.isSafeInteger(initialAt) ? initialAt! : now + 600_000),
            message: props.initial?.message ?? "",
            timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
            canSubmit: false,
        });
        this.validate();
    }

    private draft = (): ReminderDraft => {
        const state = this.getSnapshot();
        const now = (this.props.now ?? Date.now)();
        let at = NaN;
        let delaySeconds: number | undefined;
        if (state.mode === "in" && /^[1-9]\d{0,8}$/.test(state.duration)) {
            delaySeconds = (Number(state.duration) * units[state.unit]) / 1000;
            at = now + delaySeconds * 1000;
        } else if (state.mode === "at" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(state.dateTime)) {
            const parsed = new Date(state.dateTime);
            // Reject normalized invalid dates and nonexistent local times, including DST gaps.
            if (Number.isFinite(parsed.getTime()) && localDateTime(parsed.getTime()).startsWith(state.dateTime))
                at = parsed.getTime();
        }
        return { at, message: state.message.trim(), ...(delaySeconds !== undefined ? { delaySeconds } : {}) };
    };

    private validate = (): void => {
        const draft = this.draft();
        const canSubmit = isValidReminderDraft(draft, (this.props.now ?? Date.now)());
        this.snapshot.merge({
            canSubmit,
            error: !canSubmit && draft.message ? _t("matcha_reminders|validation_invalid") : undefined,
        });
    };
    public setMode = (mode: "in" | "at"): void => {
        this.snapshot.merge({ mode });
        this.validate();
    };
    public setDuration = (duration: string): void => {
        this.snapshot.merge({ duration });
        this.validate();
    };
    public setUnit = (unit: ReminderUnit): void => {
        this.snapshot.merge({ unit });
        this.validate();
    };
    public setDateTime = (dateTime: string): void => {
        this.snapshot.merge({ dateTime });
        this.validate();
    };
    public setMessage = (message: string): void => {
        this.snapshot.merge({ message });
        this.validate();
    };
    public cancel = (): void => {
        if (this.finished) return;
        this.finished = true;
        this.props.onFinished(false);
    };
    public submit = (): void => {
        if (this.finished) return;
        const draft = this.draft();
        if (!isValidReminderDraft(draft, (this.props.now ?? Date.now)())) {
            this.snapshot.merge({ canSubmit: false, error: _t("matcha_reminders|validation_invalid") });
            return;
        }
        this.finished = true;
        this.props.onFinished(true, draft);
    };
}
