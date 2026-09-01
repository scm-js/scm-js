/** Trigger editor reference lists. */

export const CONDITIONS = [
  "Accumulate", "Always", "Bring", "Command", "Command the Least", "Command the Least At", "Command the Most",
  "Command the Most At", "Countdown Timer", "Deaths", "Elapsed Time", "Highest Score", "Kill", "Least Kills",
  "Least Resources", "Lowest Score", "Most Kills", "Most Resources", "Never", "Opponents", "Score", "Switch",
];

export const ACTIONS = [
  "Center View", "Comment", "Create Unit", "Create Unit with Properties", "Defeat", "Display Text Message", "Draw",
  "Give Units to Player", "Kill Unit", "Kill Unit At Location", "Leaderboard (Control)", "Leaderboard (Control At Location)",
  "Leaderboard (Greed)", "Leaderboard (Kills)", "Leaderboard (Points)", "Leaderboard (Resources)",
  "Leaderboard Goal (Control)", "Leaderboard Goal (Control At Location)", "Leaderboard Goal (Kills)",
  "Leaderboard Goal (Points)", "Leaderboard Goal (Resources)", "Leaderboard Computer Players", "Minimap Ping",
  "Modify Unit Energy", "Modify Unit Hanger Count", "Modify Unit Hit Points", "Modify Unit Resource Amount",
  "Modify Unit Shield Points", "Move Location", "Move Unit", "Mute Unit Speech", "Order", "Pause Game", "Pause Timer",
  "Play WAV", "Preserve Trigger", "Remove Unit", "Remove Unit At Location", "Run AI Script", "Run AI Script At Location",
  "Set Alliance Status", "Set Countdown Timer", "Set Deaths", "Set Doodad State", "Set Invincibility",
  "Set Mission Objectives", "Set Next Scenario", "Set Resources", "Set Score", "Set Switch", "Talking Portrait",
  "Transmission", "Unmute Unit Speech", "Unpause Game", "Unpause Timer", "Victory", "Wait",
];

export const BRIEFING_ACTIONS = [
  "Wait", "Play WAV", "Text Message", "Mission Objectives", "Show Portrait", "Hide Portrait",
  "Display Speaking Portrait", "Transmission", "Skip Tutorial Enabled",
];

export const AI_SCRIPTS = [
  "Terran Custom Level", "Zerg Custom Level", "Protoss Custom Level", "Terran Expansion Custom Level",
  "Zerg Expansion Custom Level", "Protoss Expansion Custom Level", "Terran Campaign Easy", "Terran Campaign Medium",
  "Terran Campaign Difficult", "Terran Campaign Insane", "Zerg Campaign Easy", "Zerg Campaign Medium",
  "Zerg Campaign Difficult", "Zerg Campaign Insane", "Protoss Campaign Easy", "Protoss Campaign Medium",
  "Protoss Campaign Difficult", "Protoss Campaign Insane", "Send All Units on Strategic Suicide Missions",
  "Send All Units on Random Suicide Missions", "Switch Computer Player to Rescue Passive", "Turn ON Shared Vision for Player 1",
  "Turn OFF Shared Vision for Player 1", "Move Dark Templars to Region", "Clear Previous Combat Data", "Set Player to Enemy",
  "Set Player to Ally", "Value This Area Higher", "Enter Closest Bunker", "Set Generic Command Target", "Make These Units Patrol",
  "Enter Transport", "Exit Transport", "AI Nuke Here", "AI Harass Here", "Set Unit Order To: Junk Yard Dog", "Disruption Web Here",
  "Recall Here",
];

export interface SampleTrigger {
  id: number;
  players: string[];
  conditions: string[];
  actions: string[];
  preserve: boolean;
  comment?: string;
}

export const SAMPLE_TRIGGERS: SampleTrigger[] = [
  {
    id: 1,
    players: ["All Players"],
    conditions: ["Always"],
    actions: ["Set Resources(Current Player, Set To, 50, Ore)", "Set Resources(Current Player, Set To, 0, Gas)", "Preserve Trigger()"],
    preserve: true,
    comment: "Starting resources",
  },
  {
    id: 2,
    players: ["Player 1", "Player 2"],
    conditions: ["Bring(Current Player, At Least, 1, Any Unit, Beacon Alpha)"],
    actions: ["Display Text Message(Always Display, \"You found the beacon!\")", "Minimap Ping(Beacon Alpha)"],
    preserve: false,
    comment: "Beacon discovery",
  },
  {
    id: 3,
    players: ["Force 1"],
    conditions: ["Command(Current Player, At Most, 0, Buildings)"],
    actions: ["Defeat()"],
    preserve: false,
    comment: "Defeat condition",
  },
  {
    id: 4,
    players: ["Force 2"],
    conditions: ["Command(Foes, At Most, 0, Buildings)", "Elapsed Time(At Least, 30)"],
    actions: ["Victory()"],
    preserve: false,
    comment: "Victory condition",
  },
  {
    id: 5,
    players: ["Player 8"],
    conditions: ["Countdown Timer(Exactly, 0)"],
    actions: ["Run AI Script(Terran Custom Level)", "Set Countdown Timer(Set To, 300)"],
    preserve: true,
  },
];

export const SAMPLE_TRIGGER_TEXT = `// SCM JS — Text Triggers (TrigEdit syntax)
// Nothing here is compiled yet; this is a UI skeleton.

Trigger("All players"){
Conditions:
	Always();

Actions:
	Set Resources("Current Player", Set To, 50, ore);
	Set Resources("Current Player", Set To, 0, gas);
	Preserve Trigger();
}

//-----------------------------------------------------------------//

Trigger("Player 1", "Player 2"){
Conditions:
	Bring("Current Player", At least, 1, "Any unit", "Beacon Alpha");

Actions:
	Display Text Message(Always Display, "You found the beacon!");
	Minimap Ping("Beacon Alpha");
}

//-----------------------------------------------------------------//

Trigger("Force 1"){
Conditions:
	Command("Current Player", At most, 0, "Buildings");

Actions:
	Defeat();
}
`;
