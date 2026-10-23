/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import Modal from "../../Modal";
import { _t } from "../../languageHandler";
import TextInputDialog from "../../components/views/dialogs/TextInputDialog";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import InfoDialog from "../../components/views/dialogs/InfoDialog";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";

/** Validate a bounded relative reminder without interpreting ambiguous calendar dates. */
export function isValidReminder(value: string): boolean {
    const match = /^(\d+)([smhd])\s+([\s\S]+)$/.exec(value.trim());
    if (!match) return false;
    const seconds = Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 0);
    return (
        Number.isSafeInteger(seconds) &&
        seconds > 0 &&
        seconds <= 365 * 86400 &&
        match[3].trim().length > 0 &&
        match[3].trim().length <= 2000
    );
}

/** Ask for a reminder and send it through the existing encrypted Matrix message path. */
export async function scheduleRoomReminder(client: MatrixClient, room: Room, botUserId: string): Promise<void> {
    try {
        if (!room.maySendMessage()) throw new Error("Cannot send to this room");
        const membership = room.getMember(botUserId)?.membership;
        if (membership !== "join") {
            if (membership !== "invite") {
                if (!room.canInvite(client.getSafeUserId())) throw new Error("Cannot invite the reminder bot");
                const [confirmed] = await Modal.createDialog(QuestionDialog, {
                    title: _t("matcha_reminders|invite_title"),
                    description: _t("matcha_reminders|invite_description", { bot: botUserId }),
                    button: _t("action|invite"),
                }).finished;
                if (!confirmed) return;
                await client.invite(room.roomId, botUserId);
            }
            Modal.createDialog(InfoDialog, {
                title: _t("matcha_reminders|invite_title"),
                description: _t("matcha_reminders|waiting"),
            });
            return;
        }

        const [confirmed, input] = await Modal.createDialog(TextInputDialog, {
            title: _t("matcha_reminders|title"),
            description: _t("matcha_reminders|description"),
            placeholder: _t("matcha_reminders|placeholder"),
            usePlaceholderAsHint: true,
            button: _t("matcha_reminders|schedule"),
            validator: async ({ value }) => ({
                valid: isValidReminder(value ?? ""),
                feedback: isValidReminder(value ?? "") ? undefined : _t("matcha_reminders|invalid"),
            }),
        }).finished;
        if (!confirmed || !input || !isValidReminder(input)) return;
        if (!room.maySendMessage() || room.getMember(botUserId)?.membership !== "join") {
            throw new Error("Room membership changed");
        }
        await client.sendTextMessage(room.roomId, "!remind " + input.trim());
        Modal.createDialog(InfoDialog, {
            title: _t("matcha_reminders|requested_title"),
            description: _t("matcha_reminders|requested_description"),
        });
    } catch {
        Modal.createDialog(ErrorDialog, {
            title: _t("matcha_reminders|error_title"),
            description: _t("matcha_reminders|error_description"),
        });
    }
}
