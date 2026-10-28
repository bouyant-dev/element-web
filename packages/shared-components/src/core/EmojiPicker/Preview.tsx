/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import classNames from "classnames";

import { type GridEmoji } from "./EmojiPicker";
import { CustomEmojiImage } from "./Emoji";
import styles from "./EmojiPicker.module.css";

interface IProps {
    /**
     * The emoji to preview.
     */
    emoji: GridEmoji;
}

/**
 * A preview of the selected emoji, showing the emoji itself, its name, and its shortcode.
 */
export const Preview: React.FC<IProps> = ({ emoji }) => {
    const {
        unicode,
        label,
        shortcodes: [shortcode],
        custom,
    } = emoji;

    return (
        <div className={styles.footer}>
            <div className={styles.previewEmoji}>
                {custom ? <CustomEmojiImage shortcode={custom.shortcode} src={custom.src} /> : unicode}
            </div>
            <div className={styles.previewText}>
                {custom ? (
                    // A custom emoji has no name other than its shortcode
                    <div className={classNames(styles.previewName, styles.customPreviewName)}>
                        {`:${custom.shortcode}:`}
                    </div>
                ) : (
                    <>
                        <div className={classNames(styles.name, styles.previewName)}>{label}</div>
                        <div className={styles.shortcode}>{shortcode}</div>
                    </>
                )}
            </div>
        </div>
    );
};
