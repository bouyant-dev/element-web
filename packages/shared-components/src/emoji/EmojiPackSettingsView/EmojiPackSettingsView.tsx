/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Button, Form, IconButton, InlineSpinner, SettingsToggleInput, Text } from "@vector-im/compound-web";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import ReactionAddIcon from "@vector-im/compound-design-tokens/assets/web/icons/reaction-add";
import StickerIcon from "@vector-im/compound-design-tokens/assets/web/icons/sticker";

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

/** What an uploaded image is for. */
export type EmojiPackImageUsage = "emoticon" | "sticker";

/** Presentation state for one emoji pack. */
export interface EmojiPackSettingsViewSnapshot {
    /** The pack's emoji, in display order. */
    emojis: EmojiPackSettingsEmoji[];
    /** The pack's stickers that are not also emoji, in display order. */
    stickers: EmojiPackSettingsEmoji[];
    /** Whether the user may upload, rename and remove images. */
    canEdit: boolean;
    /** Whether an upload or change is in progress. */
    busy: boolean;
    /** A translated message for the last failed change. */
    error?: string;
    /** The pack's name, for packs that show one (room and Space packs); editors can change it. */
    name?: string;
    /** Whether the user offers this pack in all their rooms; absent where that does not apply. */
    usedEverywhere?: boolean;
    /** Whether the user may delete the whole pack. */
    canDelete?: boolean;
}

/** Pack commands; validation and persistence belong to the view model. */
export interface EmojiPackSettingsViewActions {
    /** Add the chosen image files to the pack as emoji or as stickers. */
    upload: (files: File[], usage: EmojiPackImageUsage) => void;
    /** Change an image's shortcode. */
    rename: (shortcode: string, newShortcode: string) => void;
    /** Remove an image from the pack. */
    remove: (shortcode: string) => void;
    /** Hide the current error. */
    dismissError: () => void;
    /** Change the pack's name. */
    renamePack: (name: string) => void;
    /** Offer the pack in all of the user's rooms, or only where it belongs. */
    setUsedEverywhere: (usedEverywhere: boolean) => void;
    /** Delete the pack for everyone. */
    deletePack: () => void;
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
    size,
}: {
    emoji: EmojiPackSettingsEmoji;
    canEdit: boolean;
    busy: boolean;
    error?: string;
    vm: EmojiPackSettingsViewModel;
    size: number;
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
            <img
                className={styles.image}
                style={{ width: size, height: size }}
                src={emoji.src}
                alt={code}
                width={size}
                height={size}
            />
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

/** The pack's name, its "use everywhere" switch and its deletion, for room and Space packs. */
function PackHeader({
    name,
    usedEverywhere,
    canEdit,
    canDelete,
    busy,
    error,
    vm,
}: Pick<EmojiPackSettingsViewSnapshot, "name" | "usedEverywhere" | "canEdit" | "canDelete" | "busy" | "error"> & {
    vm: EmojiPackSettingsViewModel;
}): JSX.Element {
    const [draft, setDraft] = useState(name ?? "");
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    // Follow renames from elsewhere and failed renames, unless the user is editing the name.
    useEffect(() => {
        if (!busy && document.activeElement !== input.current) setDraft(name ?? "");
    }, [busy, error, name]);

    return (
        <Flex direction="column" gap="var(--cpd-space-3x)" className={styles.header}>
            {name !== undefined &&
                (canEdit ? (
                    <input
                        ref={input}
                        className={classNames(styles.name, styles.packName)}
                        value={draft}
                        aria-label={_t("matcha_emoji|pack_name_label")}
                        readOnly={busy}
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={100}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.currentTarget.blur();
                            } else if (event.key === "Escape" && draft !== name) {
                                event.stopPropagation();
                                setDraft(name);
                            }
                        }}
                        onBlur={() => {
                            const trimmed = draft.trim();
                            if (trimmed && trimmed !== name) vm.renamePack(trimmed);
                            else setDraft(name);
                        }}
                    />
                ) : (
                    <Text as="h3" size="lg" weight="semibold" className={styles.packTitle}>
                        {name}
                    </Text>
                ))}
            {usedEverywhere !== undefined && (
                <Form.Root onSubmit={(event) => event.preventDefault()}>
                    <SettingsToggleInput
                        name="emoji-pack-use-everywhere"
                        label={_t("matcha_emoji|use_everywhere")}
                        helpMessage={_t("matcha_emoji|use_everywhere_description")}
                        checked={usedEverywhere}
                        disabled={busy}
                        onChange={(event) => vm.setUsedEverywhere(event.target.checked)}
                    />
                </Form.Root>
            )}
            {canDelete &&
                (confirmingDelete ? (
                    <Flex align="center" gap="var(--cpd-space-3x)" wrap="wrap">
                        <Text size="sm">{_t("matcha_emoji|delete_pack_confirm")}</Text>
                        <Button
                            kind="primary"
                            destructive
                            size="md"
                            disabled={busy}
                            onClick={() => {
                                setConfirmingDelete(false);
                                vm.deletePack();
                            }}
                        >
                            {_t("action|delete")}
                        </Button>
                        <Button kind="secondary" size="md" onClick={() => setConfirmingDelete(false)}>
                            {_t("action|cancel")}
                        </Button>
                    </Flex>
                ) : (
                    <Button
                        kind="tertiary"
                        destructive
                        size="md"
                        Icon={DeleteIcon}
                        disabled={busy}
                        className={styles.deletePack}
                        onClick={() => setConfirmingDelete(true)}
                    >
                        {_t("matcha_emoji|delete_pack")}
                    </Button>
                ))}
        </Flex>
    );
}

