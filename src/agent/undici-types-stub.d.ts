// The Anthropic SDK's typings probe for `undici-types` and `undici` to type a Node fetch's
// options, and both packages bring all of `@types/node` with them — Node's globals in a
// browser build, where `setTimeout` would start returning a `NodeJS.Timeout`.
// tsconfig.app.json maps both names here instead; the SDK reads the empty module as "not
// present" and uses the DOM's fetch types.
export {};
