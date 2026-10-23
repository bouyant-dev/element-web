/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { createNewInstance } from "@element-hq/element-web-playwright-common";
import type { Locator, Page, Route } from "@playwright/test";
import type { EventType } from "matrix-js-sdk/src/matrix";

import { test, expect } from "../../element-web-test";
import { ElementAppPage } from "../../pages/ElementAppPage";

const config = {
    matcha_thread_tabs: true,
    setting_defaults: { "language": "en-GB", "RoomList.showSections": false },
};

async function dismissPrompts(page: Page): Promise<void> {
    for (const name of ["Later", "Dismiss"]) {
        const action = page.getByRole("button", { name, exact: true });
        if (await action.isVisible()) await action.click();
    }
    const introduction = page.getByRole("dialog").filter({ hasText: "Introducing Sections" });
    if (await introduction.isVisible()) {
        await introduction.getByRole("button", { name: "Ok", exact: true }).click();
    }
}

async function openDocs(page: Page, waitForEditable = true): Promise<Locator> {
    await dismissPrompts(page);
    await page
        .getByRole("navigation", { name: "Room conversations" })
        .getByRole("button", { name: "Docs", exact: true })
        .click();
    const editor = page.getByRole("textbox", { name: "Markdown document", exact: true });
    await expect(editor).toBeVisible();
    if (waitForEditable) await expect(editor).toBeEditable();
    return editor;
}

