import * as path from "path";
import { promises as fs } from "fs";
import * as stream from "stream";
import * as Vinyl from "vinyl";
import * as PluginError from "plugin-error";
import * as through2 from "through2";
import * as _handlebars from "handlebars";

type Handlebars = typeof _handlebars;
type TemplateFn = (outputFileName: string, context: any, options?: Handlebars.RuntimeOptions) => void;

interface MapLike<T> {
    [id: string]: T;
}

interface Options {
    /**
     * Can be used to disable templating (pass `false`),
     * or can be used to pass a custom version of the handlebars library.
     */
    handlebars?: boolean | Handlebars;

    /**
     * Allows passing data to the template to render it.
     * Also allows outputting multiple files from a single template file,
     * by calling the template function multiple times.
     * 
     * The default is to simply render the handlebars template with an empty context `{}`
     * with the output file name left the same as the input, albeit changing the extension to `".html"`.
     */
    renderTemplate?: (template: TemplateFn, templatePath: string, done?: (error?: Error) => void) => void;

    baseUrl?: string;
    bundleJs?: boolean;
    bundleCss?: boolean;
    minifyCssClassNames?: boolean;
    minifyCssVarNames?: boolean;
    cssClassIgnoreList?: string[];
}

const PLUGIN_NAME = "gulp-bundle-html";
const PLUGIN_DEFAULTS = {
    handlebars: true,
    bundleJs: false,
    bundleCss: false,
    minifyCssClassNames: false,
    cssClassIgnoreList: [],
};

// Reusable Regex
const jsTagRegex = /<script([^>]*)\/>|<script([^>]*)>.*?<\/script[^>]*>/ig;
const jsSrcRegex = /src='([^']*)'|src="([^"]*)"/i;

const cssTagRegex = /<link([^>]*)>/ig;
const cssRelRegex = /rel='stylesheet'|rel="stylesheet"/i;
const cssSrcRegex = /href='([^']*)'|href="([^"]*)"/i;

const wsRegex = /\s+/g;
const htmlClassRegex = /class='(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+'|class="(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+"/ig;
const cssClassRegex = /\.-?[_a-z][_a-z0-9-]*\b/ig;
const jsClassRegex = /cssClassName\('(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+'\)|cssClassName\("(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+"\)/ig;

