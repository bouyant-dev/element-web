/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";
import { Button, Form, Search, Text, Tooltip } from "@vector-im/compound-web";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { _t } from "../../core/i18n/i18n";
import styles from "./StickerPickerView.module.css";

/** One sticker pack, shown as a tab. */
export interface StickerPickerTab {
    id: string;
    /** The pack's name, also its accessible name. */
    name: string;
    /** A URL the browser can load directly (http or data) for the pack's icon, never an mxc URL. */
    iconSrc?: string;
}

/** One sticker in the grid. */
export interface StickerPickerSticker {
    /** The pack it belongs to; search results can come from several packs. */
    packId: string;
    /** The shortcode, without colons. */
    shortcode: string;
    /** A URL the browser can load directly (http or data), never an mxc URL. */
    src: string;
    /** What the sticker shows, for screen readers and its tooltip. */
    label: string;
}

/** Presentation state of the sticker picker. */
export interface StickerPickerViewSnapshot {
    /** Every pack with stickers, in picker order. */
    tabs: StickerPickerTab[];
    /** The pack whose stickers are shown; none while searching. */
    selectedPackId?: string;
    /** The search text. */
    query: string;
    /** The stickers to show: the selected pack's, or the search results from every pack. */
    stickers: StickerPickerSticker[];
}

/** Picker commands; sending and navigation belong to the view model. */
export interface StickerPickerViewActions {
    /** Search every pack. */
    setQuery: (query: string) => void;
    /** Show one pack's stickers, ending any search. */
    selectPack: (packId: string) => void;
    /** Send this sticker to the room and close the picker. */
    sendSticker: (packId: string, shortcode: string) => void;
    /** Open the settings where stickers are added. */
    openSettings: () => void;
}

/** Contract consumed by the sticker picker view. */
export type StickerPickerViewModel = ViewModel<StickerPickerViewSnapshot, StickerPickerViewActions>;

/** A popover body listing sticker packs as tabs above a grid of their stickers. */
export function StickerPickerView({ vm }: { vm: StickerPickerViewModel }): JSX.Element {
    const { tabs, selectedPackId, query, stickers } = useViewModel(vm);

    if (!tabs.length) {
        return (
            <Flex
                direction="column"
                align="center"
                justify="center"
                gap="var(--cpd-space-3x)"
                className={classNames(styles.picker, styles.empty)}
            >
                <Text weight="semibold">{_t("matcha_stickers|empty_title")}</Text>
                <Text size="sm" className={styles.secondary}>
                    {_t("matcha_stickers|empty_description")}
                </Text>
                <Button kind="primary" size="md" onClick={vm.openSettings}>
                    {_t("matcha_stickers|add")}
                </Button>
            </Flex>
        );
    }

    return (
        <Flex direction="column" className={styles.picker}>
            <Form.Root className={styles.search} onSubmit={(event) => event.preventDefault()}>
                <Search
                    name="sticker-search"
                    placeholder={_t("matcha_stickers|search_placeholder")}
                    aria-label={_t("matcha_stickers|search_placeholder")}
                    value={query}
                    autoFocus
                    onChange={(event) => vm.setQuery(event.target.value)}
                />
            </Form.Root>
            <div role="group" aria-label={_t("matcha_stickers|packs_label")} className={styles.tabs}>
                {tabs.map((tab) => (
                    <Tooltip key={tab.id} label={tab.name}>
                        <button
                            type="button"
                            className={classNames(styles.tab, { [styles.tabSelected]: tab.id === selectedPackId })}
                            aria-label={tab.name}
                            aria-pressed={tab.id === selectedPackId}
                            onClick={() => vm.selectPack(tab.id)}
                        >
                            {tab.iconSrc ? (
                                <img src={tab.iconSrc} alt="" />
                            ) : (
                                <span aria-hidden>{tab.name.slice(0, 1).toUpperCase()}</span>
                            )}
                        </button>
                    </Tooltip>
                ))}
            </div>
            <div className={styles.body}>
                {stickers.length ? (
                    <ul className={styles.grid} aria-label={_t("matcha_stickers|stickers_label")}>
                        {stickers.map((sticker) => (
                            <li key={`${sticker.packId}|${sticker.shortcode}`}>
                                <button
                                    type="button"
                                    className={styles.sticker}
                                    aria-label={sticker.label}
                                    title={sticker.label}
                                    onClick={() => vm.sendSticker(sticker.packId, sticker.shortcode)}
                                >
                                    <img src={sticker.src} alt="" loading="lazy" />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Text size="sm" className={classNames(styles.secondary, styles.noResults)}>
                        {_t("matcha_stickers|no_results", { query })}
                    </Text>
                )}
            </div>
            <div className={styles.footer}>
                <Button kind="tertiary" size="md" onClick={vm.openSettings}>
                    {_t("matcha_stickers|manage")}
                </Button>
            </div>
        </Flex>
    );
}
