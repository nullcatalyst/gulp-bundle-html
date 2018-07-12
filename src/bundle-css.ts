import * as path from "path";
import { promises as fs } from "fs";
import { MapLike } from "./map-like";
import { stringSearch, stringReplace, createXmlAttrib } from "./string-util";
import { SCRIPT_TAG_REGEX, XML_ATTRIB_REGEX, ABSOLUTE_URL_REGEX } from "./regex";

export async function bundleCssPrep(html: string, jsFiles: MapLike<string>, baseUrl: string) {
    const promises: Promise<void>[] = [];

    stringSearch(html, SCRIPT_TAG_REGEX, (fullMatch: string, attribShort: string, attribLong: string) => {
        const attributes = attribShort || attribLong;

        stringSearch(attributes, XML_ATTRIB_REGEX, (fullMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
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

export function bundleCss(html: string, cssFiles: MapLike<string>, baseUrl: string): string {
    const outputAttributes: MapLike<string> = {};

    return stringReplace(html, SCRIPT_TAG_REGEX, (tagMatch: string, attributes: string) => {
        let isCss: boolean = false;
        let contents: string = "";

        stringSearch(attributes, XML_ATTRIB_REGEX, (attribMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
            const value = (sQuoteValue || dQuoteValue || "").trim();

            if (attrib === "rel") {
                if (value !== "stylesheet") {
                    isCss = true;
                } else {
                    isCss = false;
                }
            } else if (attrib === "href") {
                const filePath = path.resolve(baseUrl, value.startsWith("/") ? value.slice(1) : value);
                contents = cssFiles[filePath];
            } else {
                outputAttributes[attrib] = (sQuoteValue || dQuoteValue); // allow undefined
            }
        });

        // If the <link> tag does not contain rel="stylesheet", then don't replace it
        if (!isCss) return tagMatch;

        if (contents) {
            return `<style${Object.entries(outputAttributes).map(createXmlAttrib).join("")}>${contents}</style>`;
        } else {
            return tagMatch;
        }
    });
}

const PLACEHOLDER = "<$STYLE$>";
export function combineCss(html: string, cssFiles: MapLike<string>, baseUrl: string): string {
    const outputContents: string[] = [];
    const outputAttributes: MapLike<string> = {};

    let first: boolean = true;
    html = stringReplace(html, SCRIPT_TAG_REGEX, (tagMatch: string, attributes: string) => {
        let isCss: boolean = false;
        let contents: string = "";

        stringSearch(attributes, XML_ATTRIB_REGEX, (attribMatch: string, attrib: string, sQuoteValue: string, dQuoteValue: string) => {
            const value = (sQuoteValue || dQuoteValue || "").trim();

            if (attrib === "rel") {
                if (value !== "stylesheet") {
                    isCss = true;
                } else {
                    isCss = false;
                }
            } else if (attrib === "href") {
                const filePath = path.resolve(baseUrl, value.startsWith("/") ? value.slice(1) : value);
                contents = cssFiles[filePath];
            } else {
                outputAttributes[attrib] = (sQuoteValue || dQuoteValue); // allow undefined
            }
        });

        // If the <link> tag does not contain rel="stylesheet", then don't replace it
        if (!isCss) return tagMatch;

        if (contents) {
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

    const output = `<style${Object.entries(outputAttributes).map(createXmlAttrib).join("")}>${outputContents.join("")}</style>`;
    return html.replace(PLACEHOLDER, output);
}
