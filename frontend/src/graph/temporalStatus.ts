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

// Ansible palette, validated for dark surfaces (#0D0D14) with the dataviz six-checks:
// lightness band, chroma floor, CVD ΔE 8.3+, normal-vision ΔE 17.5+, contrast ≥3:1.
export const NODE_TYPE_COLORS: Record<string, string> = {
  registrant: "#4997D0", // Celestial Blue
  client: "#FF4F00",     // Signal Orange
  lobbyist: "#54A272",   // Oxidized Copper (chroma-corrected for dark marks)
  gov_entity: "#C97B2F", // Vacuum Tube Amber
};

export const STATUS_STYLE = {
  new: { opacity: 1.0, halo: true },
  persisting: { opacity: 0.95, halo: false },
  dropped: { opacity: 0.18, halo: false },
  hidden: { opacity: 0, halo: false },
} as const;
