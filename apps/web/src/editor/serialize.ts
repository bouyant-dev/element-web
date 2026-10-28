/*
Copyright 2024 New Vector Ltd.
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { encode } from "html-entities";
import escapeHtml from "escape-html";

import Markdown from "../Markdown";
import { makeGenericPermalink } from "../utils/permalinks/Permalinks";
import type EditorModel from "./model";
import SettingsStore from "../settings/SettingsStore";
import SdkConfig from "../SdkConfig";
import { Type } from "./parts";
import { emoticonHtml } from "../utils/matcha/imagePacks";

// Custom emoji go through markdown as "\u2045<n>\u2046", n counting them in order. These rare brackets and digits mean
// nothing to markdown, whereas raw <img> markup can turn the whole message into an html block; being punctuation,
// they also let "_" emphasis open or close next to an emoji, as its ":shortcode:" text would.
const EMOTICON_PLACEHOLDER = /\u2045(\d+)\u2046/g;
// The same placeholder after markdown percent-encoded it into a link target.
const ENCODED_EMOTICON_PLACEHOLDER = /%E2%81%85(\d+)%E2%81%86/gi;

/** A custom emoji part to put back into the HTML: the mxc URL of its image and its ":shortcode:" text. */
interface Emoticon {
    resourceId: string;
    text: string;
}

export function mdSerialize(model: EditorModel): string {
    let emoticonCount = 0;
    return model.parts.reduce((html, part) => {
        switch (part.type) {
            case Type.Newline:
                return html + "\n";
            case Type.Plain:
            case Type.Emoji:
            case Type.Command:
            case Type.PillCandidate:
            case Type.AtRoomPill:
                return html + part.text;
            case Type.RoomPill: {
                const url = makeGenericPermalink(part.resourceId, true);
                // Escape square brackets and backslashes
                // Here we use the resourceId for compatibility with non-rich text clients
                // See https://github.com/vector-im/element-web/issues/16660
                const title = part.resourceId.replace(/[[\\\]]/g, (c) => "\\" + c);
                return html + `[${title}](${url})`;
            }
            case Type.UserPill: {
                const url = makeGenericPermalink(part.resourceId, true);
                // Escape square brackets and backslashes; convert newlines to HTML
                const title = part.text.replace(/[[\\\]]/g, (c) => "\\" + c).replace(/\n/g, "<br>");
                return html + `[${title}](${url})`;
            }
            case Type.CustomEmoji:
                return html + `\u2045${emoticonCount++}\u2046`;
        }
    }, "");
}

interface ISerializeOpts {
    forceHTML?: boolean;
    useMarkdown?: boolean;
}

export function htmlSerializeIfNeeded(
    model: EditorModel,
    { forceHTML = false, useMarkdown = true }: ISerializeOpts = {},
): string | undefined {
    if (!useMarkdown) {
        // Escape part by part so custom emoji can become images.
        return model.parts
            .map((part) =>
                part.type === Type.CustomEmoji
                    ? emoticonHtml(part.resourceId, shortcodeOf(part))
                    : escapeHtml(textSerialize({ parts: [part] })),
            )
            .join("")
            .replace(/\n/g, "<br/>");
    }

    const md = mdSerialize(model);
    const emoticons = model.parts.flatMap((part) => (part.type === Type.CustomEmoji ? [part] : []));
    return htmlSerializeFromMdIfNeeded(md, { forceHTML, emoticons });
}

function shortcodeOf(emoticon: Emoticon): string {
    return emoticon.text.replace(/^:|:$/g, "");
}

/**
 * Replaces the custom emoji placeholders left in rendered markdown with emoji images, or with their ":shortcode:"
 * text inside code and attributes (link targets, image alt text, LaTeX source). A placeholder without a matching
 * emoji is removed, so none reaches the sent HTML.
 */
