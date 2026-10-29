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

test.describe("Matcha stickers", () => {
    test.use({
        displayName: "Alice",
        viewport: { width: 1440, height: 900 },
        config: { matcha_thread_tabs: true, setting_defaults: { "language": "en-GB", "RoomList.showSections": false } },
    });

    test("creates a sticker pack, uploads a sticker and sends it from the composer bar", async ({
        page,
        app,
        user,
    }) => {
        const roomId = await app.client.createRoom({ name: "Sticker room" });
        await app.viewRoomById(roomId);
        await dismissPrompts(page);

        // a) Create a named pack in the room's Emoji and stickers settings and upload a sticker to it.
        const settings = await app.settings.openRoomSettings("Emoji and stickers");
        await settings.getByRole("textbox", { name: "New pack name", exact: true }).fill("Test stickers");
        await settings.getByRole("button", { name: "Create pack", exact: true }).click();
        // The default pack comes first, named after the room; the new pack follows once its state arrives.
        const packNames = settings.getByRole("textbox", { name: "Pack name", exact: true });
        await expect(packNames.nth(0)).toHaveValue("Sticker room");
        await expect(packNames.nth(1)).toHaveValue("Test stickers");

        const fileChooser = page.waitForEvent("filechooser");
        await settings.getByRole("button", { name: "Upload stickers", exact: true }).nth(1).click();
        await (
            await fileChooser
        ).setFiles({ name: "wave.png", mimeType: "image/png", buffer: await readSampleFile("element.png", null) });
        await expect(settings.getByRole("textbox", { name: "Name for :wave:", exact: true })).toHaveValue("wave");
        await app.closeDialog();

        // b) Emoji are in the More options menu; the sticker button has their place in the bar.
        const composer = app.getComposer();
        await composer.getByRole("button", { name: "More options", exact: true }).click();
        await expect(page.getByRole("menuitem", { name: "Emoji", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");

        await composer.getByRole("button", { name: "Sticker", exact: true }).click();
        const packs = page.getByRole("group", { name: "Sticker packs", exact: true });
        await expect(packs.getByRole("button", { name: "Test stickers", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await page.getByRole("button", { name: ":wave:", exact: true }).click();

        // c) It is sent as an m.sticker event with its image info, and shows in the timeline.
        const sticker = await lastSentEvent(app, roomId, "m.sticker");
        expect(sticker.sender).toBe(user.userId);
        expect(sticker.content?.url).toMatch(/^mxc:\/\//);
        expect(sticker.content?.body).toBe("wave");
        expect(sticker.content?.info).toMatchObject({ mimetype: "image/png" });
        // The tile also holds a hidden placeholder image, so look for the sticker by its name.
        await expect(
            page.locator(".mx_EventTile .mx_MStickerBody_wrapper").getByRole("img", { name: "wave", exact: true }),
        ).toBeVisible();
    });
});
