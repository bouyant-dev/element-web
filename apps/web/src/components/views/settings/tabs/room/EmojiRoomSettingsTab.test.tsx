/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { EventType, MatrixEvent, Room, RoomStateEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../../../../MatrixClientPeg";
import { EmojiRoomSettingsTab } from "./EmojiRoomSettingsTab";
import { ROOM_EMOTES_EVENT } from "../../../../../utils/matcha/imagePacks";

describe("EmojiRoomSettingsTab", () => {
    let client: MatrixClient;
    let room: Room;
    let me: string;

    const setState = (type: string, content: object, eventId: string, stateKey = ""): void => {
        room.currentState.setStateEvents([
            new MatrixEvent({
                type,
                state_key: stateKey,
                room_id: room.roomId,
                event_id: eventId,
                sender: me,
                content,
            }),
        ]);
    };

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        me = client.getSafeUserId();
        room = new Room("!crew:server", client, me);
        room.name = "Crew";
        room.currentState.on(RoomStateEvent.Events, (...args) => client.emit(RoomStateEvent.Events, ...args));
        room.currentState.on(RoomStateEvent.Update, (...args) => client.emit(RoomStateEvent.Update, ...args));
        setState(EventType.RoomCreate, { room_version: "10" }, "$create");
        setState(EventType.RoomMember, { membership: KnownMembership.Join }, "$join", me);
        setState(EventType.RoomPowerLevels, { users: { [me]: 100 }, state_default: 50 }, "$pl");
        setState(ROOM_EMOTES_EVENT, { pack: { display_name: "Pepe" }, images: {} }, "$pepe", "pepe");
        vi.mocked(client.sendStateEvent).mockResolvedValue({ event_id: "$sent" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows the default pack, then each named pack, then the form for a new pack", () => {
        render(<EmojiRoomSettingsTab room={room} />);
        expect(
            screen.getAllByRole("textbox", { name: "Pack name" }).map((input) => (input as HTMLInputElement).value),
        ).toEqual(["Crew", "Pepe"]);
        // Only the named pack can be deleted.
        expect(screen.getAllByRole("button", { name: "Delete pack" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Upload stickers" })).toHaveLength(2);
        expect(screen.getByRole("textbox", { name: "New pack name" })).toBeInTheDocument();
    });

    it("adds a pack and shows it once its state arrives", async () => {
        render(<EmojiRoomSettingsTab room={room} />);
        await userEvent.type(screen.getByRole("textbox", { name: "New pack name" }), "Hamster Jack{Enter}");
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            room.roomId,
            ROOM_EMOTES_EVENT,
            { pack: { display_name: "Hamster Jack" }, images: {} },
            "hamster-jack",
        );
        act(() =>
            setState(ROOM_EMOTES_EVENT, { pack: { display_name: "Hamster Jack" }, images: {} }, "$h", "hamster-jack"),
        );
        expect(await screen.findAllByRole("textbox", { name: "Pack name" })).toHaveLength(3);
    });

    it("shows packs read-only, without the new pack form, to members who cannot edit", () => {
        setState(EventType.RoomPowerLevels, { users: { [me]: 0 }, state_default: 50 }, "$pl2");
        render(<EmojiRoomSettingsTab room={room} />);
        expect(screen.getByRole("heading", { name: "Pepe" })).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "New pack name" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("switch", { name: "Use in all my rooms" })).toHaveLength(2);
    });
});
