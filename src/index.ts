import * as path from "path";
import { promises as fs } from "fs";
import * as stream from "stream";
import * as Vinyl from "vinyl";
import * as PluginError from "plugin-error";
import * as through2 from "through2";
import * as _handlebars from "handlebars";

import { MapLike } from "./map-like";
import { Options, PLUGIN_NAME, PLUGIN_DEFAULTS } from "./options";
import { bundleCssPrep, bundleCss } from "./bundle-css";
import { bundleJsPrep, bundleJs } from "./bundle-js";
import { minifyClassNames } from "./minify-class";

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

    // Override the default `stream.end()` method so that we can wait until all of the sources have been read in
    // and then render all of the templates and emit their corresponding files
    const superEnd = stream.end.bind(stream);
    stream.end = onEndStream;
    return stream;

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
            const promises: Promise<any>[] = [];

            if (options.bundleJs || options.minifyCssClasses) {
                promises.push(bundleJsPrep(html, jsFiles, options.baseUrl || file.base));
            }

            if (options.bundleCss || options.minifyCssClasses) {
                promises.push(bundleCssPrep(html, cssFiles, options.baseUrl || file.base));
            }

            await Promise.all(promises);
            promises.length = 0;

            if (options.minifyCssClasses) {
                html = minifyClassNames(html, cssFiles, jsFiles, options.classesWhitelist || []);
            }

            if (options.bundleJs) {
                html = bundleJs(html, jsFiles, options.baseUrl || file.base);
            } else if (options.minifyCssClasses) {
                // Update the files with the minified source code
                for (let filePath in jsFiles) {
                    promises.push(fs.writeFile(filePath, jsFiles[filePath], "utf8"));
                }
            }

            if (options.bundleCss) {
                html = bundleCss(html, cssFiles, options.baseUrl || file.base);
            } else if (options.minifyCssClasses) {
                // Update the files with the minified source code
                for (let filePath in cssFiles) {
                    promises.push(fs.writeFile(filePath, cssFiles[filePath], "utf8"));
                }
            }

            await Promise.all(promises);
            promises.length = 0;

            const newFile = file.clone({ contents: false });
            newFile.contents = Buffer.from(html);
            newFile.path = path.resolve(file.base, outputFileName);
            stream.push(newFile);
        } catch (error) {
            stream.emit("error", new PluginError(PLUGIN_NAME, error));
        }
    }

    function onEndStream() {
        const results: Promise<any>[] = [];

        for (const file of templates) {
            if (options.handlebars) {
                let hbs: typeof _handlebars;

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
}