function restoreEmoticons(doc: Document, emoticons: Emoticon[]): void {
    const textOf = (n: string): string => emoticons[Number(n)]?.text ?? "";
    for (const element of doc.body.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
            attribute.value = attribute.value
                .replace(EMOTICON_PLACEHOLDER, (_, n) => textOf(n))
                .replace(ENCODED_EMOTICON_PLACEHOLDER, (_, n) => encodeURI(textOf(n)));
        }
    }

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    for (const node of textNodes) {
        // Splitting on the capturing pattern puts the emoji numbers at the odd indexes.
        const pieces = node.data.split(EMOTICON_PLACEHOLDER);
        if (pieces.length === 1) continue;
        const inCode = !!node.parentElement?.closest("code, pre");
        node.replaceWith(
            ...pieces.map((piece, i) => {
                if (i % 2 === 0) return piece;
                const emoticon = emoticons[Number(piece)];
                if (!emoticon) return "";
                if (inCode) return emoticon.text;
                const template = doc.createElement("template");
                template.innerHTML = emoticonHtml(emoticon.resourceId, shortcodeOf(emoticon));
                return template.content;
            }),
        );
    }
}

/**
 * Renders markdown to HTML, or returns undefined if it is plain text and `forceHTML` is not set.
 * `emoticons` are the custom emoji whose placeholders are in `md`, in order; HTML is always returned when there are any.
 */
export function htmlSerializeFromMdIfNeeded(
    md: string,
    { forceHTML = false, emoticons = [] }: { forceHTML?: boolean; emoticons?: Emoticon[] } = {},
): string | undefined {
    // copy of raw input to remove unwanted math later
    const orig = md;

    if (SettingsStore.getValue("feature_latex_maths")) {
        const patternNames = ["tex", "latex"] as const;
        const patternTypes = ["display", "inline"] as const;
        const patternDefaults = {
            tex: {
                // detect math with tex delimiters, inline: $...$, display $$...$$
                // preferably use negative lookbehinds, not supported in all major browsers:
                // const displayPattern = "^(?<!\\\\)\\$\\$(?![ \\t])(([^$]|\\\\\\$)+?)\\$\\$$";
                // const inlinePattern = "(?:^|\\s)(?<!\\\\)\\$(?!\\s)(([^$]|\\\\\\$)+?)(?<!\\\\|\\s)\\$";

                // conditions for display math detection $$...$$:
                // - pattern starts and ends on a new line
                // - left delimiter ($$) is not escaped by backslash
                display: "(^)\\$\\$(([^$]|\\\\\\$)+?)\\$\\$$",

                // conditions for inline math detection $...$:
                // - pattern starts at beginning of line, follows whitespace character or punctuation
                // - pattern is on a single line
                // - left and right delimiters ($) are not escaped by backslashes
                // - left delimiter is not followed by whitespace character
                // - right delimiter is not prefixed with whitespace character
                inline: "(^|\\s|[.,!?:;])(?!\\\\)\\$(?!\\s)(([^$\\n]|\\\\\\$)*([^\\\\\\s\\$]|\\\\\\$)(?:\\\\\\$)?)\\$",
            },
            latex: {
                // detect math with latex delimiters, inline: \(...\), display \[...\]

                // conditions for display math detection \[...\]:
                // - pattern starts and ends on a new line
                // - pattern is not empty
                display: "(^)\\\\\\[(?!\\\\\\])(.*?)\\\\\\]$",

                // conditions for inline math detection \(...\):
                // - pattern starts at beginning of line or is not prefixed with backslash
                // - pattern is not empty
                inline: "(^|[^\\\\])\\\\\\((?!\\\\\\))(.*?)\\\\\\)",
            },
        };

        patternNames.forEach(function (patternName) {
            patternTypes.forEach(function (patternType) {
                // get the regex replace pattern from config or use the default
                const pattern =
                    SdkConfig.get("latex_maths_delims")?.[patternType]?.["pattern"]?.[patternName] ||
                    patternDefaults[patternName][patternType];

                md = md.replace(RegExp(pattern, "gms"), function (m, p1, p2) {
                    const p2e = encode(p2);
                    switch (patternType) {
                        case "display":
                            return `${p1}<div data-mx-maths="${p2e}">\n\n</div>\n\n`;
                        case "inline":
                            return `${p1}<span data-mx-maths="${p2e}"></span>`;
                    }
                });
            });
        });

        // make sure div tags always start on a new line, otherwise it will confuse the markdown parser
        md = md.replace(/(.)<div/g, function (m, p1) {
            return `${p1}\n<div`;
        });
    }

    const parser = new Markdown(md);
    if (!parser.isPlainText() || forceHTML || emoticons.length) {
        // feed Markdown output to HTML parser
        const phtml = new DOMParser().parseFromString(parser.toHTML(), "text/html");

        if (SettingsStore.getValue("feature_latex_maths")) {
            // original Markdown without LaTeX replacements
            const parserOrig = new Markdown(orig);
            const phtmlOrig = new DOMParser().parseFromString(parserOrig.toHTML(), "text/html");

            // since maths delimiters are handled before Markdown,
            // code blocks could contain mangled content.
            // replace code blocks with original content
            [...phtmlOrig.getElementsByTagName("code")].forEach((e, i) => {
                phtml.getElementsByTagName("code").item(i)!.textContent = e.textContent;
            });

            // add fallback output for latex math, which should not be interpreted as markdown
            [...phtml.querySelectorAll("div, span")].forEach((e, i) => {
                const tex = e.getAttribute("data-mx-maths");
                if (tex) {
                    e.innerHTML = `<code>${tex}</code>`;
                }
            });
        }
        if (emoticons.length) restoreEmoticons(phtml, emoticons);
        return phtml.body.innerHTML;
    }
    // ensure removal of escape backslashes in non-Markdown messages
    if (md.indexOf("\\") > -1) {
        return parser.toPlaintext();
    }
}

