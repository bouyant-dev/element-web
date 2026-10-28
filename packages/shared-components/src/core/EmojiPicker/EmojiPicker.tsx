/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type Dispatch, useCallback, useId, useMemo, useRef, useState } from "react";
import { DATA_BY_CATEGORY, getEmojiFromUnicode, type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";
import { type ListRange, Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";
import { Heading } from "@vector-im/compound-web";
import classNames from "classnames";

import { _t, _td } from "../i18n/i18n";
import { AutoHideScrollbar } from "../utils/Scrollbar";
import {
    type IAction as RovingAction,
    type IState as RovingState,
    RovingGridIndexProvider,
    RovingStateActionType,
    type RovingTabIndexProviderProps,
} from "../roving";
import { Tabs } from "./Tabs";
import { Search } from "./Search";
import { Preview } from "./Preview";
import { QuickReactions } from "./QuickReactions";
import { Emoji } from "./Emoji";
import { type ButtonEvent } from "./RovingButton";
import styles from "./EmojiPicker.module.css";

const ZERO_WIDTH_JOINER = "\u200D";

export const EMOJI_HEIGHT = 35;
export const EMOJIS_PER_ROW = 8;

const CATEGORY_CONFIG: Category[] = [
    { id: "recent", untranslatedName: _td("emoji|category_frequently_used"), emoji: "🕒" },
    { id: "people", untranslatedName: _td("emoji|category_smileys_people"), emoji: "😀" },
    { id: "nature", untranslatedName: _td("emoji|category_animals_nature"), emoji: "🐕" },
    { id: "foods", untranslatedName: _td("emoji|category_food_drink"), emoji: "🍎" },
    { id: "activity", untranslatedName: _td("emoji|category_activities"), emoji: "⚽️" },
    { id: "places", untranslatedName: _td("emoji|category_travel_places"), emoji: "🚗" },
    { id: "objects", untranslatedName: _td("emoji|category_objects"), emoji: "💡" },
    { id: "symbols", untranslatedName: _td("emoji|category_symbols"), emoji: "⁉️" },
    { id: "flags", untranslatedName: _td("emoji|category_flags"), emoji: "🏁" },
];

// Built-in category ids, or `custom:<id>` for a custom category.
export type CategoryKey = keyof typeof DATA_BY_CATEGORY | "recent";

export type Category =
    | {
          id: CategoryKey;
          untranslatedName: TranslationKey;
          // Emoji to show in the header for this category
          emoji: string;
      }
    | {
          id: CategoryKey;
          // Literal name of a custom category, shown as given
          name: string;
          // Image to show in the header for this category
          iconSrc?: string;
          // The category's own emoji, rather than emojibase's
          emojis: GridEmoji[];
      };

/**
 * An emoji in the grid. Custom emoji are mapped onto the same shape, with their
 * key as the unicode, so that filtering, selection and navigation treat them alike.
 */
export type GridEmoji = IEmoji & { custom?: PickerCustomEmoji };

/**
 * A custom (image) emoji, e.g. from a Matrix image pack.
 */
export interface PickerCustomEmoji {
    /**
     * Identity of the emoji, e.g. its mxc URL. Passed to {@link EmojiPickerProps.onChoose} as the
     * unicode, and used to match it in `selectedEmojis` and `isEmojiDisabled`.
     */
    key: string;
    /**
     * Shortcode of the emoji, without colons.
     */
    shortcode: string;
    /**
     * URL of the image to display.
     */
    src: string;
}

/**
 * A category of custom emoji, shown as its own tab and section.
 */
export interface PickerCustomEmojiCategory {
    /**
     * Unique id of the category.
     */
    id: string;
    /**
     * Name of the category, shown as given.
     */
    name: string;
    /**
     * URL of the image to show in the category's tab. Defaults to the first emoji's image.
     */
    iconSrc?: string;
    /**
     * The emoji in the category, in display order.
     */
    emojis: PickerCustomEmoji[];
}

/** Map a custom category onto the shape of the built-in ones. */
function toCategory({ id, name, iconSrc, emojis }: PickerCustomEmojiCategory): Category {
    return {
        id: `custom:${id}`,
        name,
        iconSrc: iconSrc ?? emojis[0]?.src,
        emojis: emojis.map((custom) => ({
            unicode: custom.key,
            // Unique per item, as the same image may be in a pack under several shortcodes
            hexcode: `${custom.key}#${custom.shortcode}`,
            label: custom.shortcode,
            // Lower case like the built-in ones, which search ranking assumes; the shortcode is shown from `custom`
            shortcodes: [custom.shortcode.toLowerCase()],
            custom,
        })),
    };
}

/**
 * A single entry in the flat virtual list: either a category header or a row of
 * emoji. Headers are interleaved with the rows so that they scroll inline with
 * the content rather than staying pinned to the top.
 */
type ListItem = { type: "header"; category: Category } | { type: "row"; emojis: GridEmoji[]; categoryId: CategoryKey };

// Stable component identities so Virtuoso does not remount its internals on re-render.
// The single Virtuoso renders a flat list that mixes category headers and emoji rows.
// The Item wrapper picks its semantics per entry: a plain block for headers, a grid
// row for emoji rows.
const GridList: Components<ListItem>["List"] = ({ ref, ...props }) => {
    return <div {...props} ref={ref} className={styles.list} role="grid" aria-multiselectable />;
};

const GridItem: Components<ListItem>["Item"] = ({ item, ...props }) => {
    // Headers are interleaved with emoji rows as direct children of the role="grid"
    // list, so they must also be grid rows: a grid may only own rows/rowgroups.
    if (item.type === "header") {
        return <div {...props} role="row" />;
    }
    return <div {...props} role="row" className={styles.row} />;
};

const gridComponents = { List: GridList, Item: GridItem };

/**
 * Props for {@link EmojiPicker}.
 */
export interface EmojiPickerProps {
    /**
     * Set of which emojis are already selected and should be decorated as such.
     * If specified, emoji will use a checkbox role with aria-checked set appropriately.
     * Custom emoji are matched by their key.
     */
    selectedEmojis?: Set<string>;
    /**
     * Called when the user chooses an emoji. For a custom emoji, `unicode` is its key and
     * `custom` is the emoji itself.
     *
     * Return `false` to prevent the emoji being recorded as recently used.
     */
    onChoose: (unicode: string, custom?: PickerCustomEmoji) => boolean;
    /**
     * Called when the picker is done, e.g. an emoji was chosen with Enter.
     */
    onFinished: () => void;
    /**
     * Returns whether the emoji with the given unicode (the key, for a custom emoji) should be disabled.
     */
    isEmojiDisabled?: (unicode: string) => boolean;
    /**
     * Recently used emoji (unicode strings, most relevant first) to show in the
     * "Frequently Used" category. The category is hidden when empty or omitted.
     */
    recentEmojis?: string[];
    /**
     * Called with the chosen emoji unicode when it should be recorded as
     * recently used, i.e. when {@link onChoose} did not return `false`. Never called for
     * custom emoji.
     */
    onRecordRecent?: (unicode: string) => void;
    /**
     * Categories of custom emoji, each shown as a tab and section after the recently used emoji.
     */
    customEmojiCategories?: PickerCustomEmojiCategory[];
    /**
     * Optional action resolver used to map keyboard events to roving actions,
     * e.g. to apply app-level custom keybindings.
     *
     * When omitted, a default mapping based on `KeyboardEvent.key` is used.
     */
    getAction?: RovingTabIndexProviderProps["getAction"];
    /**
     * Whether to show the quick reactions at the bottom of the picker. Defaults to true.
     * Previews of emoji are displayed in the same bar as will also be hidden when this is false.
     */
    showQuickReactions?: boolean;
}

/** Convert recent emoji characters to emoji data, removing unknowns and duplicates */
function resolveRecentEmojis(recentEmojis: string[] | undefined): IEmoji[] {
    return Array.from(
        new Set((recentEmojis ?? []).map(getEmojiFromUnicode).filter((emoji): emoji is IEmoji => !!emoji)),
    );
}

function emojiMatchesFilter(emoji: IEmoji, filter: string): boolean {
    // If the query is an emoji containing a variation then strip it to provide more useful matches
    if (filter.includes(ZERO_WIDTH_JOINER)) {
        filter = filter.split(ZERO_WIDTH_JOINER, 2)[0];
    }
    return (
        emoji.label.toLowerCase().includes(filter) ||
        (Array.isArray(emoji.emoticon)
            ? emoji.emoticon.some((x) => x.includes(filter))
            : emoji.emoticon?.includes(filter)) ||
        emoji.shortcodes.some((x) => x.toLowerCase().includes(filter)) ||
        emoji.unicode.split(ZERO_WIDTH_JOINER).includes(filter)
    );
}

/**
 * Filter the given emoji by the (already lower-cased and trimmed) query and
 * sort matches so the most relevant shortcodes come first. Returns the input
 * unchanged when the filter is empty. Never mutates the input array.
 *
 * @param emojis - The emoji to filter
 * @param lcFilter - The lower-cased and trimmed filter string
 *
 * @returns The filtered and sorted emoji
 */
export function filterEmojis(emojis: IEmoji[], lcFilter: string): IEmoji[] {
    if (lcFilter === "") return emojis;

    return emojis
        .filter((emoji) => emojiMatchesFilter(emoji, lcFilter))
        .sort((a, b) => {
            const indexA = a.shortcodes[0].indexOf(lcFilter);
            const indexB = b.shortcodes[0].indexOf(lcFilter);

            // Prioritize emojis containing the filter in its shortcode
            if (indexA == -1 || indexB == -1) {
                return indexB - indexA;
            }

            // If both emojis start with the filter
            // put the shorter emoji first
            if (indexA == 0 && indexB == 0) {
                return a.shortcodes[0].length - b.shortcodes[0].length;
            }

            // Prioritize emojis starting with the filter
            return indexA - indexB;
        });
}

/**
 * A searchable emoji picker with categories, quick reactions and keyboard
 * (roving grid) navigation.
 */
export function EmojiPicker({
    selectedEmojis,
    onChoose,
    onFinished,
    isEmojiDisabled,
    recentEmojis,
    onRecordRecent,
    getAction,
    showQuickReactions = true,
    customEmojiCategories,
}: EmojiPickerProps): React.ReactNode {
    const [filter, setFilter] = useState("");
    const [previewEmoji, setPreviewEmoji] = useState<GridEmoji | undefined>(undefined);
    // Track if user has interacted with arrow keys or search
    const [showHighlight, setShowHighlight] = useState(false);
    // The scroll container of the picker body, once mounted. The Virtuoso windows
    // its rows against this shared scroll parent.
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    const searchRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const recentlyUsed = useMemo(() => resolveRecentEmojis(recentEmojis), [recentEmojis]);

    // Custom categories go between the recently used emoji and the first built-in category.
    const categories = useMemo<Category[]>(() => {
        if (!customEmojiCategories?.length) return CATEGORY_CONFIG;
        const [recent, ...builtIn] = CATEGORY_CONFIG;
        return [recent, ...customEmojiCategories.map(toCategory), ...builtIn];
    }, [customEmojiCategories]);
    // The category to select when no other is: the first custom one, else people.
    const fallbackCategory = categories.find((cat) => "emojis" in cat)?.id ?? "people";

    const lcFilter = filter.toLowerCase().trim(); // filter is case insensitive

    // Compute emoji to show in each category and which categories are enabled
    // (ie. non-empty) from the recently used list and the filter.
    const { dataByCategory, enabledCategories } = useMemo(() => {
        const dataByCategory = {} as Record<CategoryKey, GridEmoji[]>;
        const enabledCategories: CategoryKey[] = [];

        for (const cat of categories) {
            let source: GridEmoji[];
            if ("emojis" in cat) source = cat.emojis;
            else source = cat.id === "recent" ? recentlyUsed : DATA_BY_CATEGORY[cat.id];
            const emojis = filterEmojis(source, lcFilter);
            dataByCategory[cat.id] = emojis;
            if (emojis.length > 0) {
                enabledCategories.push(cat.id);
            }
        }

        return { dataByCategory, enabledCategories };
    }, [categories, lcFilter, recentlyUsed]);

    const [selectedCategory, setSelectedCategory] = useState<CategoryKey>(
        recentlyUsed.length > 0 ? "recent" : fallbackCategory,
    );

    const collectScrollElement = useCallback((ref: HTMLDivElement | null): void => {
        setScrollElement(ref);
    }, []);

    // Flatten into a list for virtuoso.
    const items = useMemo<ListItem[]>(() => {
        const flat: ListItem[] = [];
        for (const cat of categories) {
            const emojis = dataByCategory[cat.id];
            if (emojis.length === 0) continue;
            flat.push({ type: "header", category: cat });
            for (let i = 0; i < emojis.length; i += EMOJIS_PER_ROW) {
                flat.push({ type: "row", emojis: emojis.slice(i, i + EMOJIS_PER_ROW), categoryId: cat.id });
            }
        }
        return flat;
    }, [categories, dataByCategory]);

    const onRangeChanged = useCallback(
        (range: ListRange): void => {
            // Collect the categories that own any item within the rendered range. Each
            // flat-list entry knows its category (headers directly, rows via categoryId),
            // so a category is visible whenever one of its entries is in range - including
            // when its header itself has scrolled out of view.
            const visibleCategoryIds = new Set<CategoryKey>();
            for (let i = range.startIndex; i <= range.endIndex; i++) {
                const item = items[i];
                if (!item) continue;
                visibleCategoryIds.add(item.type === "header" ? item.category.id : item.categoryId);
            }

            setSelectedCategory(categories.find((cat) => visibleCategoryIds.has(cat.id))?.id ?? fallbackCategory);
        },
        [items, categories, fallbackCategory],
    );

    // Given a roving emoji button returns the role=gridcell element containing it
    const getGridcell = useCallback((rovingNode?: Element): Element | undefined => {
        return rovingNode?.parentElement ?? undefined;
    }, []);

    // Given a roving emoji button returns the role=row element containing it
    const getRow = useCallback(
        (rovingNode?: Element): Element | undefined => {
            return getGridcell(rovingNode)?.parentElement ?? undefined;
        },
        [getGridcell],
    );

    // Given a role=gridcell node returns the roving emoji button contained within
    const getRovingNode = useCallback((gridcellNode: Element): HTMLElement | undefined => {
        const node = gridcellNode.children[0];
        return node instanceof HTMLElement ? node : undefined;
    }, []);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent, state: RovingState, dispatch: Dispatch<RovingAction>): void => {
            if (state.activeNode && ["ArrowDown", "ArrowRight", "ArrowLeft", "ArrowUp"].includes(ev.key)) {
                // If highlight is not shown yet, show it and reset to first emoji
                if (!showHighlight) {
                    setShowHighlight(true);
                    // Reset to first emoji when showing highlight for the first time (or after it was hidden)
                    if (state.nodes.length > 0) {
                        dispatch({
                            type: RovingStateActionType.SetFocus,
                            payload: { node: state.nodes[0] },
                        });
                    }
                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                }
            }
        },
        [showHighlight],
    );

    const shouldMoveFocus = useCallback((): boolean => {
        // If the search field is active, the grid will still move the selected element but we don't
        // want it to change the focus because the user trying to type in the field.
        // NB. This does still break the ability to navigate the text field with left/right arrows
        // as they change the selected emoji in the grid. This seems… bad, but I'm keeping it how it was.
        return document.activeElement !== searchRef.current;
    }, []);

    const onGridNavigation = useCallback(
        (_ev: React.KeyboardEvent, focusNode: HTMLElement, state: RovingState): void => {
            if (getRow(state.activeNode) !== getRow(focusNode)) {
                focusNode.scrollIntoView({
                    behavior: "auto",
                    block: "center",
                    inline: "center",
                });
            }
        },
        [getRow],
    );

    const scrollToCategory = useCallback(
        (category: string): void => {
            // Find the flat index of the category's header and scroll it to the top.
            const index = items.findIndex((item) => item.type === "header" && item.category.id === category);
            if (index >= 0) {
                virtuosoRef.current?.scrollToIndex({ index, align: "start" });
            }
        },
        [items],
    );

    const onChangeFilter = useCallback((newFilter: string): void => {
        setFilter(newFilter);
        // User has typed a query, show highlight.
        // If the filter is cleared, hide the highlight again.
        setShowHighlight(newFilter.trim() !== "");
    }, []);

    const onEnterFilter = useCallback((): void => {
        // Only select emoji if highlight is shown
        if (!showHighlight) return;

        const btn = scrollElement?.querySelector<HTMLElement>('[role="gridcell"] [tabindex="0"]');
        btn?.click();
        onFinished();
    }, [showHighlight, scrollElement, onFinished]);

    const onHoverEmoji = useCallback((emoji: GridEmoji): void => {
        setPreviewEmoji(emoji);
    }, []);

    const onHoverEmojiEnd = useCallback((): void => {
        setPreviewEmoji(undefined);
    }, []);

    const onClickEmoji = useCallback(
        (ev: ButtonEvent, emoji: GridEmoji): void => {
            if (emoji.custom) {
                // Never recorded as recent: the recently used emoji are unicode only.
                onChoose(emoji.unicode, emoji.custom);
            } else if (onChoose(emoji.unicode) !== false) {
                onRecordRecent?.(emoji.unicode);
            }
            if ((ev as React.KeyboardEvent).key === "Enter") {
                onFinished();
            }
        },
        [onChoose, onRecordRecent, onFinished],
    );

    // Base for the IDs of the individual emoji cells: the search box points at the
    // active cell with aria-activedescendant, which requires the cells to have IDs.
    // It doesn't actually matter what the ID is, provided each is unique, because
    // the search box queries the roving context for the active element and gets its ID.
    // (generate a single unique ID and then suffix because hooks can't be called in
    // a loop).
    const emojiIdBase = useId();

    const renderItem = useCallback(
        (_index: number, item: ListItem): React.ReactNode => {
            if (item.type === "header") {
                const category = item.category;
                return (
                    <div className={styles.category} data-category-id={category.id} role="gridcell">
                        <Heading as="h2" className={styles.categoryLabel}>
                            {"name" in category ? category.name : _t(category.untranslatedName)}
                        </Heading>
                    </div>
                );
            }
            return item.emojis.map((emoji) => (
                <div role="gridcell" className={styles.itemWrapper} key={emoji.hexcode}>
                    <Emoji
                        // The category is part of the ID because the same emoji can appear both in
                        // its own category and in the recently used one.
                        id={`${emojiIdBase}-${item.categoryId}-${emoji.hexcode}`}
                        emoji={emoji}
                        selectedEmojis={selectedEmojis}
                        onClick={onClickEmoji}
                        onMouseEnter={onHoverEmoji}
                        onMouseLeave={onHoverEmojiEnd}
                        disabled={isEmojiDisabled?.(emoji.unicode)}
                    />
                </div>
            ));
        },
        [selectedEmojis, onClickEmoji, onHoverEmoji, onHoverEmojiEnd, isEmojiDisabled, emojiIdBase],
    );

    const pickerBodyId = useId();

    return (
        <RovingGridIndexProvider
            getGridCell={getGridcell}
            getRow={getRow}
            getRovingNode={getRovingNode}
            handleInputFields
            moveFocus={shouldMoveFocus}
            onGridNavigation={onGridNavigation}
            onKeyDown={onKeyDown}
            getAction={getAction}
        >
            {({ onKeyDownHandler }) => (
                <section
                    className={styles.picker}
                    onKeyDown={onKeyDownHandler}
                    aria-label={_t("emoji_picker|emoji_picker")}
                >
                    <Tabs
                        categories={categories}
                        enabledCategories={enabledCategories}
                        selectedCategory={selectedCategory}
                        onAnchorClick={scrollToCategory}
                        pickerBodyId={pickerBodyId}
                        getAction={getAction}
                    />
                    <Search
                        query={filter}
                        onChange={onChangeFilter}
                        onEnter={onEnterFilter}
                        onKeyDown={onKeyDownHandler}
                        inputRef={searchRef}
                        controlsId={pickerBodyId}
                    />
                    <AutoHideScrollbar
                        id={pickerBodyId}
                        className={classNames(styles.body, {
                            [styles.bodyShowHighlight]: showHighlight,
                        })}
                        wrappedRef={collectScrollElement}
                    >
                        {scrollElement && (
                            <Virtuoso
                                ref={virtuosoRef}
                                customScrollParent={scrollElement}
                                data={items}
                                defaultItemHeight={EMOJI_HEIGHT}
                                components={gridComponents}
                                itemContent={renderItem}
                                rangeChanged={onRangeChanged}
                            />
                        )}
                    </AutoHideScrollbar>
                    {showQuickReactions &&
                        (previewEmoji ? (
                            <Preview emoji={previewEmoji} />
                        ) : (
                            <QuickReactions
                                onClick={onClickEmoji}
                                selectedEmojis={selectedEmojis}
                                getAction={getAction}
                            />
                        ))}
                </section>
            )}
        </RovingGridIndexProvider>
    );
}