export = function gulpBundleHtml(options?: Options) {
    options = Object.assign({}, PLUGIN_DEFAULTS, options);
    const partials: MapLike<string> = {};
    const templates: Vinyl[] = [];

    const stream = through2({
        objectMode: true,
        highWaterMark: 128,
    }, function (file: Vinyl, encoding: string, callback: stream.TransformCallback) {
        if (file.isNull()) {
            // Nothing to do
            return callback(null, file);
        }

        if (file.isStream()) {
            stream.emit("error", new PluginError(PLUGIN_NAME, "Streams not supported!"));
        } else {
            const parsedPath = path.parse(file.path);
            if (parsedPath.name.startsWith("_")) {
                partials[parsedPath.name.slice(1)] = (file.contents as Buffer).toString("utf8");
                callback(null);
            } else {
                templates.push(file);
                callback(null);
            }
        }
    });

    async function bundleOutputFile(
        file: Vinyl,
        outputFileName: string,
        template: _handlebars.TemplateDelegate,
        context: any,
        templateOptions?: Handlebars.RuntimeOptions,
    ) {
        try {
            let html = template(context, templateOptions);
            const cssFiles: MapLike<string> = {};
            const jsFiles: MapLike<string> = {};
            const pauseFor: Promise<any>[] = [];

            if (options.bundleJs || options.minifyCssClassNames) {
                stringSearch(html, jsTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;

                    stringSearch(attributes, jsSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src.startsWith("/") ? src.slice(1) : src);
                            pauseFor.push(
                                fs.readFile(filePath, "utf8")
                                    .then((contents: string) => { jsFiles[filePath] = contents; })
                            );
                        }
                    });
                });
            }

            if (options.bundleCss || options.minifyCssClassNames) {
                stringSearch(html, cssTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;

                    // if the <link> tag does not contain rel="stylesheet", then ignore it
                    if (!cssRelRegex.test(attributes)) {
                        return fullMatch;
                    }

                    stringSearch(attributes, cssSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src.startsWith("/") ? src.slice(1) : src);
                            pauseFor.push(
                                fs.readFile(filePath, "utf8")
                                    .then((contents: string) => { cssFiles[filePath] = contents; })
                            );
                        }
                    });
                });
            }

            await Promise.all(pauseFor);
            pauseFor.length = 0;

            if (options.minifyCssClassNames) {
                const usageCounts: MapLike<number> = {};

                function addCssClass(className: string) {
                    // Check if this is a css class that should not be modified
                    if (options.cssClassIgnoreList && options.cssClassIgnoreList.indexOf(className) >= 0) {
                        return;
                    }

                    if (className in usageCounts) {
                        ++usageCounts[className];
                    } else {
                        usageCounts[className] = 1;
                    }
                }

                // HTML
                stringSearch(html, htmlClassRegex, (match: string) => {
                    const classes = match.slice("class='".length, -"'".length).trim();

                    const classList = classes.split(wsRegex);
                    for (const className of classList) {
                        addCssClass(className);
                    }
                });

                // CSS
                for (const fileName in cssFiles) {
                    const cssFileContents = cssFiles[fileName];
                    stringSearch(cssFileContents, cssClassRegex, (match: string) => {
                        // Remove the leading period
                        const className = match.slice(1);
                        addCssClass(className);
                    });
                }

                // JS
                for (const fileName in jsFiles) {
                    const jsFileContents = jsFiles[fileName];
                    stringSearch(jsFileContents, jsClassRegex, (match: string) => {
                        // Remove the leading period
                        const className = match.slice("cssClassName('".length, -"')".length).trim();
                        addCssClass(className);
                    });
                }

                // This is where the magic happens...
                // Replace the old CSS class names with new short names, prioritizing the names used most
                const orderedUsageCount = [...Object.entries(usageCounts)].sort((a, b) => b[1] - a[1]);
                const replacementNames: { [name: string]: string } = {};
                const nameGenerator = createStringGenerator();
                for (const [key, value] of orderedUsageCount) {
                    replacementNames[key] = nameGenerator.next().value;

                    if (value <= 1) {
                        console.warn(`${PLUGIN_NAME}: warning, css class "${key}" is only ever used once, consider removing`);
                    }
                }

                // HTML
                html = html.replace(htmlClassRegex, (match: string) => {
                    const prefix = match.slice(0, "class='".length);
                    const postfix = match.slice(-"'".length);
                    const classes = match.slice("class='".length, -"'".length).trim();

                    const classList = classes.split(wsRegex)
                        .map((className: string) => {
                            if (className in replacementNames) {
                                return replacementNames[className];
                            } else {
                                return className;
                            }
                        })
                        .join(" ");

                    return `${prefix}${classList}${postfix}`;
                });

                // CSS
                for (const fileName in cssFiles) {
                    cssFiles[fileName] = cssFiles[fileName].replace(cssClassRegex, (match: string) => {
                        const className = match.slice(1);
                        if (className in replacementNames) {
                            return `.${replacementNames[className]}`;
                        } else {
                            return match;
                        }
                    })
                }

                // JS
                for (const fileName in jsFiles) {
                    jsFiles[fileName] = jsFiles[fileName].replace(jsClassRegex, (match: string) => {
                        const className = match.slice("cssClassName('".length, -"')".length).trim();
                        if (className in replacementNames) {
                            return `"${replacementNames[className]}"`;
                        } else {
                            return match;
                        }
                    })
                }
            }

            if (options.bundleJs) {
                html = stringReplace(html, jsTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;
                    let contents: string;

                    stringSearch(attributes, jsSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src.startsWith("/") ? src.slice(1) : src);
                            contents = jsFiles[filePath];
                        }
                    });

                    if (contents) {
                        return `<script>${contents}</script>`;
                    } else {
                        return fullMatch;
                    }
                });
            } else if (options.minifyCssClassNames) {
                // Update the files with the minified source code
                for (let filePath in jsFiles) {
                    pauseFor.push(fs.writeFile(filePath, jsFiles[filePath], "utf8"));
                }
            }

            if (options.bundleCss) {
                html = stringReplace(html, cssTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;
                    let contents: string;

                    // if the <link> tag does not contain rel="stylesheet", then don't replace it
                    if (!cssRelRegex.test(attributes)) {
                        return fullMatch;
                    }

                    stringSearch(attributes, cssSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src.startsWith("/") ? src.slice(1) : src);
                            contents = cssFiles[filePath];
                        }
                    });

                    if (contents) {
                        return `<style>${contents}</style>`;
                    } else {
                        return fullMatch;
                    }
                });
            } else if (options.minifyCssClassNames) {
                // Update the files with the minified source code
                for (let filePath in cssFiles) {
                    pauseFor.push(fs.writeFile(filePath, cssFiles[filePath], "utf8"));
                }
            }

            await Promise.all(pauseFor);
            pauseFor.length = 0;

            const newFile = file.clone({ contents: false });
            newFile.contents = Buffer.from(html);
            newFile.path = path.resolve(file.base, outputFileName);
            stream.push(newFile);
        } catch (error) {
            stream.emit("error", new PluginError(PLUGIN_NAME, error));
        }
    }

    // Override the default `stream.end()` method so that we can wait until all of the sources have been read in
    // and then render all of the templates and emit their corresponding files
    const superEnd = stream.end.bind(stream);
    stream.end = () => {
        const results: Promise<any>[] = [];

        for (const file of templates) {
            if (options.handlebars) {
                let hbs: Handlebars;

                if (typeof options.handlebars === "boolean") {
                    hbs = _handlebars.create();
                } else {
                    hbs = options.handlebars.create();
                }

                for (const [key, value] of Object.entries(partials)) {
                    hbs.registerPartial(key, value);
                }

                const template = hbs.compile((file.contents as Buffer).toString("utf8"));
                const outputFile = (outputFileName: string, context: any, templateOptions?: Handlebars.RuntimeOptions) => {
                    results.push(bundleOutputFile(file, outputFileName, template, context, templateOptions));
                };

                const ext = path.extname(file.path);
                const name = file.relative.slice(0, -ext.length);
                if (options.renderTemplate) {
                    if (options.renderTemplate.length === 2) {
                        // If the `renderTemplate` function only takes 2 parameters,
                        // then assume that it is running synchronously
                        options.renderTemplate(outputFile, name);
                    } else {
                        // Idealy, if the `renderTemplate` function does not take 2 parameters, then it should take 3.
                        // The third parameter is a function to let us know that it is done.
                        // This allows asynchronously loading data for a given template.

                        const subresults: Promise<any>[] = [];
                        const subOutputFile = (outputFileName: string, context: any, templateOptions?: Handlebars.RuntimeOptions) => {
                            subresults.push(bundleOutputFile(file, outputFileName, template, context, templateOptions));
                        };

                        let resolve: (chain: Promise<{}>) => void;
                        let reject: (error: Error) => void;
                        const promise = new Promise((_resolve, _reject) => {
                            resolve = _resolve;
                            reject = _reject;
                        });
                        results.push(promise);

                        options.renderTemplate(subOutputFile, name, (error?: Error) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(Promise.all(subresults));
                            }
                        });
                    }
                } else {
                    outputFile(name + ".html", {});
                }
            }
        }

        Promise.all(results)
            .then(() => superEnd());
    }

    return stream;
}

