export interface ClaudeToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tools that mutate stored data in ways the operator can't trivially undo.
// The background dispatcher routes each of these through a UI confirm modal
// before executing, so a prompt-injection attempt that came in via
// adversarial Reddit content surfaced in the snapshot can't silently nuke
// the operator's dossiers. Non-destructive tools (filter, navigate, read,
// investigate, link_ring) skip the gate.
export const BON_AI_COMMAND_DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "delete_report",
  "unlink_ring",
  "set_user_status",
]);

export const BON_AI_COMMAND_TOOLS: ClaudeToolSpec[] = [
  {
    name: "list_users",
    description:
      "Return the reports snapshot — every reported user with identifier columns (username, ringId, reportCount, userStatus), investigation lifecycle, verdict, persona, archetype scores, factor scores, region, ratings, totalKarma, accountAgeDays, botBouncerStatus, and profileHidden. **Call this whenever you need to know what users exist, resolve a username, count users, or filter by any column.** Skip the call for off-topic or social input where the snapshot isn't needed (greetings, thanks, questions clearly outside the reports store). Re-call within a conversation if you've mutated data and need a fresh read.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "link_ring",
    description:
      "Link 2+ reported users into a shared bot ring. If some users are already in a ring, the others join that ring. Errors if the selection spans multiple existing rings.",
    input_schema: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          description: "Reddit usernames, without u/ prefix.",
        },
      },
      required: ["usernames"],
    },
  },
  {
    name: "unlink_ring",
    description: "Clear the ringId on one or more reported users.",
    input_schema: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["usernames"],
    },
  },
  {
    name: "delete_report",
    description: "Delete a reported user from the local store entirely.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
      },
      required: ["username"],
    },
  },
  {
    name: "investigate_user",
    description:
      "Kick off an AI bot/human investigation for a user. Runs in the background (~60s). Creates the record if the user isn't reported yet.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
      },
      required: ["username"],
    },
  },
  {
    name: "filter_users",
    description:
      "Restrict the reports table to a specific set of usernames. Use when the operator asks to 'show only…', 'display everyone whose…', 'filter to…', etc. Pass `usernames: []` to clear any active filter and show everyone. Resolve the operator's criteria against the snapshot yourself — name patterns, ring membership, region, verdict, persona, archetype scores, per-factor scores, bot probability, confidence, status (suspended/active), Bot Bouncer status, profile-hidden flag, account age, total karma, and the operator's own ratings are all visible there.",
    input_schema: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          items: { type: "string" },
          description:
            "Canonical usernames from the snapshot. Empty array clears the filter.",
        },
        label: {
          type: "string",
          description:
            "Short phrase (≤ 8 words) describing the filter criteria — e.g. 'Doomer persona', 'not Stan', 'high LLM content style', 'Bot Bouncer banned'. Shown in the persistent filter badge under the tabs so the operator can see at a glance what they're looking at. Omit when clearing.",
        },
      },
      required: ["usernames"],
    },
  },
  {
    name: "navigate_to_user",
    description:
      "Select a reported user in the reports list — opens their dossier in the detail pane and scrolls the row into view. Use when the operator says 'show me', 'pull up', 'open', 'jump to', or similar.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
      },
      required: ["username"],
    },
  },
  {
    name: "set_user_status",
    description:
      "Record whether the Reddit account is currently suspended or active.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
        status: { type: "string", enum: ["active", "suspended"] },
      },
      required: ["username", "status"],
    },
  },
  {
    name: "read_user_details",
    description:
      "Read the full stored dossier for one or more reported users — investigation summary, persona reasoning, per-factor reasoning and evidence, region call, operator's notes, and recent report history. Use this whenever the operator asks a question whose answer lives inside the stored prose (explaining a term used in a summary, comparing two users, recapping why a verdict landed where it did, recalling the operator's own notes, etc.). Resolve usernames against the snapshot before passing them.",
    input_schema: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Canonical usernames from the snapshot.",
        },
      },
      required: ["usernames"],
    },
  },
];
