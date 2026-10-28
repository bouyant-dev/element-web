/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { UnstableValue } from "matrix-js-sdk/src/NamespacedValue";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

export const REACTION_SHORTCODE_KEY = new UnstableValue("shortcode", "com.beeper.reaction.shortcode");

// Shortcodes as other clients send them, with or without colons, e.g. ":party:". Control and format characters,
// such as bidi overrides, are refused.
const SHORTCODE_PATTERN = /^:?[^\s:\p{Cc}\p{Cf}]+:?$/u;
// MSC4027's limit.
const MAX_SHORTCODE_BYTES = 100;

/** The first valid shortcode (MSC4027) that the senders of these reactions gave it, if any. */
export function getReactionShortcode(events: MatrixEvent[]): string | undefined {
    for (const event of events) {
        const value = REACTION_SHORTCODE_KEY.findIn<unknown>(event.getContent());
        if (
            typeof value === "string" &&
            SHORTCODE_PATTERN.test(value) &&
            new TextEncoder().encode(value).length <= MAX_SHORTCODE_BYTES
        ) {
            return value;
        }
    }
}

/** Reaction content naming a custom emoji, under both keys: some clients read only the stable one. */
export function reactionShortcodeContent(shortcode: string): Record<string, string> {
    return { [REACTION_SHORTCODE_KEY.name]: shortcode, [REACTION_SHORTCODE_KEY.altName]: shortcode };
}