////////////////////////////////
// Utility Functions

function stringSearch(
    value: string,
    regex: RegExp,
    matcher: (...substrings: string[]) => void,
): void {
    if (regex.global) {
        let match: RegExpExecArray;
        while (match = regex.exec(value)) {
            matcher(...match);
        }
    } else {
        let match: RegExpExecArray;
        if (match = regex.exec(value)) {
            matcher(...match);
        }
    }
}

function stringReplace(
    value: string,
    regex: RegExp,
    replacer: (...substrings: string[]) => string,
): string {
    return value.replace(regex, replacer);
}

async function stringReplaceAsync(
    value: string,
    regex: RegExp,
    replacer: (...substrings: string[]) => string | Promise<string>,
    callback?: () => void,
): Promise<string> {
    if (regex.global) {
        const partials: (string | Promise<string>)[] = [];

        let prevIndex = 0;
        let match: RegExpExecArray;
        while (match = regex.exec(value)) {
            // Push any string segments between the matches
            const prev = value.slice(prevIndex, match.index);
            partials.push(value.slice(prevIndex, match.index));
            prevIndex = match.index + match[0].length;

            // Replace the matched portion
            partials.push(replacer(...match));
        }

        // Push the last little tidbit of string
        partials.push(value.slice(prevIndex));

        // Allow some additional work to be done (synchronously) now that all of the matches have been found
        if (callback) {
            callback();
        }

        const all = await Promise.all(partials);
        return all.join("");
    } else {
        const partials: (string | Promise<string>)[] = [];

        let prevIndex = 0;
        let match: RegExpExecArray;
        if (match = regex.exec(value)) {
            // Push any string segments between the matches
            const before = value.slice(prevIndex, match.index);
            const after = value.slice(match.index + match[0].length);

            // Replace the matched portion
            value = before + (await replacer(...match)) + after;
        }

        // Allow some additional work to be done (synchronously) now that all of the matches have been found
        if (callback) {
            callback();
        }

        return value;
    }
}

function* createStringGenerator() {
    let accum = ["a"];

    next: for (;;) {
        yield accum.join("");

        let last = accum.length;
        --last;
        while (accum[last] !== undefined) {
            const c = nextChar(accum[last]);
            if (c <= "z") {
                accum[last] = c;
                continue next;
            } else {
                accum[last] = "a";
                --last;
            }
        }

        accum.unshift("a");
    }
}

function nextChar(c) {
    return String.fromCharCode(c.charCodeAt(0) + 1);
}