test.describe("Matcha shared room Docs", () => {
    test.use({
        displayName: "Alice",
        viewport: { width: 1440, height: 900 },
        config,
        botCreateOpts: { displayName: "Room owner", autoAcceptInvites: true },
    });

    test("ordinary members edit one encrypted document, converge, reload and recover unsent changes", async ({
        app: alice,
        page: alicePage,
        user: aliceCredentials,
        browser,
        homeserver,
        labsFlags,
        bot,
    }, testInfo) => {
        test.setTimeout(180_000);
        await alice.client.bootstrapCrossSigning(aliceCredentials);
        await alice.closeKeyStorageToast();
        const bobCredentials = await homeserver.registerUser(`user_${testInfo.testId}_docs_bob`, "password", "Bob");
        const bobPage = await createNewInstance(browser, bobCredentials, config, labsFlags);
        const bob = new ElementAppPage(bobPage);
        try {
            await bob.client.bootstrapCrossSigning(bobCredentials);
            await bob.closeKeyStorageToast();
            // A third account creates the room so neither editor inherits creator privileges.
            const roomId = await bot.createRoom({
                name: "Collaborative room docs",
                invite: [aliceCredentials.userId, bobCredentials.userId],
                initial_state: [
                    { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
                ],
            });
            await Promise.all([alice.client.joinRoom(roomId), bob.client.joinRoom(roomId)]);
            await Promise.all([alicePage.goto("/#/room/" + roomId), bobPage.goto("/#/room/" + roomId)]);
            for (const member of [alice, bob]) {
                await expect
                    .poll(() =>
                        member.client.evaluate((client, id) => {
                            const room = client.getRoom(id)!;
                            return {
                                power: room.currentState.getMember(client.getSafeUserId())?.powerLevel,
                                mayWriteState: room.currentState.maySendStateEvent(
                                    "com.matchahoneylatte.docs",
                                    client.getSafeUserId(),
                                ),
                            };
                        }, roomId),
                    )
                    .toEqual({ power: 0, mayWriteState: false });
            }
            const [aliceEditor, bobEditor] = await Promise.all([openDocs(alicePage), openDocs(bobPage)]);
            const aliceDocs = alicePage.getByRole("region", { name: "Docs", exact: true });
            const bobDocs = bobPage.getByRole("region", { name: "Docs", exact: true });
            await aliceEditor.fill("# Shared plan\n\n**Release checklist**\n");
            await expect(bobEditor).toContainText("Release checklist");
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");

            // Both paste into the real editors before the 500ms send debounce can publish either change.
            await Promise.all([aliceEditor.press("ControlOrMeta+End"), bobEditor.press("ControlOrMeta+End")]);
            await Promise.all([
                alicePage.keyboard.insertText("\nAlice contribution to the shared plan.\n"),
                bobPage.keyboard.insertText("\nBob contribution to the shared plan.\n"),
            ]);
            for (const editor of [aliceEditor, bobEditor]) {
                await expect(editor).toContainText("Alice contribution");
                await expect(editor).toContainText("Bob contribution");
            }
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");
            await expect(bobDocs.getByRole("status")).toHaveText("Saved");

            await aliceDocs.getByRole("button", { name: "Preview", exact: true }).click();
            await expect(aliceDocs.getByRole("heading", { name: "Shared plan", exact: true })).toBeVisible();
            await alicePage.screenshot({ path: testInfo.outputPath("docs-live-preview.png"), animations: "disabled" });
            await aliceDocs.getByRole("button", { name: "Edit Markdown", exact: true }).click();

            await Promise.all([alicePage.reload(), bobPage.reload()]);
            await Promise.all([openDocs(alicePage), openDocs(bobPage)]);
            for (const editor of [aliceEditor, bobEditor]) {
                await expect(editor).toContainText("Alice contribution");
                await expect(editor).toContainText("Bob contribution");
            }
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);

            let rejectedSends = 0;
            const rejectSend = async (route: Route): Promise<void> => {
                rejectedSends++;
                await route.fulfill({
                    status: 403,
                    contentType: "application/json",
                    body: JSON.stringify({ errcode: "M_FORBIDDEN", error: "Simulated send failure" }),
                });
            };
            await alicePage.route("**/send/m.room.encrypted/**", rejectSend);
            await aliceEditor.press("ControlOrMeta+End");
            await alicePage.keyboard.insertText("\nUnsent change survives navigation and retry.\n");
            await expect.poll(() => rejectedSends).toBeGreaterThan(0);
            await expect(aliceDocs.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
            await expect(aliceDocs.getByRole("status")).not.toHaveText("Saved");
            await alicePage
                .getByRole("navigation", { name: "Room conversations" })
                .getByRole("button", { name: "General", exact: true })
                .click();
            await openDocs(alicePage, false);
            await expect(aliceEditor).toContainText("Unsent change survives navigation and retry.");
            await alicePage.unroute("**/send/m.room.encrypted/**", rejectSend);
            await aliceDocs.getByRole("button", { name: "Retry", exact: true }).click();
            await expect(bobEditor).toContainText("Unsent change survives navigation and retry.");
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");
            await expect(aliceEditor).toBeEditable();
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);
            await alicePage.reload();
            await openDocs(alicePage);
            await expect(aliceEditor).toContainText("Unsent change survives navigation and retry.");

            const persisted = await alice.client.evaluate(
                async (client, args) => {
                    const room = client.getRoom(args.roomId)!;
                    const anchor = room.currentState.getStateEvents(args.createType, "")!.getId()!;
                    const wire = await client.fetchRelations(args.roomId, anchor, "m.reference", null, { limit: 100 });
                    const decoded = [];
                    for (const raw of wire.chunk) {
                        const event = client.getEventMapper()({ ...raw, room_id: args.roomId });
                        await client.decryptEventIfNeeded(event);
                        decoded.push({
                            type: event.getType(),
                            doc: event.getContent().doc,
                            kind: event.getContent().kind,
                        });
                    }
                    return {
                        anchor,
                        wire,
                        decoded,
                        documentStateTypes: [...room.currentState.events.keys()].filter((type) =>
                            type.startsWith("com.matchahoneylatte.docs"),
                        ),
                    };
                },
                { roomId, createType: "m.room.create" as EventType.RoomCreate },
            );
            expect(persisted.anchor).toMatch(/^\$/);
            expect(persisted.wire.chunk.length).toBeGreaterThanOrEqual(3);
            expect(persisted.wire.chunk.every((event) => event.type === "m.room.encrypted")).toBe(true);
            expect(new Set(persisted.wire.chunk.map((event) => event.sender))).toEqual(
                new Set([aliceCredentials.userId, bobCredentials.userId]),
            );
            expect(
                persisted.decoded.every(
                    (event) =>
                        event.type === "com.matchahoneylatte.docs.update" &&
                        event.doc === "main" &&
                        ["update", "chunk", "commit"].includes(event.kind),
                ),
            ).toBe(true);
            expect(persisted.documentStateTypes).toEqual([]);
            for (const text of ["Shared plan", "Alice contribution", "Bob contribution", "Unsent change survives"]) {
                expect(JSON.stringify(persisted.wire)).not.toContain(text);
            }
        } finally {
            await bob.cleanup();
            await bobPage.context().close();
        }
    });
});
