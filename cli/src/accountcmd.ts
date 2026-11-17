/** The scmjs.dev account: `scmjs account`, `login`, `logout` and the `library` commands. */
import { Command, Option } from "commander";
import { accountReport, login, loginByCodeHere, logout, noLocalBrowser, PROVIDERS, printAccount, serverLabel } from "./account";
import { addLibraryCommands } from "./librarycmd";
import { t } from "./i18n";
import { mark, pc, print } from "./ui";
import { jsonOption } from "./options";


export function addAccountCommands(program: Command): void {
  const json = jsonOption();
  // A scmjs.dev account. Hidden from the overview, which is held to 23 lines: `map share` (under `map …`) and the
  // doctor's scmjs.dev row say `scmjs login`, and `scmjs help account` lists it all.
  const signIn = async (o: { provider?: string; device?: boolean; qr?: boolean }) => {
    // By code where the browser cannot reach this computer: asked for, or an SSH session or container with no display.
    const why = o.device === undefined ? noLocalBrowser() : null;
    const r = o.device || why ? await loginByCodeHere({ qr: o.qr, why }) : await login({ provider: o.provider, say: (page, provider) => print(`${mark.info} ${t("Signing in with {provider} in your browser", { provider })}`, pc.dim(`  ${t("If nothing opens, go to {page}", { page })}`)) });
    print(`${mark.ok} ${t("Signed in to {server} as {name}", { server: serverLabel(r.server), name: pc.bold(r.account.name ?? t("(no name)")) })}`, pc.dim(`  ${t("The session is kept in {file}; scmjs logout ends it.", { file: r.file })}`));
  };
  const signOut = async () => {
    const r = await logout();
    if (!r.was) { print(`${mark.info} ${t("Not signed in")}`); return; }
    print(`${mark.ok} ${r.was.name ? t("Signed out of {server} ({name})", { server: serverLabel(r.was.server), name: r.was.name }) : t("Signed out of {server}", { server: serverLabel(r.was.server) })}`, r.told ? null : pc.dim(`  ${t("The server could not be reached to end the session there; {file} is deleted.", { file: r.file })}`));
  };
  const providerOption = () => new Option("--provider <name>", t("the sign-in to use")).choices(PROVIDERS).default("discord");
  const byCode = (c: Command) => c.addOption(providerOption())
    .option("--device", t("sign in by code from any device, for a terminal without a browser (SSH, a container)"))
    .option("--no-device", t("sign in through a browser on this computer, even over SSH"))
    .option("--qr", t("with --device, the page's address as a QR code too, for a phone"));
  const account = program.command("account").description(t("sign in to scmjs.dev, see your account, sign out")).helpGroup(t("This tool:"))
    .addHelpText("after", "\n" + t(`The sign-in opens Discord in your browser, as the editor's does (--provider google or battlenet for the others). The
session is kept in your configuration folder (~/.config/scmjs/session.json; SCMJS_SESSION names another file), and
scmjs logout ends it. scmjs login and scmjs logout are the same as account login and account logout.`))
    .addHelpText("after", "\n" + t(`Over SSH or in a container, where no browser can reach this computer, the sign-in is by code: the command prints an
address and a code, and you open the address on any device, sign in there and allow the code. --device asks for it
anywhere, --no-device keeps the browser.`));
  account.command("show", { isDefault: true }).description(t("who you are, the storage you use and the maps you are sharing")).addOption(json)
    .addOption(new Option("--qr", t("each shared map's link as a QR code too, for a phone")))
    .action(async (o: { json?: boolean; qr?: boolean }) => {
      const r = await accountReport();
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printAccount(r, undefined, { qr: o.qr })));
    });
  byCode(account.command("login").description(t("sign in to scmjs.dev in your browser, or by code"))).action(signIn);
  account.command("logout").description(t("end the session and delete its file")).action(signOut);
  addLibraryCommands(program, t("Maps and replays:"));
  byCode(program.command("login", { hidden: true }).description(t("sign in to scmjs.dev in your browser, or by code (scmjs account login)"))).action(signIn);
  program.command("logout", { hidden: true }).description(t("sign out of scmjs.dev (scmjs account logout)")).action(signOut);
}
