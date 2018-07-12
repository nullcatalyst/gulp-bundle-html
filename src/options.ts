import * as handlebars from "handlebars";

type Handlebars = typeof handlebars;
type TemplateFn = (outputFileName: string, context: any, options?: Handlebars.RuntimeOptions) => void;

export interface Options {
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
    classesWhitelist?: string[];

    bundleCss?: boolean;
    combineCss?: boolean;

    minifyCssClasses?: boolean;
    minifyCssVariables?: boolean;

    bundleJs?: boolean;
    combineJs?: boolean;
}

export const PLUGIN_NAME = "gulp-bundle-html";
export const PLUGIN_DEFAULTS: Options = {
    handlebars: true,
    classesWhitelist: [],
    bundleCss: false,
    combineCss: false,
    minifyCssClasses: false,
    minifyCssVariables: false,
    bundleJs: false,
    combineJs: false,
};
