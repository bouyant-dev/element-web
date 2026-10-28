/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventType, type MatrixClient, type MatrixEvent, RelationType, Room } from "matrix-js-sdk/src/matrix";
import { render } from "test-utils-rtl";
import { mkEvent, stubClient } from "test-utils";

import ReactionPicker from "./ReactionPicker";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";

vi.mock("../../../dispatcher/dispatcher");
vi.mock("../../../emojipicker/EmojiPickerWithRecents", () => ({ EmojiPickerWithRecents: vi.fn(() => null) }));

describe("ReactionPicker", () => {
    let client: MatrixClient;
    let room: Room;
    let mxEvent: MatrixEvent;

    const renderPicker = (): React.ComponentProps<typeof EmojiPickerWithRecents> => {
        render(<ReactionPicker mxEvent={mxEvent} onFinished={vi.fn()} />);
        return vi.mocked(EmojiPickerWithRecents).mock.lastCall![0];
    };

    beforeEach(() => {
        vi.clearAllMocks();
        client = stubClient();
        room = new Room("!room:example.org", client, client.getSafeUserId());
        vi.mocked(client.getRoom).mockReturnValue(room);
        mxEvent = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            room: room.roomId,
            user: "@alice:example.org",
            content: { body: "Hello", msgtype: "m.text" },
        });
    });

    it("offers the custom emoji of the event's room", () => {
        expect(renderPicker().room).toBe(room);
    });

    it("sends the shortcode of a custom emoji with the reaction, under both MSC4027 keys", () => {
        const { onChoose } = renderPicker();
        const custom = { key: "mxc://example.org/party", shortcode: "party", src: "https://example.org/party" };

        expect(onChoose(custom.key, custom)).toBe(true);

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId(), key: custom.key },
            "com.beeper.reaction.shortcode": ":party:",
            "shortcode": ":party:",
        });
    });

    it("sends unicode reactions without a shortcode", () => {
        renderPicker().onChoose("👍");

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId(), key: "👍" },
        });
    });
});
