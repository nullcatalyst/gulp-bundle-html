import * as path from "path";
import { promises as fs } from "fs";
import { MapLike } from "./map-like";
import { stringSearch, stringReplace } from "./string-util";
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
    const outputAttributes: MapLike<string> = {};

    return stringReplace(html, SCRIPT_TAG_REGEX, (tagMatch: string, attributes: string) => {
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
            const attribs = Object.entries(outputAttributes).map(([key, value]) => value === undefined ? key : `${key}="${value}"`).join(" ");
            return `<script ${attribs}>${contents}</script>`;
        } else {
            return tagMatch;
        }
    });
}
