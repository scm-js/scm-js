/**
 * A command in miniature for `tests/cli-lifecycle.test.ts`, bundled and run as a process of its own: it starts a
 * process that starts one more (as the match runner starts its seats), makes a temporary folder, writes what it made to
 * the file its second argument names, then ends as its first argument says — waits to be signalled (`wait`), exits at
 * once (`exit`, as a closed pipe ends a command), throws (`throw`), or listens for SIGINT itself (`own-sigint`, as the
 * text editor does while it runs).
 */
import { writeFileSync } from "node:fs";
import { spawnOwned, tempFolder } from "../../cli/src/lifecycle";

const [mode, report] = process.argv.slice(2);
const grandchild = `setInterval(() => {}, 1000)`;
const child = `
const { spawn } = require("node:child_process");
const g = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
process.stdout.write(JSON.stringify({ child: process.pid, grandchild: g.pid }) + "\\n");
setInterval(() => {}, 1000);
`;
const folder = tempFolder("scmjs-lifecycle-");
const kept = tempFolder("scmjs-lifecycle-kept-", { untilStopped: true });
const started = spawnOwned(process.execPath, ["-e", child], { stdio: ["ignore", "pipe", "inherit"] });
started.stdout!.once("data", (d: Buffer) => {
  writeFileSync(report, JSON.stringify({ ...JSON.parse(d.toString()), folder, kept }));
  if (mode === "exit") process.exit(0);
  if (mode === "throw") throw new Error("thrown");
  if (mode === "own-sigint") process.on("SIGINT", () => { writeFileSync(`${report}.sigint`, "1"); });
});
