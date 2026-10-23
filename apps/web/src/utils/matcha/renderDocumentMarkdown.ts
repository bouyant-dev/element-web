/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { Marked, Renderer } from "marked";
import { escape } from "lodash";
import { sanitizeHtml } from "@element-hq/element-web-shared-utils";

import { sanitizeHtmlParams } from "../../Linkify";

const renderer = new Renderer();
renderer.link = function (token) {
    return Renderer.prototype.link.call(this, token).replace("<a ", '<a target="_blank" rel="noreferrer noopener" ');
};
renderer.html = ({ text }) => (/^<\/?(?:sub|sup|del|s|u|br)\/?\s*>$/.test(text) ? text : escape(text));
// Render checklist state without introducing form controls into a shared document preview.
renderer.checkbox = ({ checked }) => (checked ? "☑ " : "☐ ");

const parser = new Marked({ renderer, gfm: true, breaks: false, async: false });

/** Render Docs tables, checklists and strikethrough with the existing safe-link and image policy. */
export function renderDocumentMarkdown(source: string): string {
    return sanitizeHtml(parser.parse(source, { async: false }), sanitizeHtmlParams);
}
