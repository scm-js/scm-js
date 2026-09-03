/**
 * Where the app's version comes from: `package.json`, injected by `vite.config.ts` as
 * `__APP_VERSION__`. The release workflow rewrites that field before building, so a
 * rolling `latest` build carries its own string (`0.1.0-latest.20260902.abc1234`);
 * `APP_VERSION_SHORT` is that trimmed back to the release it was cut from.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const APP_VERSION_SHORT: string = APP_VERSION.split("-")[0];
