/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type EditorModel from "./model";
import type DocumentOffset from "./offset";
import { Type } from "./parts";
import { type CustomEmoji, type EmojiPack } from "../utils/matcha/imagePacks";

// A typed ":shortcode:": pack shortcodes hold anything but whitespace and colons.
const TYPED_SHORTCODE = /:([^\s:]+):/g;

/**
 * Turns every fully typed ":shortcode:" that names an available custom emoji into that emoji, as Discord does on send.
 * Emoji inside code become their ":shortcode:" text again when the message is serialized, so converting everywhere
 * is safe.
 * @param model - The composer model, changed in place.
 * @param packs - The packs usable in the room; the first emoji with a shortcode wins.
 * @param caret - Where the caret is; it stays there, as every emoji has the length of the text it replaces.
 */
export function replaceTypedCustomEmoji(model: EditorModel, packs: EmojiPack[], caret?: DocumentOffset): void {
    const emojis = new Map<string, CustomEmoji>();
    for (const emoji of packs.flatMap((pack) => pack.emojis)) {
        if (!emojis.has(emoji.shortcode)) emojis.set(emoji.shortcode, emoji);
    }
    if (!emojis.size) return;

    const found: { offset: number; emoji: CustomEmoji }[] = [];
    let partOffset = 0;
    for (const part of model.parts) {
        if (part.type === Type.Plain || part.type === Type.PillCandidate) {
            const regex = new RegExp(TYPED_SHORTCODE);
            let match: RegExpExecArray | null;
            while ((match = regex.exec(part.text))) {
                const emoji = emojis.get(match[1]);
                if (emoji) found.push({ offset: partOffset + match.index, emoji });
                // the closing colon of an unknown shortcode may open the next one
                else regex.lastIndex--;
            }
        }
        partOffset += part.text.length;
    }
    if (!found.length) return;

    void model.transform(() => {
        // Lengths do not change, so the offsets found above stay valid.
        for (const { offset, emoji } of found) {
            const text = `:${emoji.shortcode}:`;
            model
                .startRange(model.positionForOffset(offset), model.positionForOffset(offset + text.length, true))
                .replace([model.partCreator.customEmoji(text, emoji.url)]);
        }
        return caret ? model.positionForOffset(caret.offset, caret.atNodeEnd) : model.getPositionAtEnd();
    });
}
