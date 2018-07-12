import * as path from "path";
import { assert } from "chai";
import * as File from "vinyl";
import gulpBundleHtml = require("../src/index");

const HTML_CSS_IN = `<html>
    <link rel="stylesheet" href="/style-1.css"/>
    <link rel="stylesheet" href="/style-2.css"/>
    <div class="css-class-1 css-class-2"/>
</html>`;

const HTML_JS_IN = `<html>
    <div class="js-class-1 js-class-2"/>
    <script src="/script-1.js"></script>
    <script src="/script-2.js"></script>
</html>`;

const HTML_ALL_IN = `<html>
    <link rel="stylesheet" href="/style-1.css"/>
    <link rel="stylesheet" href="/style-2.css"/>
    <div class="css-class-1 css-class-2 js-class-1 js-class-2"/>
    <script src="/script-1.js"></script>
    <script src="/script-2.js"></script>
</html>`;

describe("gulp-bundle-html", function () {
    describe("in buffer mode", function () {
        it("should bundle css", function (done) {
            // create the fake file
            const fakeFile = new File({
                path: path.resolve(__dirname, "index.html"),
                contents: Buffer.from(HTML_CSS_IN),
            });

            // Create an instance of the plugin
            const plugin = gulpBundleHtml({
                handlebars: false,
                baseUrl: __dirname,
                bundleCss: true,
            });

            // write the fake file to it
            plugin.write(fakeFile);
            plugin.end();

            // wait for the file to come back out
            plugin.once("data", function (file: any) {
                try {
                    // make sure it came out the same way it went in
                    assert(file.isBuffer());
    
                    // check the contents
                    assert.equal(file.contents.toString("utf8"), `<html>
    <style>.css-class-1 {}</style>
    <style>.css-class-2 {}</style>
    <div class="css-class-1 css-class-2"/>
</html>`);

                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it("should combine css", function (done) {
            // create the fake file
            const fakeFile = new File({
                path: path.resolve(__dirname, "index.html"),
                contents: Buffer.from(HTML_CSS_IN),
            });

            // Create an instance of the plugin
            const plugin = gulpBundleHtml({
                handlebars: false,
                baseUrl: __dirname,
                bundleCss: true,
                combineCss: true,
            });

            // write the fake file to it
            plugin.write(fakeFile);
            plugin.end();

            // wait for the file to come back out
            plugin.once("data", function (file: any) {
                try {
                    // make sure it came out the same way it went in
                    assert(file.isBuffer());
    
                    // check the contents
                    assert.equal(file.contents.toString("utf8"), `<html>
    <style>.css-class-1 {}.css-class-2 {}</style>
    
    <div class="css-class-1 css-class-2"/>
</html>`);

                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it("should bundle js", function (done) {
            // create the fake file
            const fakeFile = new File({
                path: path.resolve(__dirname, "index.html"),
                contents: Buffer.from(HTML_JS_IN),
            });

            // Create an instance of the plugin
            const plugin = gulpBundleHtml({
                handlebars: false,
                baseUrl: __dirname,
                bundleJs: true,
            });

            // write the fake file to it
            plugin.write(fakeFile);
            plugin.end();

            // wait for the file to come back out
            plugin.once("data", function (file: any) {
                try {
                    // make sure it came out the same way it went in
                    assert(file.isBuffer());
    
                    // check the contents
                    assert.equal(file.contents.toString("utf8"), `<html>
    <div class="js-class-1 js-class-2"/>
    <script>cssClassName("js-class-1");</script>
    <script>cssClassName("js-class-2");</script>
</html>`);

                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it("should combine js", function (done) {
            // create the fake file
            const fakeFile = new File({
                path: path.resolve(__dirname, "index.html"),
                contents: Buffer.from(HTML_JS_IN),
            });

            // Create an instance of the plugin
            const plugin = gulpBundleHtml({
                handlebars: false,
                baseUrl: __dirname,
                bundleJs: true,
                combineJs: true,
            });

            // write the fake file to it
            plugin.write(fakeFile);
            plugin.end();

            // wait for the file to come back out
            plugin.once("data", function (file: any) {
                try {
                    // make sure it came out the same way it went in
                    assert(file.isBuffer());
    
                    // check the contents
                    assert.equal(file.contents.toString("utf8"), `<html>
    <div class="js-class-1 js-class-2"/>
    <script>cssClassName("js-class-1");cssClassName("js-class-2");</script>
    
</html>`);

                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it("should combine both css and js, and minify classes", function (done) {
            // create the fake file
            const fakeFile = new File({
                path: path.resolve(__dirname, "index.html"),
                contents: Buffer.from(HTML_ALL_IN),
            });

            // Create an instance of the plugin
            const plugin = gulpBundleHtml({
                handlebars: false,
                baseUrl: __dirname,
                bundleCss: true,
                combineCss: true,
                minifyCssClasses: true,
                bundleJs: true,
                combineJs: true,
            });

            // write the fake file to it
            plugin.write(fakeFile);
            plugin.end();

            // wait for the file to come back out
            plugin.once("data", function (file: any) {
                try {
                    // make sure it came out the same way it went in
                    assert(file.isBuffer());
    
                    // check the contents
                    assert.equal(file.contents.toString("utf8"), `<html>
    <style>.a {}.b {}</style>
    
    <div class="a b c d"/>
    <script>"c";"d";</script>
    
</html>`);

                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });
});
