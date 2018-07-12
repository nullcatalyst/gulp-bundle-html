export const SCRIPT_TAG_REGEX   = /<script([^>]*)\/>|<script([^>]*)>.*?<\/script[^>]*>/ig;
export const LINK_TAG_REGEX     = /<link([^\/>]*)\/?>/ig;
export const XML_ATTRIB_REGEX   = /(?<!<)\b([a-z0-9_]+)\s*(?:=\s*(?:'([^']*)'|"([^"]*)"))?/ig;

export const WS_REGEX           = /\s+/g;
export const ABSOLUTE_URL_REGEX = /^(?:[a-z]+:)?\/\//i;

export const HTML_CLASS_REGEX   = /\b(class)\s*(?:=\s*(?:'([^']*)'|"([^"]*)"))?/ig;
export const CSS_CLASS_REGEX    = /\.(-?[_a-z][_a-z0-9-]*)\b/ig;
export const JS_CLASS_REGEX     = /cssClassName\(([^\)]+)\)/ig;
