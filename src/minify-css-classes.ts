import { PLUGIN_NAME } from "./options";
import { MapLike } from "./map-like";
import { stringSearch, createStringGenerator } from "./string-util";
import { CSS_CLASS_REGEX, JS_CLASS_REGEX, HTML_CLASS_REGEX, WS_REGEX } from "./regex";

export function minifyCssClasses(html: string, cssFiles: MapLike<string>, jsFiles: MapLike<string>, whitelist: string[]): string {
    const usageCounts: MapLike<number> = {};

    function addCssClass(className: string) {
        // Check if this is a css class that should not be modified
        if (whitelist && whitelist.indexOf(className) >= 0) {
            return;
        }

        if (className in usageCounts) {
            ++usageCounts[className];
        } else {
            usageCounts[className] = 1;
        }
    }

    // HTML
    stringSearch(html, HTML_CLASS_REGEX, (attribMatch: string, attrib: "class", sQuoteValue: string, dQuoteValue: string) => {
        const classes = (sQuoteValue || dQuoteValue || "").trim();
        const classList = classes.split(WS_REGEX);
        for (const className of classList) {
            addCssClass(className);
        }
    });
    stringSearch(html, JS_CLASS_REGEX, (jsFuncMatch: string, param: string) => addCssClass(parseCssClassName(param)));

    // CSS
    for (const fileName in cssFiles) {
        const cssFileContents = cssFiles[fileName];
        stringSearch(cssFileContents, CSS_CLASS_REGEX, (classMatch: string, name: string) => addCssClass(name));
    }

    // JS
    for (const fileName in jsFiles) {
        const jsFileContents = jsFiles[fileName];
        stringSearch(jsFileContents, JS_CLASS_REGEX, (jsFuncMatch: string, param: string) => addCssClass(parseCssClassName(param)));
    }

    // This is where the magic happens...
    // Replace the old CSS class names with new short names, prioritizing the names used most
    const orderedUsageCount: [string, number][] = [...Object.entries(usageCounts)].sort((a, b) => b[1] - a[1]);
    const replacementNames: MapLike<string> = {};
    const nameGenerator = createStringGenerator();
    for (const [key, value] of orderedUsageCount) {
        replacementNames[key] = nameGenerator.next().value;

        if (value <= 1) {
            console.warn(`${PLUGIN_NAME}: warning, css class "${key}" is only ever used once, consider removing`);
        }
    }

    // HTML
    html = html.replace(HTML_CLASS_REGEX, (attribMatch: string, attrib: "class", sQuoteValue: string, dQuoteValue: string) => {
        const classes = (sQuoteValue || dQuoteValue || "").trim();
        const classList = classes.split(WS_REGEX)
            .map((className: string) => {
                if (className in replacementNames) {
                    return replacementNames[className];
                } else {
                    return className;
                }
            })
            .join(" ");

        if (sQuoteValue) {
            return `'${classList}'`;
        } else {
            return `"${classList}"`;
        }
    });
    html = html.replace(JS_CLASS_REGEX, (jsFuncMatch: string, param: string) => {
        // Sometimes there is inline javascript kept in some of the HTML attributes,
        // this allows us to handle those as well
        return replaceCssClassName(param, replacementNames);
    });

    // CSS
    for (const fileName in cssFiles) {
        cssFiles[fileName] = cssFiles[fileName].replace(CSS_CLASS_REGEX, (classMatch: string, name: string) => {
            if (name in replacementNames) {
                return `.${replacementNames[name]}`;
            } else {
                return classMatch;
            }
        });
    }

    // JS
    for (const fileName in jsFiles) {
        jsFiles[fileName] = jsFiles[fileName].replace(JS_CLASS_REGEX, (jsFuncMatch: string, param: string) => replaceCssClassName(param, replacementNames));
    }

    return html;
}

function parseCssClassName(cssClassName: string) {
    cssClassName = cssClassName.trim();

    if (cssClassName.startsWith("'") || cssClassName.startsWith("\"")) {
        return cssClassName.slice(1, -1);
    } else {
        return cssClassName;
    }
}

function replaceCssClassName(cssClassName: string, replacementNames: MapLike<string>) {
    cssClassName = cssClassName.trim();

    if (cssClassName.startsWith("'") || cssClassName.startsWith("\"")) {
        let className = cssClassName.slice(1, -1);

        if (className in replacementNames) {
            return `${cssClassName.slice(0, 1)}${replacementNames[className]}${cssClassName.slice(-1)}`;
        } else {
            return cssClassName;
        }
    } else {
        if (cssClassName in replacementNames) {
            return replacementNames[cssClassName];
        } else {
            return cssClassName;
        }
    }
}
