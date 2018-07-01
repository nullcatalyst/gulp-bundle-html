export function stringSearch(
    value: string,
    regex: RegExp,
    matcher: (...substrings: string[]) => void,
): void {
    let match: RegExpExecArray;
    while (match = regex.exec(value)) {
        matcher(...match);
    }
}

export function stringReplace(
    value: string,
    regex: RegExp,
    replacer: (...substrings: string[]) => string,
): string {
    return value.replace(regex, replacer);
}

export async function stringReplaceAsync(
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

export function* createStringGenerator() {
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
