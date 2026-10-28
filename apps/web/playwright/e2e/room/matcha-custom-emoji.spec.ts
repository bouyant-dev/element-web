/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { Page } from "@playwright/test";
import type { IEvent } from "matrix-js-sdk/src/matrix";

import { test, expect } from "../../element-web-test";
import type { ElementAppPage } from "../../pages/ElementAppPage";
import { readSampleFile } from "../../sample-files";

/** The latest event of this type in the room's main timeline, once the server has echoed it back. */
async function lastSentEvent(app: ElementAppPage, roomId: string, type: string): Promise<Partial<IEvent>> {
    let event: Partial<IEvent> | undefined;
    // Local echoes wait among the pending events, so an event in the timeline has been sent.
    await expect
        .poll(async () => {
            event = await app.client.evaluate(
                (client, { roomId, type }) =>
                    client
                        .getRoom(roomId)!
                        .getLiveTimeline()
                        .getEvents()
                        .findLast((e) => e.getType() === type)?.event,
                { roomId, type },
            );
            return event;
        })
        .toBeDefined();
    return event!;
}

async function dismissPrompts(page: Page): Promise<void> {
    for (const name of ["Later", "Dismiss"]) {
        const action = page.getByRole("button", { name, exact: true });
        if (await action.isVisible()) await action.click();
    }
    const introduction = page.getByRole("dialog").filter({ hasText: "Introducing Sections" });
    if (await introduction.isVisible()) await introduction.getByRole("button", { name: "Ok", exact: true }).click();
}

test.describe("Matcha custom emoji", () => {
    test.use({
        displayName: "Alice",
        viewport: { width: 1440, height: 900 },
        config: { matcha_thread_tabs: true, setting_defaults: { "language": "en-GB", "RoomList.showSections": false } },
    });

    test("uploads a room emoji, sends it inline and reacts with it", async ({ page, app, user }) => {
        const roomId = await app.client.createRoom({ name: "Emoji room" });
        await app.viewRoomById(roomId);
        await dismissPrompts(page);

        // a) Upload through the room's Emoji settings tab, then rename it.
        const settings = await app.settings.openRoomSettings("Emoji");
        const fileChooser = page.waitForEvent("filechooser");
        await settings.getByRole("button", { name: "Upload emoji", exact: true }).click();
        await (
            await fileChooser
        ).setFiles({ name: "blob.png", mimeType: "image/png", buffer: await readSampleFile("element.png", null) });
        const name = settings.getByRole("textbox", { name: "Name for :blob:", exact: true });
        await expect(name).toHaveValue("blob");
        await name.fill("party_blob");
        await name.press("Enter");
        await expect(settings.getByRole("textbox", { name: "Name for :party_blob:", exact: true })).toHaveValue(
            "party_blob",
        );
        await expect(settings.getByRole("img", { name: ":party_blob:", exact: true })).toBeVisible();
        await app.closeDialog();

        // b) Autocomplete it in the composer and send it.
        const composer = app.getComposerField();
        await composer.pressSequentially(":party");
        await page.getByRole("option", { name: ":party_blob:", exact: true }).click();
        await composer.press("Enter");

        const tile = page.locator(".mx_EventTile").filter({ has: page.getByRole("img", { name: ":party_blob:" }) });
        const inline = tile.getByRole("img", { name: ":party_blob:", exact: true });
        await expect(inline).toHaveAttribute("data-mx-emoticon");
        await expect(inline).toHaveAttribute("src", /^https?:\/\//);
        const message = (await lastSentEvent(app, roomId, "m.room.message")).content;
        expect(message?.body).toBe(":party_blob:");
        expect(message?.formatted_body).toContain("data-mx-emoticon");
        expect(message?.formatted_body).toMatch(/src="mxc:\/\/[^"]+"/);

        // c) React with it from its pack's section of the reaction picker.
        await tile.hover();
        await tile.getByRole("toolbar", { name: "Message Actions" }).getByRole("button", { name: "React" }).click();
        const picker = page.getByLabel("Emoji picker");
        await expect(picker.getByRole("tab", { name: "Emoji room", exact: true })).toBeVisible();
        await picker.getByRole("gridcell", { name: ":party_blob:", exact: true }).click();

        const pill = tile.getByRole("button", { name: "Alice reacted with :party_blob:", exact: true });
        await expect(pill.getByRole("img")).toHaveAttribute("src", /^https?:\/\//);
        const reaction = await lastSentEvent(app, roomId, "m.reaction");
        expect(reaction.sender).toBe(user.userId);
        expect(reaction.content?.["m.relates_to"]?.key).toMatch(/^mxc:\/\//);
        expect(reaction.content?.["m.relates_to"]?.key).toBe(message?.formatted_body?.match(/src="(mxc:[^"]+)"/)?.[1]);
        expect(reaction.content?.["com.beeper.reaction.shortcode"]).toBe(":party_blob:");
    });

    test("offers a Space's emoji in its rooms' picker", async ({ page, app, user }) => {
        const { content_uri: url } = await app.client.uploadContent(await readSampleFile("element.png", null), {
            type: "image/png",
        });
        const server = user.userId.split(":").slice(1).join(":");
        const spaceId = await app.client.createSpace({
            name: "Emoji space",
            initial_state: [
                { type: "im.ponies.room_emotes", state_key: "", content: { images: { space_wave: { url } } } },
            ],
        });
        const roomId = await app.client.createRoom({
            name: "Space chat",
            initial_state: [{ type: "m.space.parent", state_key: spaceId, content: { via: [server] } }],
        });
        await app.client.sendStateEvent(spaceId, "m.space.child", { via: [server] }, roomId);
        await app.viewRoomById(roomId);
        await dismissPrompts(page);

        await app.getComposer().getByRole("button", { name: "Emoji", exact: true }).click();
        const picker = page.getByLabel("Emoji picker");
        await expect(picker.getByRole("tab", { name: "Emoji space", exact: true })).toBeVisible();
        await expect(picker.getByRole("gridcell", { name: ":space_wave:", exact: true })).toBeVisible();
    });
});
