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
    bundleCSS?: boolean;
    bundleJS?: boolean;
}

const PLUGIN_NAME = "gulp-bundle-html";
const PLUGIN_DEFAULTS = {
    handlebars: true,
    bundleCss: false,
    bundleJs: false,
};

export default function gulpBundleHtml(options?: Options) {
    options = Object.assign({}, options, PLUGIN_DEFAULTS);
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
                    results.push((async () => {
                        try {
                            const newFile = file.clone({
                                contents: false,
                            });

                            let result = template(context, templateOptions);

                            if (options.bundleCSS) {
                                result = await stringReplaceAsync(result, /<style([^>]*)\/>|<style([^>]*)>.*?<\/style[^>]*>/ig, async (fullMatch: string, attribShort: string, attribLong: string) => {
                                    const attributes = attribShort || attribLong;

                                    const match = attributes.match(/src='([^']*)'|src="([^"]*)"/i);
                                    if (match) {
                                        const src = match[1] || match[2];
                                        if (src) {
                                            const js = await fs.readFile(path.resolve(options.baseUrl || file.base, src), "utf8");
                                            return `<style>${js}</style>`;
                                        }
                                    }

                                    return fullMatch;
                                });
                            }

                            if (options.bundleJS) {
                                result = await stringReplaceAsync(result, /<script([^>]*)\/>|<script([^>]*)>.*?<\/script[^>]*>/ig, async (fullMatch: string, attribShort: string, attribLong: string) => {
                                    const attributes = attribShort || attribLong;

                                    const match = attributes.match(/src='([^']*)'|src="([^"]*)"/i);
                                    if (match) {
                                        const src = match[1] || match[2];
                                        if (src) {
                                            const js = await fs.readFile(path.resolve(options.baseUrl || file.base, src), "utf8");
                                            return `<script>${js}</script>`;
                                        }
                                    }

                                    return fullMatch;
                                });
                            }

                            newFile.contents = Buffer.from(result);
                            newFile.path = path.resolve(file.base, outputFileName);
                            stream.push(newFile);
                        } catch (error) {
                            stream.emit("error", new PluginError(PLUGIN_NAME, error));
                        }
                    })());
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

async function stringReplaceAsync(value: string, regex: RegExp, replacer: (...substrings: string[]) => string | Promise<string>): Promise<string> {
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

    const all = await Promise.all(partials);
    return all.join("");
}