export function textSerialize(model: Pick<EditorModel, "parts">): string {
    return model.parts.reduce((text, part) => {
        switch (part.type) {
            case Type.Newline:
                return text + "\n";
            case Type.Plain:
            case Type.Emoji:
            case Type.Command:
            case Type.PillCandidate:
            case Type.AtRoomPill:
                return text + part.text;
            case Type.RoomPill:
                // Here we use the resourceId for compatibility with non-rich text clients
                // See https://github.com/vector-im/element-web/issues/16660
                return text + part.resourceId;
            case Type.UserPill:
            case Type.CustomEmoji:
                return text + part.text;
        }
    }, "");
}

export function containsEmote(model: EditorModel): boolean {
    const hasCommand = startsWith(model, "/me ", false);
    const hasArgument = model.parts[0]?.text?.length > 4 || model.parts.length > 1;
    return hasCommand && hasArgument;
}

export function startsWith(model: EditorModel, prefix: string, caseSensitive = true): boolean {
    const firstPart = model.parts[0];
    // part type will be "plain" while editing,
    // and "command" while composing a message.
    let text = firstPart?.text || "";
    if (!caseSensitive) {
        prefix = prefix.toLowerCase();
        text = text.toLowerCase();
    }

    return firstPart && (firstPart.type === Type.Plain || firstPart.type === Type.Command) && text.startsWith(prefix);
}

export function stripEmoteCommand(model: EditorModel): EditorModel {
    // trim "/me "
    return stripPrefix(model, "/me ");
}

export function stripPrefix(model: EditorModel, prefix: string): EditorModel {
    model = model.clone();
    model.removeText({ index: 0, offset: 0 }, prefix.length);
    return model;
}

export function unescapeMessage(model: EditorModel): EditorModel {
    const { parts } = model;
    if (parts.length) {
        const firstPart = parts[0];
        // only unescape \/ to / at start of editor
        if (firstPart.type === Type.Plain && firstPart.text.startsWith("\\/")) {
            model = model.clone();
            model.removeText({ index: 0, offset: 0 }, 1);
        }
    }
    return model;
}
