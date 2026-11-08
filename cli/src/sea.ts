/**
 * The single executable's entry (scripts/build-cli-binary.mjs): the command line, or, when a command started this
 * same executable to run one of the game engine's runners (`SCMJS_RUN_AS_NODE`, runtime.ts), that script as Node
 * would. The command line is imported only in the first case, so a runner's process does not build the commands.
 */
import { runAsNode } from "./runtime";

if (process.env.SCMJS_RUN_AS_NODE === "1") runAsNode();
else void import("./main");
