/* A "Copy" button on the guides' commands: every ```sh block, and every plain block that
   shows a terminal session (`$ scmjs …` followed by what it printed).

   What goes on the clipboard is what a terminal should run, not what the page shows:
   a session block gives only its `$` lines, without the `$`, and a shell block loses its
   `# comments`. The comments matter on a Mac — zsh, its default shell, does not treat
   `#` as a comment when you type or paste a command, so `brew install … # macOS` would
   hand Homebrew three more package names. */
(() => {
  /* A line without its `# comment`: a `#` that starts a word, outside quotes. */
  function withoutComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === "\\" && quote === '"') i++;
        else if (c === quote) quote = null;
      } else if (c === "\\") i++;
      else if (c === '"' || c === "'") quote = c;
      else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }

  const shell = (text) =>
    text.split("\n").map((l) => withoutComment(l.replace(/^\$ /, "")).trimEnd()).filter(Boolean).join("\n");

  const session = (text) =>
    text.split("\n").filter((l) => l.startsWith("$ ")).map((l) => l.slice(2).trimEnd()).join("\n");

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* No clipboard API (a page opened from disk, an older browser): the old way. */
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* nothing more to try */ }
      area.remove();
      return ok;
    }
  }

  for (const code of document.querySelectorAll("main pre > code")) {
    const pre = code.parentElement;
    const isShell = /\blanguage-(sh|bash|shell|zsh)\b/.test(code.className);
    const isSession = !code.className && /^\$ /m.test(code.textContent);
    if (!isShell && !isSession) continue;
    const text = (isShell ? shell : session)(code.textContent);
    if (!text) continue;

    const wrap = document.createElement("div");
    wrap.className = "code-copy";
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.title = isSession ? "Copy the commands (the lines that start with $)" : "Copy to the clipboard";
    button.setAttribute("aria-live", "polite");
    let reset = 0;
    button.addEventListener("click", async () => {
      const ok = await copy(text);
      button.textContent = ok ? "Copied" : "Copy failed";
      button.classList.toggle("done", ok);
      clearTimeout(reset);
      reset = setTimeout(() => { button.textContent = "Copy"; button.classList.remove("done"); }, 1600);
    });
    wrap.appendChild(button);
  }
})();
