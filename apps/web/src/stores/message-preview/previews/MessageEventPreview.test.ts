/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeAll } from "vitest";
import { RelationType } from "matrix-js-sdk/src/matrix";
import { mkEvent, stubClient } from "test-utils";

// Import directly from the file to avoid circular dependencies with MessagePreviewStore
import { MessageEventPreview } from "./MessageEventPreview";

describe("MessageEventPreview", () => {
    const preview = new MessageEventPreview();
    const userId = "@user:example.com";

    beforeAll(() => {
        stubClient();
    });

    describe("getTextFor", () => {
        it("when called with an event with empty content should return null", () => {
            const event = mkEvent({
                event: true,
                content: {},
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBeNull();
        });

        it("when called with an event with empty body should return null", () => {
            const event = mkEvent({
                event: true,
                content: {
                    body: "",
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBeNull();
        });

        it("when called with an event with body should return »user: body«", () => {
            const event = mkEvent({
                event: true,
                content: {
                    body: "test body",
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: test body`);
        });

        it("when called for a replaced event with new content should return the new content body", () => {
            const event = mkEvent({
                event: true,
                content: {
                    ["m.new_content"]: {
                        body: "test new content body",
                    },
                    ["m.relates_to"]: {
                        rel_type: RelationType.Replace,
                        event_id: "$asd123",
                    },
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: test new content body`);
        });

        it.each([
            ["hi :wave:", 'hi <img data-mx-emoticon src="mxc://server/wave" alt=":wave:" title=":wave:" />'],
            [":wave:", '<img data-mx-emoticon src="mxc://server/wave" alt=":wave:" title=":wave:" height="32" />'],
            [":wave:", '<img data-mx-emoticon src="mxc://server/wave" title=":wave:" />'],
        ])("should show custom emoji as their shortcode, »%s«", (expected, formattedBody) => {
            const event = mkEvent({
                event: true,
                content: {
                    body: ":wave:",
                    format: "org.matrix.custom.html",
                    formatted_body: formattedBody,
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: ${expected}`);
        });
    });
});
