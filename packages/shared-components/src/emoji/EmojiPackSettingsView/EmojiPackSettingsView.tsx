/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef, useState } from "react";
import { Button, IconButton, InlineSpinner, Text } from "@vector-im/compound-web";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import ReactionAddIcon from "@vector-im/compound-design-tokens/assets/web/icons/reaction-add";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { _t } from "../../core/i18n/i18n";
import styles from "./EmojiPackSettingsView.module.css";

/** One custom emoji in the pack. */
export interface EmojiPackSettingsEmoji {
    /** The shortcode, without colons. */
    shortcode: string;
    /** A URL the browser can load directly (http or data), never an mxc URL. */
    src: string;
}

/** Presentation state for one emoji pack. */
export interface EmojiPackSettingsViewSnapshot {
    /** The pack's emoji, in display order. */
    emojis: EmojiPackSettingsEmoji[];
    /** Whether the user may upload, rename and remove emoji. */
    canEdit: boolean;
    /** Whether an upload or change is in progress. */
    busy: boolean;
    /** A translated message for the last failed change. */
    error?: string;
}

/** Pack commands; validation and persistence belong to the view model. */
export interface EmojiPackSettingsViewActions {
    /** Add the chosen image files to the pack. */
    upload: (files: File[]) => void;
    /** Change an emoji's shortcode. */
    rename: (shortcode: string, newShortcode: string) => void;
    /** Remove an emoji from the pack. */
    remove: (shortcode: string) => void;
    /** Hide the current error. */
    dismissError: () => void;
}

/** Contract consumed by the emoji pack settings view. */
export type EmojiPackSettingsViewModel = ViewModel<EmojiPackSettingsViewSnapshot, EmojiPackSettingsViewActions>;

const ACCEPTED_TYPES = "image/png,image/gif,image/webp,image/jpeg";

function EmojiRow({
    emoji,
    canEdit,
    busy,
    error,
    vm,
}: {
    emoji: EmojiPackSettingsEmoji;
    canEdit: boolean;
    busy: boolean;
    error?: string;
    vm: EmojiPackSettingsViewModel;
}): JSX.Element {
    const [draft, setDraft] = useState(emoji.shortcode);
    const input = useRef<HTMLInputElement>(null);
    // A rename that failed leaves this row in place: once the change settles, show the stored name again,
    // unless the user is editing it.
    useEffect(() => {
        if (!busy && document.activeElement !== input.current) setDraft(emoji.shortcode);
    }, [busy, error, emoji.shortcode]);
    const code = `:${emoji.shortcode}:`;
    return (
        <Flex as="li" align="center" gap="var(--cpd-space-3x)" className={styles.row}>
            <img className={styles.image} src={emoji.src} alt={code} width={32} height={32} />
            {canEdit ? (
                <>
                    <input
                        ref={input}
                        className={styles.name}
                        value={draft}
                        aria-label={_t("matcha_emoji|name_label", { code })}
                        // Read-only rather than disabled, so a busy pack never steals focus mid-edit.
                        readOnly={busy}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            // Enter commits through the blur handler, so the rename is sent once.
                            if (event.key === "Enter") {
                                event.currentTarget.blur();
                            } else if (event.key === "Escape" && draft !== emoji.shortcode) {
                                // Revert without also closing a surrounding dialog.
                                event.stopPropagation();
                                setDraft(emoji.shortcode);
                            }
                        }}
                        onBlur={() => {
                            const name = draft.trim();
                            if (name && name !== emoji.shortcode) vm.rename(emoji.shortcode, name);
                            else setDraft(emoji.shortcode);
                        }}
                    />
                    <IconButton
                        size="32px"
                        destructive
                        disabled={busy}
                        tooltip={_t("matcha_emoji|remove", { code })}
                        onClick={() => vm.remove(emoji.shortcode)}
                    >
                        <DeleteIcon />
                    </IconButton>
                </>
            ) : (
                <Text as="span" size="md" className={styles.readOnlyName}>
                    {emoji.shortcode}
                </Text>
            )}
        </Flex>
    );
}

/** Discord-style management of one custom emoji pack: upload, rename and remove. */
export function EmojiPackSettingsView({ vm }: { vm: EmojiPackSettingsViewModel }): JSX.Element {
    const { emojis, canEdit, busy, error } = useViewModel(vm);
    const fileInput = useRef<HTMLInputElement>(null);
    return (
        <Flex direction="column" gap="var(--cpd-space-4x)" className={styles.view}>
            {canEdit && (
                <Flex direction="column" align="start" gap="var(--cpd-space-2x)">
                    <Flex align="center" gap="var(--cpd-space-3x)">
                        <Button
                            kind="primary"
                            size="md"
                            Icon={ReactionAddIcon}
                            disabled={busy}
                            onClick={() => fileInput.current?.click()}
                        >
                            {_t("matcha_emoji|upload")}
                        </Button>
                        {busy && <InlineSpinner role="progressbar" aria-label={_t("matcha_emoji|busy")} />}
                    </Flex>
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        accept={ACCEPTED_TYPES}
                        hidden
                        onChange={(event) => {
                            const files = Array.from(event.currentTarget.files ?? []);
                            // Clear the input so picking the same file again still fires a change.
                            event.currentTarget.value = "";
                            if (files.length) vm.upload(files);
                        }}
                    />
                    <Text size="sm" className={styles.secondary}>
                        {_t("matcha_emoji|upload_hint")}
                    </Text>
                </Flex>
            )}
            {error && (
                <Flex
                    role="alert"
                    align="center"
                    justify="space-between"
                    gap="var(--cpd-space-3x)"
                    className={styles.error}
                >
                    <Text size="sm">{error}</Text>
                    <IconButton size="24px" tooltip={_t("action|dismiss")} onClick={vm.dismissError}>
                        <CloseIcon />
                    </IconButton>
                </Flex>
            )}
            {emojis.length > 0 ? (
                <>
                    <Text size="sm" className={styles.secondary}>
                        {_t("matcha_emoji|emoji_count", { count: emojis.length })}
                    </Text>
                    <Flex as="ul" direction="column" className={styles.list}>
                        {emojis.map((emoji) => (
                            <EmojiRow
                                key={emoji.shortcode}
                                emoji={emoji}
                                canEdit={canEdit}
                                busy={busy}
                                error={error}
                                vm={vm}
                            />
                        ))}
                    </Flex>
                </>
            ) : (
                <Text size="sm" className={styles.secondary}>
                    {_t("matcha_emoji|empty")}
                </Text>
            )}
            {!canEdit && (
                <Text size="sm" className={styles.secondary}>
                    {_t("matcha_emoji|read_only")}
                </Text>
            )}
        </Flex>
    );
}
