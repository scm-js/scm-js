import { useState } from "react";
import { Blocks } from "lucide-react";
import type { PluginIcon } from "../../plugins/api";

// Its own module (rather than a PluginDialogs export) so the menu bar and the panels, which
// draw plugin icons, do not pull the whole Manage Plugins dialog into the main chunk.
/**
 * The face a plugin declared in its manifest (`icon`): an image, or a glyph, or —
 * when it declared none, or the image will not load — the editor's own plugin mark.
 * The loader has already decided which of the two it is (`resolveIcon`); nothing here
 * touches the manifest string, so a `javascript:` "icon" never reaches an attribute.
 */
export function PluginIconView({ icon, size = 30 }: { icon: PluginIcon | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.72) };
  if (icon?.kind === "image" && !broken) {
    return <img className="plugin-icon" style={style} src={icon.url} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="plugin-icon" style={style} aria-hidden>
      {icon?.kind === "text" ? icon.text : <Blocks size={Math.round(size * 0.6)} />}
    </span>
  );
}
