/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { expect, describe, it, vi, beforeEach } from "vitest";
import { type Menu, type MenuItemConstructorOptions, app, shell } from "electron";

import { type buildMenuTemplate as _buildMenuTemplate } from "./vectormenu.js";
import { type ConfigOptions } from "./config.js";

vi.mock("electron", () => ({
    app: {
        name: "Element",
        setAboutPanelOptions: vi.fn(),
    },
    shell: {
        openExternal: vi.fn(),
    },
    Menu: { buildFromTemplate: ((items) => ({ items })) as (typeof Menu)["buildFromTemplate"] } as unknown as Menu,
}));

vi.mock("./config.js", () => ({
    getConfig: (): Partial<ConfigOptions> => ({
        brand: "IAMBRAND",
        help_url: "https://i.need.help",
    }),
}));

vi.mock("./language-helper.js", () => ({
    _t: (k: string): string => k,
}));

describe("buildMenuTemplate", () => {
    describe.each(["darwin", "linux", "win32"] as const)("on %s", (platform) => {
        let buildMenuTemplate: typeof _buildMenuTemplate;

        beforeEach(async () => {
            vi.spyOn(process, "platform", "get").mockReturnValue(platform);
            vi.resetModules();
            ({ buildMenuTemplate } = await import("./vectormenu.js"));
        });

        it.runIf(platform === "darwin")("should use the visible brand rather than the internal storage name", () => {
            const menu = buildMenuTemplate();
            expect(menu.items[0].label).toBe("IAMBRAND");
            const submenu = menu.items[0].submenu as unknown as MenuItemConstructorOptions[];
            expect(submenu[0].label).toBe("common|about IAMBRAND");
            expect(app.setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: "IAMBRAND" });
        });

        it("should include expected `help` menu", () => {
            const menu = buildMenuTemplate();

            const helpMenu = menu.items.at(-1)!;
            expect(helpMenu.label).toBe("common|help");
            const helpSubmenu = helpMenu.submenu as unknown as MenuItemConstructorOptions[];
            expect(helpSubmenu[0].label).toBe("common|brand_help");
            helpSubmenu[0].click!(menu.items.at(-1)!, undefined, new Event("click") as KeyboardEvent);
            expect(shell.openExternal).toHaveBeenCalledWith("https://i.need.help");
        });
    });
});