/** The emoji or the stickers of the pack, with their upload button. */
function ImageSection({
    usage,
    images,
    canEdit,
    busy,
    error,
    vm,
}: {
    usage: EmojiPackImageUsage;
    images: EmojiPackSettingsEmoji[];
    canEdit: boolean;
    busy: boolean;
    error?: string;
    vm: EmojiPackSettingsViewModel;
}): JSX.Element {
    const fileInput = useRef<HTMLInputElement>(null);
    const stickers = usage === "sticker";
    const heading = stickers ? _t("matcha_emoji|stickers_heading") : _t("matcha_emoji|emoji_heading");
    return (
        <Flex as="section" direction="column" gap="var(--cpd-space-2x)" aria-label={heading}>
            <Text as="h4" size="md" weight="semibold" className={styles.sectionHeading}>
                {heading}
            </Text>
            {canEdit && (
                <Flex direction="column" align="start" gap="var(--cpd-space-2x)">
                    <Flex align="center" gap="var(--cpd-space-3x)">
                        <Button
                            kind={stickers ? "secondary" : "primary"}
                            size="md"
                            Icon={stickers ? StickerIcon : ReactionAddIcon}
                            disabled={busy}
                            onClick={() => fileInput.current?.click()}
                        >
                            {stickers ? _t("matcha_emoji|upload_stickers") : _t("matcha_emoji|upload")}
                        </Button>
                        {busy && !stickers && <InlineSpinner role="progressbar" aria-label={_t("matcha_emoji|busy")} />}
                    </Flex>
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        accept={ACCEPTED_TYPES}
                        hidden
                        data-usage={usage}
                        onChange={(event) => {
                            const files = Array.from(event.currentTarget.files ?? []);
                            // Clear the input so picking the same file again still fires a change.
                            event.currentTarget.value = "";
                            if (files.length) vm.upload(files, usage);
                        }}
                    />
                    <Text size="sm" className={styles.secondary}>
                        {stickers ? _t("matcha_emoji|sticker_upload_hint") : _t("matcha_emoji|upload_hint")}
                    </Text>
                </Flex>
            )}
            {images.length > 0 ? (
                <>
                    <Text size="sm" className={styles.secondary}>
                        {stickers
                            ? _t("matcha_emoji|sticker_count", { count: images.length })
                            : _t("matcha_emoji|emoji_count", { count: images.length })}
                    </Text>
                    <Flex as="ul" direction="column" className={styles.list}>
                        {images.map((image) => (
                            <EmojiRow
                                key={image.shortcode}
                                emoji={image}
                                canEdit={canEdit}
                                busy={busy}
                                error={error}
                                vm={vm}
                                size={stickers ? 64 : 32}
                            />
                        ))}
                    </Flex>
                </>
            ) : (
                <Text size="sm" className={styles.secondary}>
                    {stickers ? _t("matcha_emoji|stickers_empty") : _t("matcha_emoji|empty")}
                </Text>
            )}
        </Flex>
    );
}

/** Discord-style management of one custom emoji pack: its emoji and stickers, and for room packs its name. */
export function EmojiPackSettingsView({ vm }: { vm: EmojiPackSettingsViewModel }): JSX.Element {
    const { emojis, stickers, canEdit, busy, error, name, usedEverywhere, canDelete } = useViewModel(vm);
    return (
        <Flex direction="column" gap="var(--cpd-space-4x)" className={styles.view}>
            {(name !== undefined || usedEverywhere !== undefined || canDelete) && (
                <PackHeader
                    name={name}
                    usedEverywhere={usedEverywhere}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    busy={busy}
                    error={error}
                    vm={vm}
                />
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
            <ImageSection usage="emoticon" images={emojis} canEdit={canEdit} busy={busy} error={error} vm={vm} />
            <ImageSection usage="sticker" images={stickers} canEdit={canEdit} busy={busy} error={error} vm={vm} />
            {!canEdit && (
                <Text size="sm" className={styles.secondary}>
                    {_t("matcha_emoji|read_only")}
                </Text>
            )}
        </Flex>
    );
}
