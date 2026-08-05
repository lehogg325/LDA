// Temporal status per quarter step: new this quarter, persisting from the previous
// quarter, or dropped since the previous quarter. Pure logic, unit-tested.

export type TemporalStatus = "new" | "persisting" | "dropped" | "hidden";

export function temporalStatus(
  presentNow: boolean,
  presentPrev: boolean,
  hasPrevQuarter: boolean,
): TemporalStatus {
  if (presentNow && !hasPrevQuarter) return "persisting"; // first visible quarter: neutral
  if (presentNow && presentPrev) return "persisting";
  if (presentNow && !presentPrev) return "new";
  if (!presentNow && presentPrev) return "dropped";
  return "hidden";
}

export const NODE_TYPE_COLORS: Record<string, string> = {
  registrant: "#2f6fb7",
  client: "#c96a2b",
  lobbyist: "#5a9e6f",
  gov_entity: "#8a5fa8",
};

export const STATUS_STYLE = {
  new: { opacity: 1.0, halo: true },
  persisting: { opacity: 0.95, halo: false },
  dropped: { opacity: 0.18, halo: false },
  hidden: { opacity: 0, halo: false },
} as const;
