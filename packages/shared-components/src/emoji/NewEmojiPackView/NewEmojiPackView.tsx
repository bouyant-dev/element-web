/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { Button, Form, IconButton, Text } from "@vector-im/compound-web";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import PlusIcon from "@vector-im/compound-design-tokens/assets/web/icons/plus";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { _t } from "../../core/i18n/i18n";
import styles from "./NewEmojiPackView.module.css";

/** Presentation state of the "new pack" form. */
export interface NewEmojiPackViewSnapshot {
    /** Whether the user may add packs; the form is hidden otherwise. */
    canCreate: boolean;
    /** Whether a pack is being created. */
    busy: boolean;
    /** A translated message for the last failed attempt. */
    error?: string;
}

/** Commands of the "new pack" form. */
export interface NewEmojiPackViewActions {
    /** Create an empty pack with this name. */
    createPack: (name: string) => void;
    /** Hide the current error. */
    dismissError: () => void;
}

/** Contract consumed by the "new pack" form. */
export type NewEmojiPackViewModel = ViewModel<NewEmojiPackViewSnapshot, NewEmojiPackViewActions>;

/** A form that adds a named emoji and sticker pack to a room or Space. */
export function NewEmojiPackView({ vm }: { vm: NewEmojiPackViewModel }): JSX.Element | null {
    const { canCreate, busy, error } = useViewModel(vm);
    const [name, setName] = useState("");
    const [submitted, setSubmitted] = useState(false);
    // Clear the name once the pack exists; keep it when creating failed, so it can be fixed and sent again.
    useEffect(() => {
        if (!submitted || busy) return;
        if (!error) setName("");
        setSubmitted(false);
    }, [submitted, busy, error]);
    if (!canCreate) return null;

    return (
        <Flex direction="column" gap="var(--cpd-space-2x)" className={styles.view}>
            <Form.Root
                className={styles.form}
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!name.trim() || busy) return;
                    setSubmitted(true);
                    vm.createPack(name);
                }}
            >
                <Form.Field name="new-emoji-pack" className={styles.field}>
                    <Form.Label>{_t("matcha_emoji|new_pack_label")}</Form.Label>
                    <Form.TextControl
                        value={name}
                        maxLength={100}
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                    />
                </Form.Field>
                <Button kind="secondary" size="md" Icon={PlusIcon} type="submit" disabled={busy || !name.trim()}>
                    {_t("matcha_emoji|create_pack")}
                </Button>
            </Form.Root>
            <Text size="sm" className={styles.secondary}>
                {_t("matcha_emoji|new_pack_description")}
            </Text>
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
        </Flex>
    );
}
