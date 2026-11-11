/** Puts the React panel into the element the plugin host gives the docked panel. */
import { createRoot } from "react-dom/client";
import type { AgentController } from "../controller";
import { AgentPanel } from "./AgentPanel";
import "./agent.css";

export function mountAgent(body: HTMLElement, controller: AgentController): () => void {
  const root = createRoot(body);
  root.render(<AgentPanel controller={controller} />);
  return () => root.unmount();
}
