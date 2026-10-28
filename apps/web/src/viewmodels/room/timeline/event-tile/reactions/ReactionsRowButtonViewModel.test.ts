/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { EventType, type MatrixClient, type MatrixEvent, RelationType, type Room } from "matrix-js-sdk/src/matrix";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createTestClient, mkEvent, mkStubRoom } from "test-utils";

import { ReactionsRowButtonViewModel, type ReactionsRowButtonViewModelProps } from "./ReactionsRowButtonViewModel";
import { type ReactionsRowButtonTooltipViewModel } from "./ReactionsRowButtonTooltipViewModel";
import dis from "../../../../../dispatcher/dispatcher";

vi.mock("../../../../../dispatcher/dispatcher");
vi.mock("../../../../../customisations/Media", () => ({
    mediaFromMxc: vi.fn(() => ({ srcHttp: "https://example.org/_matrix/media/reaction.png" })),
}));

describe("ReactionsRowButtonViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let mxEvent: MatrixEvent;

    const createReactionEvent = (senderId: string, key = "👍"): MatrixEvent => {
        return mkEvent({
            event: true,
            type: "m.reaction",
            room: room.roomId,
            user: senderId,
            content: {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: mxEvent.getId(),
                    key,
                },
            },
        });
    };

    const createProps = (overrides?: Partial<ReactionsRowButtonViewModelProps>): ReactionsRowButtonViewModelProps => ({
        client,
        mxEvent,
        content: "👍",
        count: 2,
        reactionEvents: [createReactionEvent("@alice:example.org"), createReactionEvent("@bob:example.org")],
        disabled: false,
        customReactionImagesEnabled: false,
        ...overrides,
    });

    const getTooltipVm = (vm: ReactionsRowButtonViewModel): ReactionsRowButtonTooltipViewModel =>
        vm.getSnapshot().tooltipVm as ReactionsRowButtonTooltipViewModel;
    const getAriaLabel = (vm: ReactionsRowButtonViewModel): string | undefined =>
        (vm.getSnapshot() as { ariaLabel?: string }).ariaLabel;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
        room = mkStubRoom("!room:example.org", "Test Room", client);
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        mxEvent = mkEvent({
            event: true,
            type: "m.room.message",
            room: room.roomId,
            user: "@sender:example.org",
            content: { body: "Test message", msgtype: "m.text" },
        });
    });

    it("updates count with merge and does not touch tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const listener = vi.fn();
        vm.subscribe(listener);

        vm.setCount(5);

        expect(vm.getSnapshot().count).toBe(5);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();

        vm.setCount(6);

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("includes an ariaLabel in the snapshot", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());

        expect(getAriaLabel(vm)).toContain("reacted with 👍");
    });

    it("falls back when no room is available", () => {
        vi.spyOn(client, "getRoom").mockReturnValue(null);

        const vm = new ReactionsRowButtonViewModel(createProps());

        expect(getAriaLabel(vm)).toBeUndefined();
        expect(vm.getSnapshot().content).toBe("👍");
        expect(vm.getSnapshot().count).toBe(2);
    });

    it("renders custom reaction images with shortcode labels when enabled", () => {
        const reactionEvent = createReactionEvent("@alice:example.org", "mxc://example.org/reaction");
        reactionEvent.getContent()["shortcode"] = "party";

        const vm = new ReactionsRowButtonViewModel(
            createProps({
                content: "mxc://example.org/reaction",
                reactionEvents: [reactionEvent],
                customReactionImagesEnabled: true,
            }),
        );

        expect(vm.getSnapshot()).toMatchObject({
            imageSrc: "https://example.org/_matrix/media/reaction.png",
            imageAlt: "party",
        });
        expect(getAriaLabel(vm)).toContain("reacted with party");
    });

    it("names custom reactions by the first valid shortcode, and never by their URL", () => {
        const named = createReactionEvent("@alice:example.org", "mxc://example.org/reaction");
        named.getContent()["shortcode"] = ":party:";
        const unnamed = createReactionEvent("@bob:example.org", "mxc://example.org/reaction");
        const hostile = createReactionEvent("@mallory:example.org", "mxc://example.org/reaction");
        hostile.getContent()["shortcode"] = { a: 1 };
        const props = { content: "mxc://example.org/reaction", customReactionImagesEnabled: true };

        const vm = new ReactionsRowButtonViewModel(createProps({ ...props, reactionEvents: [named, unnamed] }));
        expect(vm.getSnapshot().imageAlt).toBe(":party:");
        expect(getAriaLabel(vm)).toContain("reacted with :party:");

        const anonymous = new ReactionsRowButtonViewModel(
            createProps({ ...props, reactionEvents: [hostile, unnamed] }),
        );
        expect(anonymous.getSnapshot().imageAlt).toBe("Custom reaction");
        expect(getAriaLabel(anonymous)).toContain("reacted with Custom reaction");
        expect(getAriaLabel(anonymous)).not.toContain("mxc://");
    });

    it("updates selected state with myReactionEvent without touching tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const listener = vi.fn();
        vm.subscribe(listener);
        const myReactionEvent = createReactionEvent("@me:example.org");

        vm.setMyReactionEvent(myReactionEvent);

        expect(vm.getSnapshot().isSelected).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();
    });

    it("updates disabled state without touching tooltip props", () => {
        const vm = new ReactionsRowButtonViewModel(createProps({ disabled: false }));
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");

        vm.setDisabled(true);

        expect(vm.getSnapshot().isDisabled).toBe(true);
        expect(tooltipSetPropsSpy).not.toHaveBeenCalled();
    });

    it("setReactionData forwards to tooltip via setProps and updates snapshot content", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());
        const tooltipSetPropsSpy = vi.spyOn(getTooltipVm(vm), "setProps");
        const reactionEvents = [createReactionEvent("@carol:example.org", "👎")];

        vm.setReactionData("👎", reactionEvents, false);

        expect(vm.getSnapshot().content).toBe("👎");
        expect(tooltipSetPropsSpy).toHaveBeenCalledWith({
            content: "👎",
            reactionEvents,
            customReactionImagesEnabled: false,
        });

        vm.setReactionData("👎", reactionEvents, false);

        expect(tooltipSetPropsSpy).toHaveBeenCalledTimes(2);
    });

    it("redacts reaction on click when myReactionEvent exists", () => {
        const myReactionEvent = createReactionEvent("@me:example.org");
        const vm = new ReactionsRowButtonViewModel(createProps({ myReactionEvent }));

        vm.onClick();

        expect(client.redactEvent).toHaveBeenCalledWith(room.roomId, myReactionEvent.getId());
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("sends reaction and dispatches message_sent when no myReactionEvent exists", () => {
        const vm = new ReactionsRowButtonViewModel(createProps());

        vm.onClick();

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": {
                rel_type: RelationType.Annotation,
                event_id: mxEvent.getId(),
                key: "👍",
            },
        });
        expect(dis.dispatch).toHaveBeenCalledWith({ action: "message_sent" });
    });

    it("copies the shortcode of an existing custom emoji reaction when joining it", () => {
        const withoutShortcode = createReactionEvent("@alice:example.org", "mxc://example.org/party");
        const badShortcodes = ["has spaces", "bidi\u202Eoverride", `:${"猫".repeat(33)}:`, { a: 1 }].map((value, i) => {
            const event = createReactionEvent(`@bad${i}:example.org`, "mxc://example.org/party");
            event.getContent()["shortcode"] = value;
            return event;
        });
        const withShortcode = createReactionEvent("@carol:example.org", "mxc://example.org/party");
        withShortcode.getContent()["shortcode"] = ":party:";
        const vm = new ReactionsRowButtonViewModel(
            createProps({
                content: "mxc://example.org/party",
                reactionEvents: [withoutShortcode, ...badShortcodes, withShortcode],
            }),
        );

        vm.onClick();

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": {
                rel_type: RelationType.Annotation,
                event_id: mxEvent.getId(),
                key: "mxc://example.org/party",
            },
            "com.beeper.reaction.shortcode": ":party:",
            "shortcode": ":party:",
        });
    });

    it("does not copy shortcodes onto unicode reactions", () => {
        const reactionEvent = createReactionEvent("@alice:example.org");
        reactionEvent.getContent()["shortcode"] = ":thumbsup:";
        const vm = new ReactionsRowButtonViewModel(createProps({ reactionEvents: [reactionEvent] }));

        vm.onClick();

        expect(client.sendEvent).toHaveBeenCalledWith(room.roomId, EventType.Reaction, {
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId(), key: "👍" },
        });
    });

    it("does nothing on click when disabled", () => {
        const vm = new ReactionsRowButtonViewModel(createProps({ disabled: true }));

        vm.onClick();

        expect(client.redactEvent).not.toHaveBeenCalled();
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(dis.dispatch).not.toHaveBeenCalled();
    });
});
