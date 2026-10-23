/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import Modal from "../../Modal";
import { _t } from "../../languageHandler";
import { RoomReminderDialog } from "../../components/views/dialogs/RoomReminderDialog";
import { isValidReminderDraft } from "../../viewmodels/room/RoomReminderViewModel";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import InfoDialog from "../../components/views/dialogs/InfoDialog";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import { resolveThreadRoot } from "./threads";
import { RoomPermalinkCreator } from "../permalinks/Permalinks";

/** Card or room context used to prefill the scheduling controls. */
export interface RoomReminderOptions {
    message?: string;
    at?: number;
    threadId?: string;
}

/** Matrix accepted the command; only the bot's later reply confirms the durable schedule. */
export interface RoomReminderRequest {
    status: "requested";
    eventId: string;
    /** Estimated for a relative delay; the bot's acknowledgement supplies the server-based deadline. */
    at: number;
    message: string;
    threadId?: string;
}

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
export async function scheduleRoomReminder(
    client: MatrixClient,
    room: Room,
    botUserId: string,
    initial: RoomReminderOptions = {},
): Promise<RoomReminderRequest | undefined> {
    try {
        if (room.getMyMembership() !== "join" || !room.maySendMessage()) throw new Error("Cannot send to this room");
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

        let message = initial.message ?? "";
        if (initial.threadId) {
            await resolveThreadRoot(client, room, initial.threadId);
            const link = new RoomPermalinkCreator(room).forEvent(initial.threadId);
            if (!message.includes(link)) message = message ? `${message}\n${link}` : link;
        }
        const [confirmed, draft] = await Modal.createDialog(RoomReminderDialog, {
            initial: { message, at: initial.at },
        }).finished;
        if (!confirmed || !draft) return;
        const now = Date.now();
        if (!isValidReminderDraft(draft, now)) throw new Error("Invalid reminder time or message");
        if (
            room.getMyMembership() !== "join" ||
            !room.maySendMessage() ||
            room.getMember(botUserId)?.membership !== "join"
        ) {
            throw new Error("Room membership changed");
        }
        const at = draft.delaySeconds === undefined ? draft.at : now + draft.delaySeconds * 1000;
        const when = draft.delaySeconds === undefined ? `at ${new Date(at).toISOString()}` : `${draft.delaySeconds}s`;
        const { event_id: eventId } = await client.sendTextMessage(
            room.roomId,
            `!remind ${when} ${draft.message.trim()}`,
        );
        Modal.createDialog(InfoDialog, {
            title: _t("matcha_reminders|requested_title"),
            description: _t("matcha_reminders|requested_description"),
        });
        return {
            status: "requested",
            eventId,
            at,
            message: draft.message.trim(),
            threadId: initial.threadId,
        };
    } catch {
        Modal.createDialog(ErrorDialog, {
            title: _t("matcha_reminders|error_title"),
            description: _t("matcha_reminders|error_description"),
        });
    }
}
