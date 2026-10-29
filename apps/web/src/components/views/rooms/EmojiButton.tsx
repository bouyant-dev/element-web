/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import classNames from "classnames";
import React, { type JSX, useContext } from "react";
import { ReactionIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { type PickerCustomEmoji } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import ContextMenu, { aboveLeftOf, type MenuProps, useContextMenu } from "../../structures/ContextMenu";
import { CollapsibleButton, OverflowMenuContext } from "./CollapsibleButton";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";

interface IEmojiButtonProps {
    addEmoji: (unicode: string, custom?: PickerCustomEmoji) => boolean;
    menuPosition?: MenuProps;
    className?: string;
}

export function EmojiButton({ addEmoji, menuPosition, className }: IEmojiButtonProps): JSX.Element {
    const overflowMenuCloser = useContext(OverflowMenuContext);
    const [menuDisplayed, button, openMenu, closeMenu] = useContextMenu();

    let contextMenu: React.ReactElement | null = null;
    if (menuDisplayed && button.current) {
        const position = menuPosition ?? aboveLeftOf(button.current.getBoundingClientRect());
        const onFinished = (): void => {
            closeMenu();
            overflowMenuCloser?.();
        };

        contextMenu = <EmojiPickerMenu position={position} addEmoji={addEmoji} onFinished={onFinished} />;
    }

    const computedClassName = classNames("mx_EmojiButton", className, {
        mx_EmojiButton_highlight: menuDisplayed,
    });

    // TODO: replace ContextMenuTooltipButton with a unified representation of
    // the header buttons and the right panel buttons
    return (
        <>
            <CollapsibleButton
                className={computedClassName}
                onClick={openMenu}
                title={_t("common|emoji")}
                inputRef={button}
            >
                <ReactionIcon />
            </CollapsibleButton>

            {contextMenu}
        </>
    );
}

/**
 * The emoji picker popover, also opened by the composer when its emoji button sits in the overflow menu.
 * @param position - where to show it
 * @param addEmoji - called with each chosen emoji
 * @param onFinished - called when the picker should close
 */
export function EmojiPickerMenu({
    position,
    addEmoji,
    onFinished,
}: {
    position: MenuProps;
    addEmoji: IEmojiButtonProps["addEmoji"];
    onFinished: () => void;
}): JSX.Element {
    return (
        <ContextMenu {...position} onFinished={onFinished} managed={false} focusLock>
            <EmojiPickerWithRecents onChoose={addEmoji} onFinished={onFinished} />
        </ContextMenu>
    );
}
