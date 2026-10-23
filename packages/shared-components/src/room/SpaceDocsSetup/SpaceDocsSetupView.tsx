/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Button, Heading, Text } from "@vector-im/compound-web";
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import styles from "./SpaceDocsSetupView.module.css";

/** Space configuration, kept separate from document contents. */
export interface SpaceDocsSetupSnapshot {
    spaceName: string;
    configured: boolean;
    canSetup: boolean;
    busy: boolean;
    error?: string;
}

/** Explicit setup and read-only status refresh commands. */
export interface SpaceDocsSetupActions {
    enable: () => Promise<void>;
    retry: () => Promise<void>;
}

/** View model contract for the one-time administrator setup. */
export type SpaceDocsSetupViewModel = ViewModel<SpaceDocsSetupSnapshot, SpaceDocsSetupActions>;

/** Explain the permanent Space encryption change before the administrator confirms it. */
export function SpaceDocsSetupView({ vm }: { vm: SpaceDocsSetupViewModel }): JSX.Element {
    const state = useViewModel(vm);
    return (
        <section className={styles.container}>
            <div className={styles.icon}>
                <LockIcon aria-hidden="true" />
            </div>
            <Heading as="h2" size="md">
                {_t("matcha_space_docs|title", { space: state.spaceName })}
            </Heading>
            <Text className={styles.subtitle}>{_t("matcha_space_docs|description")}</Text>
            <ul className={styles.details}>
                <li>{_t("matcha_space_docs|members")}</li>
                <li>{_t("matcha_space_docs|permanent")}</li>
                <li>{_t("matcha_space_docs|encrypted_content")}</li>
                <li>{_t("matcha_space_docs|chats_unchanged")}</li>
            </ul>
            {state.error && (
                <Text role="alert" className={styles.error}>
                    {state.error}
                </Text>
            )}
            {state.busy && <Text role="status">{_t("matcha_space_docs|setting_up")}</Text>}
            {!state.canSetup && <Text className={styles.subtitle}>{_t("matcha_space_docs|admin_required")}</Text>}
            <div className={styles.actions}>
                {state.canSetup && (
                    <Button disabled={state.busy} onClick={() => void vm.enable()}>
                        {_t("matcha_space_docs|enable")}
                    </Button>
                )}
                <Button kind="tertiary" disabled={state.busy} onClick={() => void vm.retry()}>
                    {_t("matcha_space_docs|retry")}
                </Button>
            </div>
        </section>
    );
}
