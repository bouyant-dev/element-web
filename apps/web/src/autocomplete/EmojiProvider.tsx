/*
Copyright 2024 New Vector Ltd.
Copyright 2022 Ryan Browne <code@commonlawfeature.com>
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2017, 2018 New Vector Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2016 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { uniq, sortBy, uniqBy, partition, type ListIteratee } from "lodash";
import EMOTICON_REGEX from "emojibase-regex/emoticon";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { EMOJI, type Emoji, getEmojiFromUnicode } from "@matrix-org/emojibase-bindings";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import QueryMatcher from "./QueryMatcher";
import { PillCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import SettingsStore from "../settings/SettingsStore";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import * as recent from "../emojipicker/recent";
import { filterBoolean } from "../utils/arrays";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { mediaFromMxc } from "../customisations/Media";
import { availableEmojiPacks } from "../hooks/useCustomEmojiPacks";
import { type CustomEmoji } from "../utils/matcha/imagePacks";

const LIMIT = 20;
const CUSTOM_LIMIT = 8;

// Match for ascii-style ";-)" emoticons or ":wink:" shortcodes provided by emojibase
// anchored to only match from the start of parts otherwise it'll show emoji suggestions whilst typing matrix IDs
const UNICODE_EMOJI_REGEX = new RegExp("(" + EMOTICON_REGEX.source + "|(?:^|\\s):[+-\\w]*:?)$");
// Custom emoji shortcodes may hold anything but whitespace and colons, such as "pepe.happy" or "café".
const EMOJI_REGEX = new RegExp("(" + EMOTICON_REGEX.source + "|(?:^|\\s):[^\\s:]*:?)$", "g");

interface ISortedEmoji {
    emoji: Emoji;
    _orderBy: number;
}

const SORTED_EMOJI: ISortedEmoji[] = EMOJI.sort((a, b) => {
    if (a.group === b.group) {
        return a.order! - b.order!;
    }
    return a.group! - b.group!;
}).map((emoji, index) => ({
    emoji,
    // Include the index so that we can preserve the original order
    _orderBy: index,
}));

function score(query: string, space: string[] | string): number {
    if (Array.isArray(space)) {
        return Math.min(...space.map((s) => score(query, s)));
    }

    const index = space.indexOf(query);
    if (index === -1) {
        return Infinity;
    } else {
        return index;
    }
}

function colonsTrimmed(str: string): string {
    // Trim off leading and potentially trailing `:` to correctly match the emoji data as they exist in emojibase.
    // Notes: The regex is pinned to the start and end of the string so that we can use the lazy-capturing `*?` matcher.
    // It needs to be lazy so that the trailing `:` is not captured in the replacement group, if it exists.
    return str.replace(/^:(.*?):?$/, "$1");
}

export default class EmojiProvider extends AutocompleteProvider {
    public matcher: QueryMatcher<ISortedEmoji>;
    public nameMatcher: QueryMatcher<ISortedEmoji>;
    private readonly recentlyUsed: Emoji[];
    // Rebuilt only when the packs' emoji lists change.
    private customMatcher?: { lists: CustomEmoji[][]; matcher: QueryMatcher<CustomEmoji> };

    public constructor(
        private readonly room: Room,
        renderingType?: TimelineRenderingType,
    ) {
        super({ commandRegex: EMOJI_REGEX, renderingType });
        this.matcher = new QueryMatcher<ISortedEmoji>(SORTED_EMOJI, {
            keys: [],
            funcs: [(o) => o.emoji.shortcodes.map((s) => `:${s}:`)],
            // For matching against ascii equivalents
            shouldMatchWordsOnly: false,
        });
        this.nameMatcher = new QueryMatcher(SORTED_EMOJI, {
            keys: ["emoji.label"],
            // For removing punctuation
            shouldMatchWordsOnly: true,
        });

        this.recentlyUsed = Array.from(new Set(filterBoolean(recent.get().map(getEmojiFromUnicode))));
    }

    public async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        if (!SettingsStore.getValue("MessageComposerInput.suggestEmoji")) {
            return []; // don't give any suggestions if the user doesn't want them
        }

        let completions: ISortedEmoji[] = [];
        const { command, range } = this.getCurrentCommand(query, selection);

        if (command && command[0].length > 2) {
            const matchedString = command[0];
            completions = this.matcher.match(matchedString, limit);

            // Do second match with shouldMatchWordsOnly in order to match against 'name', but not for queries only
            // custom shortcodes allow: it ignores punctuation, so ":P," would look for "p".
            if (UNICODE_EMOJI_REGEX.exec(matchedString)?.[0] === matchedString) {
                completions = completions.concat(this.nameMatcher.match(matchedString));
            }

            const sorters: ListIteratee<ISortedEmoji>[] = [];
            // make sure that emoticons come first
            sorters.push((c) => score(matchedString, c.emoji.emoticon || ""));

            // then sort by score (Infinity if matchedString not in shortcode)
            sorters.push((c) => score(matchedString, c.emoji.shortcodes[0]));
            // then sort by max score of all shortcodes, trim off the `:`
            const trimmedMatch = colonsTrimmed(matchedString);
            sorters.push((c) => Math.min(...c.emoji.shortcodes.map((s) => score(trimmedMatch, s))));
            // If the matchedString is not empty, sort by length of shortcode. Example:
            //  matchedString = ":bookmark"
            //  completions = [":bookmark:", ":bookmark_tabs:", ...]
            if (matchedString.length > 1) {
                sorters.push((c) => c.emoji.shortcodes[0].length);
            }
            // Finally, sort by original ordering
            sorters.push((c) => c._orderBy);
            completions = sortBy<ISortedEmoji>(uniq(completions), sorters);

            completions = completions.slice(0, LIMIT);

            // Do a second sort to place emoji matching with frequently used one on top
            const recentlyUsedAutocomplete: ISortedEmoji[] = [];
            this.recentlyUsed.forEach((emoji) => {
                if (emoji.shortcodes[0].indexOf(trimmedMatch) === 0) {
                    recentlyUsedAutocomplete.push({ emoji: emoji, _orderBy: 0 });
                }
            });

            //if there is an exact shortcode match in the frequently used emojis, it goes before everything
            for (let i = 0; i < recentlyUsedAutocomplete.length; i++) {
                if (recentlyUsedAutocomplete[i].emoji.shortcodes[0] === trimmedMatch) {
                    const exactMatchEmoji = recentlyUsedAutocomplete[i];
                    for (let j = i; j > 0; j--) {
                        recentlyUsedAutocomplete[j] = recentlyUsedAutocomplete[j - 1];
                    }
                    recentlyUsedAutocomplete[0] = exactMatchEmoji;
                    break;
                }
            }

            completions = recentlyUsedAutocomplete.concat(completions);
            completions = uniqBy(completions, "emoji");

            const unicode = completions.map((c) => ({
                completion: c.emoji.unicode,
                component: (
                    <PillCompletion title={`:${c.emoji.shortcodes[0]}:`} aria-label={c.emoji.unicode}>
                        <span>{c.emoji.unicode}</span>
                    </PillCompletion>
                ),
                range: range!,
            }));

            const client = MatrixClientPeg.safeGet();
            const isExact = (shortcode: string): boolean => shortcode.toLowerCase() === trimmedMatch.toLowerCase();
            const unicodeExactIndex = completions.findIndex((c) => c.emoji.shortcodes.some(isExact));
            const [customExact, customOther] = partition(this.getCustomEmoji(client, matchedString, isExact), (e) =>
                isExact(e.shortcode),
            );
            const toCustom = ({ shortcode, url }: CustomEmoji): ICompletion => ({
                type: "custom-emoji",
                completion: `:${shortcode}:`,
                completionId: url,
                component: (
                    <PillCompletion title={`:${shortcode}:`} aria-label={`:${shortcode}:`}>
                        <img
                            src={mediaFromMxc(url, client).srcHttp ?? undefined}
                            alt={`:${shortcode}:`}
                            style={{ width: "1.5em", height: "1.5em", objectFit: "contain" }}
                        />
                    </PillCompletion>
                ),
                range: range!,
            });
            // Exact custom matches come first and other custom matches next, but never ahead of an exact unicode match.
            return [
                ...customExact.map(toCustom),
                ...unicode.slice(0, unicodeExactIndex + 1),
                ...customOther.map(toCustom),
                ...unicode.slice(unicodeExactIndex + 1),
            ];
        }
        return [];
    }

    /** Custom emoji usable in the room whose ":shortcode:" matches: exact matches, then shorter shortcodes first. */
    private getCustomEmoji(
        client: MatrixClient,
        matchedString: string,
        isExact: (shortcode: string) => boolean,
    ): CustomEmoji[] {
        const lists = availableEmojiPacks(client, this.room).map((pack) => pack.emojis);
        if (!lists.length) return [];
        const cached = this.customMatcher;
        if (!cached || cached.lists.length !== lists.length || lists.some((list, i) => list !== cached.lists[i])) {
            const matcher = new QueryMatcher<CustomEmoji>(lists.flat(), {
                keys: [],
                funcs: [(emoji) => `:${emoji.shortcode}:`],
                shouldMatchWordsOnly: false,
            });
            this.customMatcher = { lists, matcher };
        }
        const matches = sortBy(this.customMatcher!.matcher.match(matchedString), [
            (e) => (isExact(e.shortcode) ? 0 : 1),
            (e) => e.shortcode.length,
        ]);
        // the same image can be in several packs
        return uniqBy(matches, "url").slice(0, CUSTOM_LIMIT);
    }

    public getName(): string {
        return "😃 " + _t("common|emoji");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|emoji_a11y")}
            >
                {completions}
            </div>
        );
    }
}
