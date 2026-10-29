/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { StickerPickerView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import ContextMenu, { type MenuProps } from "../../structures/ContextMenu";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useCustomStickerPacks } from "../../../hooks/useCustomEmojiPacks";
import { StickerPickerViewModel } from "../../../viewmodels/emoji/StickerPickerViewModel";

interface Props {
    room: Room;
    /** The thread the composer sends to, if any. */
    threadId: string | null;
    isStickerPickerOpen: boolean;
    setStickerPickerOpen: (isStickerPickerOpen: boolean) => void;
    menuPosition?: MenuProps;
}

/** The composer's sticker picker for MSC2545 packs, shown above the composer while open. */
export function MatchaStickerPicker({ isStickerPickerOpen, ...props }: Props): JSX.Element | null {
    // Mounted only while open, so packs are read and watched only then.
    return isStickerPickerOpen ? <OpenStickerPicker {...props} /> : null;
}

function OpenStickerPicker({
    room,
    threadId,
    setStickerPickerOpen,
    menuPosition,
}: Omit<Props, "isStickerPickerOpen">): JSX.Element {
    const client = useMatrixClientContext();
    const packs = useCustomStickerPacks(room);
    const close = useCallback(() => setStickerPickerOpen(false), [setStickerPickerOpen]);
    const vm = useCreateAutoDisposedViewModel(
        () => new StickerPickerViewModel({ client, packs, threadId, onFinished: close }),
    );
    useEffect(() => vm.setPacks(packs), [vm, packs]);

    return (
        <ContextMenu {...menuPosition} onFinished={close} managed={false} focusLock>
            <StickerPickerView vm={vm} />
        </ContextMenu>
    );
}
