// The site on this machine, for working on the editor and scm-sim together: one origin that
// serves the editor's dev server under /editor/ and scm-sim's dev server at /play/, as scmjs.dev
// does. The scm-sim plugin finds the engine only beside the editor on the same origin, so this
// is what lets Test Map in Browser and the replay analysis reach a local engine.
//
//   SCMJS_BASE=/editor/ npm run dev -- --port 5173   (this repository)
//   npm run dev:web                                   (scm-sim, port 5174)
//   npm run dev:site                                  then open http://localhost:5180/editor/
//
// Ports: DEV_SITE_PORT (5180), DEV_SITE_EDITOR (5173), DEV_SITE_SIM (5174).
// scm-sim's dev server is built for the origin's root, so /play/ is taken off its paths and
// every other path (its scripts, workers and data files) goes to it as asked.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.DEV_SITE_PORT || 5180);
const EDITOR = Number(process.env.DEV_SITE_EDITOR || 5173);
const SIM = Number(process.env.DEV_SITE_SIM || 5174);

function route(url = "/") {
  if (url === "/editor" || url.startsWith("/editor/")) return { port: EDITOR, path: url };
  if (url === "/play" || url.startsWith("/play/")) return { port: SIM, path: url.slice("/play".length) || "/" };
  return { port: SIM, path: url };
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "") { res.writeHead(302, { location: "/editor/" }); res.end(); return; }
  const to = route(req.url);
  const out = http.request({ host: "127.0.0.1", port: to.port, path: to.path, method: req.method, headers: req.headers }, (back) => {
    res.writeHead(back.statusCode ?? 502, back.headers);
    back.pipe(res);
  });
  out.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Nothing answers on port ${to.port} (${e.code}). Is the ${to.port === EDITOR ? "editor" : "scm-sim"} dev server running?`);
  });
  req.pipe(out);
});

// The two dev servers' reload sockets: the editor's lives under /editor/, scm-sim's at the root.
server.on("upgrade", (req, socket, head) => {
  const to = route(req.url);
  const back = net.connect(to.port, "127.0.0.1", () => {
    const lines = [`${req.method} ${to.path} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    back.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) back.write(head);
    back.pipe(socket);
    socket.pipe(back);
  });
  back.on("error", () => socket.destroy());
  socket.on("error", () => back.destroy());
});

server.listen(PORT, () => {
  console.log(`Site on http://localhost:${PORT}/editor/  (editor :${EDITOR} under /editor/, scm-sim :${SIM} at /play/)`);
});
