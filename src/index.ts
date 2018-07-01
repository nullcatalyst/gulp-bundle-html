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
    renderTemplate?: (template: TemplateFn, templatePath: string) => void;

    baseUrl?: string;
    bundleJs?: boolean;
    bundleCss?: boolean;
    minifyCssClassNames?: boolean;
    minifyCssVarNames?: boolean;
}

const PLUGIN_NAME = "gulp-bundle-html";
const PLUGIN_DEFAULTS = {
    handlebars: true,
    bundleJs: false,
    bundleCss: false,
    minifyCssClassNames: false,
};

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

            if (options.bundleJs) {
                const scriptTagRegex = /<script([^>]*)\/>|<script([^>]*)>.*?<\/script[^>]*>/ig;
                const scriptSrcRegex = /src='([^']*)'|src="([^"]*)"/i;

                stringSearch(html, scriptTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;

                    stringSearch(attributes, scriptSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src);
                            pauseFor.push(
                                fs.readFile(filePath, "utf8")
                                    .then((contents: string) => { jsFiles[filePath] = contents; })
                            );
                        }
                    });
                });
            }

            if (options.bundleCss) {
                const styleTagRegex = /<style([^>]*)\/>|<style([^>]*)>.*?<\/style[^>]*>/ig;
                const styleSrcRegex = /src='([^']*)'|src="([^"]*)"/i;

                stringSearch(html, styleTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;

                    stringSearch(attributes, styleSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src);
                            pauseFor.push(
                                fs.readFile(filePath, "utf8")
                                    .then((contents: string) => { cssFiles[filePath] = contents; })
                            );
                        }
                    });
                });
            }

            await Promise.all(pauseFor);

            if (options.minifyCssClassNames) {
                const whitespaceRegex = /\s+/;
                const htmlRegex = /class='(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+'|class="(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+"/ig;
                const cssRegex = /\.-?[_a-z][_a-z0-9-]*\b/ig;
                const jsRegex = /cssClassName\('(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+'\)|cssClassName\("(?:\s*-?[_a-z]+[_a-z0-9-]*\s*)+"\)/ig;

                const usageCounts: MapLike<number> = {};

                // HTML
                stringSearch(html, htmlRegex, (match: string) => {
                    const classes = match[0].slice("class='".length, -"'".length).trim();

                    const classList = classes.split(/\s+/);
                    for (const className of classList) {
                        if (className in usageCounts) {
                            ++usageCounts[className];
                        } else {
                            usageCounts[className] = 1;
                        }
                    }
                });

                // CSS
                for (const fileName in cssFiles) {
                    const cssFileContents = cssFiles[fileName];
                    stringSearch(cssFileContents, cssRegex, (match: string) => {
                        // Remove the leading period
                        const className = match.slice(1);

                        // Increment the usage count
                        if (className in usageCounts) {
                            ++usageCounts[className];
                        } else {
                            usageCounts[className] = 1;
                        }
                    });
                }

                // JS
                for (const fileName in jsFiles) {
                    const jsFileContents = jsFiles[fileName];
                    stringSearch(jsFileContents, jsRegex, (match: string) => {
                        // Remove the leading period
                        const className = match.slice("cssClassName('".length, -"')".length).trim();

                        // Increment the usage count
                        if (className in usageCounts) {
                            ++usageCounts[className];
                        } else {
                            usageCounts[className] = 1;
                        }
                    });
                }

                // This is where the magic happens...
                // Replace the old CSS class names with new short names, prioritizing the names used most
                const orderedUsageCount = [...Object.entries(usageCounts)].sort((a, b) => b[1] - a[1]);
                const replacementNames: {[name: string]: string} = {};
                const nameGenerator = createStringGenerator();
                for (const [key, value] of orderedUsageCount) {
                    replacementNames[key] = nameGenerator.next().value;
                }

                // HTML
                html = html.replace(htmlRegex, (match: string) => {
                    const prefix = match.slice(0, "class='".length);
                    const postfix = match.slice(-"'".length);
                    const classes = match.slice("class='".length, -"'".length).trim();
        
                    const classList = classes.split(whitespaceRegex)
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
                    cssFiles[fileName] = cssFiles[fileName].replace(cssRegex, (match: string) => {
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
                    jsFiles[fileName] = jsFiles[fileName].replace(jsRegex, (match: string) => {
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
                const scriptTagRegex = /<script([^>]*)\/>|<script([^>]*)>.*?<\/script[^>]*>/ig;
                const scriptSrcRegex = /src='([^']*)'|src="([^"]*)"/i;

                stringReplace(html, scriptTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;
                    let contents: string;

                    stringSearch(attributes, scriptSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src);
                            contents = jsFiles[filePath];
                        }
                    });

                    if (contents) {
                        return `<script>${contents}</script>`;
                    } else {
                        return fullMatch;
                    }
                });
            }

            if (options.bundleCss) {
                const styleTagRegex = /<style([^>]*)\/>|<style([^>]*)>.*?<\/style[^>]*>/ig;
                const styleSrcRegex = /src='([^']*)'|src="([^"]*)"/i;

                stringReplace(html, styleTagRegex, (fullMatch: string, attribShort: string, attribLong: string) => {
                    const attributes = attribShort || attribLong;
                    let contents: string;

                    stringSearch(attributes, styleSrcRegex, (fullMatch: string, singleQuoteSrc: string, doubleQuoteSrc: string) => {
                        const src = singleQuoteSrc || doubleQuoteSrc;
                        if (src) {
                            const filePath = path.resolve(options.baseUrl || file.base, src);
                            contents = cssFiles[filePath];
                        }
                    });

                    if (contents) {
                        return `<style>${contents}</style>`;
                    } else {
                        return fullMatch;
                    }
                });
            }

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
                    options.renderTemplate(outputFile, name);
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
    let match: RegExpExecArray;
    while (match = regex.exec(value)) {
        matcher(...match);
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
