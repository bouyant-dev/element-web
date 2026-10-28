/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { createElement } from "react";
import { describe, it, expect, vi } from "vitest";

import AutocompleteWrapperModel from "./autocomplete";
import { createPartCreator } from "./__mocks__";
import { type ICompletion } from "../autocomplete/Autocompleter";

describe("AutocompleteWrapperModel", () => {
    const confirm = (completion: Partial<ICompletion>): unknown => {
        const updateCallback = vi.fn();
        const model = new AutocompleteWrapperModel(
            updateCallback,
            () => null,
            async () => {},
            createPartCreator(),
        );
        model.onComponentConfirm({
            completion: "",
            component: createElement("span"),
            range: { start: 0, end: 4 },
            ...completion,
        });
        return updateCallback.mock.calls[0][0].replaceParts.map((part: { serialize(): unknown }) => part.serialize());
    };

    it("inserts a custom emoji completion as a custom emoji", () => {
        expect(confirm({ type: "custom-emoji", completion: ":blob:", completionId: "mxc://hs.tld/blob" })).toEqual([
            { type: "custom-emoji", text: ":blob:", resourceId: "mxc://hs.tld/blob" },
        ]);
    });

    it("inserts a custom emoji completion without an image as text", () => {
        expect(confirm({ type: "custom-emoji", completion: ":blob:" })).toEqual([{ type: "plain", text: ":blob:" }]);
    });
});
