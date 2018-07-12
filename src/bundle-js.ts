import * as path from "path";
import { promises as fs } from "fs";
import { MapLike } from "./map-like";
import { stringSearch, stringReplace, createXmlAttrib } from "./string-util";
import { SCRIPT_TAG_REGEX, XML_ATTRIB_REGEX, ABSOLUTE_URL_REGEX } from "./regex";

export async function bundleJsPrep(html: string, jsFiles: MapLike<string>, baseUrl: string) {
    const promises: Promise<void>[] = [];

    stringSearch(html, SCRIPT_TAG_REGEX, (tagMatch: string, attribShort: string, attribLong: string) => {
        const attributes = attribShort || attribLong;

        stringSearch(attributes, XML_ATTRIB_REGEX, (attribMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
            if (attrib !== "src") {
                return;
            }

            const value = (sQuoteValue || dQuoteValue || "").trim();
            if (value && !ABSOLUTE_URL_REGEX.test(value)) {
                const filePath = path.resolve(baseUrl, value.startsWith("/") ? value.slice(1) : value);
                promises.push(
                    fs.readFile(filePath, "utf8")
                        .then((contents: string) => { jsFiles[filePath] = contents; })
                );
            }
        });
    });

    return Promise.all(promises);
}

export function bundleJs(html: string, jsFiles: MapLike<string>, baseUrl: string): string {
    return stringReplace(html, SCRIPT_TAG_REGEX, (tagMatch: string, selfClosingAttribs: string, xmlAttribs: string) => {
        const attributes = (selfClosingAttribs || xmlAttribs || "").trim();
        const outputAttributes: MapLike<string> = {};
        let contents: string = "";

        stringSearch(attributes, XML_ATTRIB_REGEX, (attribMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
            const value = (sQuoteValue || dQuoteValue || "").trim();

            if (attrib === "src") {
                const filePath = path.resolve(baseUrl, value.startsWith("/") ? value.slice(1) : value);
                contents = jsFiles[filePath];
            } else {
                outputAttributes[attrib] = (sQuoteValue || dQuoteValue); // allow undefined
            }
        });

        if (contents) {
            return `<script${Object.entries(outputAttributes).map(createXmlAttrib).join("")}>${contents}</script>`;
        } else {
            return tagMatch;
        }
    });
}

const PLACEHOLDER = "<$SCRIPT$>";
export function combineJs(html: string, jsFiles: MapLike<string>, baseUrl: string): string {
    const outputContents: string[] = [];
    const outputAttributes: MapLike<string> = {};

    let first: boolean = true;
    html = stringReplace(html, SCRIPT_TAG_REGEX, (tagMatch: string, selfClosingAttribs: string, xmlAttribs: string) => {
        const attributes = (selfClosingAttribs || xmlAttribs || "").trim();
        let contents: string = "";

        stringSearch(attributes, XML_ATTRIB_REGEX, (attribMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
            const value = (sQuoteValue || dQuoteValue || "").trim();

            if (attrib === "src") {
                const filePath = path.resolve(baseUrl, value.startsWith("/") ? value.slice(1) : value);
                contents = jsFiles[filePath];
            } else {
                outputAttributes[attrib] = (sQuoteValue || dQuoteValue); // allow undefined
            }
        });

        if (contents) {
            outputContents.push(contents);

            if (first) {
                first = false;
                return PLACEHOLDER;
            } else {
                return "";
            }
        } else {
            return tagMatch;
        }
    });

    const output = `<script${Object.entries(outputAttributes).map(createXmlAttrib).join("")}>${outputContents.join("")}</script>`;
    return html.replace(PLACEHOLDER, output);
}
