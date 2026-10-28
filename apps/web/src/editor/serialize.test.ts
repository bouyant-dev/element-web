/*
Copyright 2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import EditorModel from "./model";
import { htmlSerializeFromMdIfNeeded, htmlSerializeIfNeeded, textSerialize } from "./serialize";
import { createPartCreator } from "./__mocks__";
import { type IConfigOptions } from "../IConfigOptions";
import SettingsStore from "../settings/SettingsStore";
import SdkConfig from "../SdkConfig";

describe("editor/serialize", function () {
    describe("with markdown", function () {
        it("user pill turns message into html", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.userPill("Alice", "@alice:hs.tld")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/@alice:hs.tld">Alice</a>');
        });
        it("room pill turns message into html", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.roomPill("#room:hs.tld")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/#room:hs.tld">#room:hs.tld</a>');
        });
        it("@room pill turns message into html", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.atRoomPill("@room")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBeFalsy();
        });
        it("any markdown turns message into html", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("*hello* world")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe("<em>hello</em> world");
        });
        it("displaynames ending in a backslash work", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.userPill("Displayname\\", "@user:server")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/@user:server">Displayname\\</a>');
        });
        it("displaynames containing an opening square bracket work", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.userPill("Displayname[[", "@user:server")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/@user:server">Displayname[[</a>');
        });
        it("displaynames containing a closing square bracket work", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.userPill("Displayname]", "@user:server")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/@user:server">Displayname]</a>');
        });
        it("displaynames containing a newline work", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.userPill("Display\nname", "@user:server")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<a href="https://matrix.to/#/@user:server">Display<br>name</a>');
        });
        it("escaped markdown should not retain backslashes", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("\\*hello\\* world")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe("*hello* world");
        });
        it("escaped markdown should not retain backslashes around other markdown", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("\\*hello\\* **world**")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe("*hello* <strong>world</strong>");
        });
        it("escaped markdown should convert HTML entities", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("\\*hello\\* world < hey world!")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe("*hello* world &lt; hey world!");
        });

        it("lists with a single empty item are not considered markdown", function () {
            const pc = createPartCreator();

            const model1 = new EditorModel([pc.plain("-")], pc);
            const html1 = htmlSerializeIfNeeded(model1, {});
            expect(html1).toBe(undefined);

            const model2 = new EditorModel([pc.plain("* ")], pc);
            const html2 = htmlSerializeIfNeeded(model2, {});
            expect(html2).toBe(undefined);

            const model3 = new EditorModel([pc.plain("2021.")], pc);
            const html3 = htmlSerializeIfNeeded(model3, {});
            expect(html3).toBe(undefined);
        });

        it("lists with a single non-empty item are still markdown", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("2021. foo")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toBe('<ol start="2021">\n<li>foo</li>\n</ol>\n');
        });
        describe("with permalink_prefix set", function () {
            const sdkConfigGet = SdkConfig.get;
            beforeEach(() => {
                vi.spyOn(SdkConfig, "get").mockImplementation((key: keyof IConfigOptions, altCaseName?: string) => {
                    if (key === "permalink_prefix") {
                        return "https://element.fs.tld";
                    } else return sdkConfigGet(key, altCaseName);
                });
            });

            it("user pill uses matrix.to", function () {
                const pc = createPartCreator();
                const model = new EditorModel([pc.userPill("Alice", "@alice:hs.tld")], pc);
                const html = htmlSerializeIfNeeded(model, {});
                expect(html).toBe('<a href="https://matrix.to/#/@alice:hs.tld">Alice</a>');
            });
            it("room pill uses matrix.to", function () {
                const pc = createPartCreator();
                const model = new EditorModel([pc.roomPill("#room:hs.tld")], pc);
                const html = htmlSerializeIfNeeded(model, {});
                expect(html).toBe('<a href="https://matrix.to/#/#room:hs.tld">#room:hs.tld</a>');
            });
            afterEach(() => {
                vi.mocked(SdkConfig.get).mockRestore();
            });
        });
    });

    describe("with plaintext", function () {
        it("markdown remains plaintext", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("*hello* world")], pc);
            const html = htmlSerializeIfNeeded(model, { useMarkdown: false });
            expect(html).toBe("*hello* world");
        });
        it("markdown should retain backslashes", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("\\*hello\\* world")], pc);
            const html = htmlSerializeIfNeeded(model, { useMarkdown: false });
            expect(html).toBe("\\*hello\\* world");
        });
        it("markdown should convert HTML entities", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("\\*hello\\* world < hey world!")], pc);
            const html = htmlSerializeIfNeeded(model, { useMarkdown: false });
            expect(html).toBe("\\*hello\\* world &lt; hey world!");
        });
        it("plaintext remains plaintext even when forcing html", function () {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("hello world")], pc);
            const html = htmlSerializeIfNeeded(model, { forceHTML: true, useMarkdown: false });
            expect(html).toBe("hello world");
        });
        it("should treat tags not in allowlist as plaintext", () => {
            const html = htmlSerializeFromMdIfNeeded("<b>test</b>", {});
            expect(html).toBeUndefined();
        });
        it("should treat tags not in allowlist as plaintext even if escaped", () => {
            const html = htmlSerializeFromMdIfNeeded("\\<b>test</b>", {});
            expect(html).toBe("&lt;b&gt;test&lt;/b&gt;");
        });
    });

    describe("custom emoji", () => {
        const blob = '<img data-mx-emoticon="" src="mxc://hs.tld/blob" alt=":blob:" title=":blob:" height="32">';

        it("are sent as images inline with text", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.plain("hi "), pc.customEmoji(":blob:", "mxc://hs.tld/blob"), pc.plain(" there")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe(`hi ${blob} there`);
            expect(textSerialize(model)).toBe("hi :blob: there");
        });

        it("are sent as HTML when alone", () => {
            const pc = createPartCreator();
            const model = new EditorModel([pc.customEmoji(":blob:", "mxc://hs.tld/blob")], pc);
            expect(htmlSerializeIfNeeded(model, {})).toBe(blob);
            expect(textSerialize(model)).toBe(":blob:");
        });

        it("keep their order", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.customEmoji(":a:", "mxc://hs.tld/a"), pc.plain(" "), pc.customEmoji(":b:", "mxc://hs.tld/b")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe(
                '<img data-mx-emoticon="" src="mxc://hs.tld/a" alt=":a:" title=":a:" height="32"> ' +
                    '<img data-mx-emoticon="" src="mxc://hs.tld/b" alt=":b:" title=":b:" height="32">',
            );
        });

        it("do not stop markdown on the following lines", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.customEmoji(":blob:", "mxc://hs.tld/blob"), pc.newline(), pc.plain("**bold** <b>")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe(`${blob}<br><strong>bold</strong> &lt;b&gt;`);
        });

        it("become their shortcode inside inline code", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.plain("`x "), pc.customEmoji(":blob:", "mxc://hs.tld/blob"), pc.plain("` y")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe("<code>x :blob:</code> y");
        });

        it("become their shortcode inside code blocks", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [
                    pc.plain("```"),
                    pc.newline(),
                    pc.customEmoji(":blob:", "mxc://hs.tld/blob"),
                    pc.newline(),
                    pc.plain("```"),
                ],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe("<pre><code>:blob:\n</code></pre>\n");
        });

        it("become their shortcode in link targets and image alt text", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [
                    pc.plain("[x](https://a.b/"),
                    pc.customEmoji(":blob:", "mxc://hs.tld/blob"),
                    pc.plain(") ![a "),
                    pc.customEmoji(":blob:", "mxc://hs.tld/blob"),
                    pc.plain("](https://a.b/c.png)"),
                ],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe(
                '<a href="https://a.b/:blob:">x</a> <img src="https://a.b/c.png" alt="a :blob:">',
            );
        });

        it("leave no placeholder for an unknown emoji", () => {
            const md = "a \u20451\u2046 [b](https://a.b/\u20451\u2046) `\u20450\u2046`";
            const emoticons = [{ resourceId: "mxc://hs.tld/blob", text: ":blob:" }];
            expect(htmlSerializeFromMdIfNeeded(md, { emoticons })).toBe(
                'a  <a href="https://a.b/">b</a> <code>:blob:</code>',
            );
        });

        it("are sent as images without markdown", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.plain("a < "), pc.customEmoji(":blob:", "mxc://hs.tld/blob"), pc.newline(), pc.plain("*b*")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, { useMarkdown: false })).toBe(
                'a &lt; <img data-mx-emoticon src="mxc://hs.tld/blob" alt=":blob:" title=":blob:" height="32" /><br/>*b*',
            );
        });
    });

    describe("feature_latex_maths", () => {
        beforeEach(() => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((feature) => feature === "feature_latex_maths");
        });

        it("should support inline katex", () => {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("hello $\\xi$ world")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toMatchInlineSnapshot(`"hello <span data-mx-maths="\\xi"><code>\\xi</code></span> world"`);
        });

        it("should support block katex", () => {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("hello \n$$\\xi$$\n world")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toMatchInlineSnapshot(`
                "<p>hello</p>
                <div data-mx-maths="\\xi"><code>\\xi</code></div>
                <p>world</p>
                "
            `);
        });

        it("puts custom emoji in maths back as their shortcode", () => {
            const pc = createPartCreator();
            const model = new EditorModel(
                [pc.plain("hello $x "), pc.customEmoji(":blob:", "mxc://hs.tld/blob"), pc.plain("$ world")],
                pc,
            );
            expect(htmlSerializeIfNeeded(model, {})).toBe(
                'hello <span data-mx-maths="x :blob:"><code>x :blob:</code></span> world',
            );
        });

        it("should not mangle code blocks", () => {
            const pc = createPartCreator();
            const model = new EditorModel([pc.plain("hello\n```\n$\\xi$\n```\nworld")], pc);
            const html = htmlSerializeIfNeeded(model, {});
            expect(html).toMatchInlineSnapshot(`
                "<p>hello</p>
                <pre><code>$\\xi$
                </code></pre>
                <p>world</p>
                "
            `);
        });
    });
});
