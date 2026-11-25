import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { EfficiencyScatter } from "../src/components/charts";

// Your real figures, including the brand-search campaign at 256x.
const data = [
  { label: "Last Chance TFS", x: 22400, y: 2.89, size: 22400, status: "warning" as const },
  { label: "SSS Purchase - Copy", x: 4491, y: 0, size: 4491, status: "critical" as const },
  { label: "Toowoomba Hype", x: 4487, y: 0, size: 4487, status: "critical" as const },
  { label: "3pc SSS - Copy", x: 4486, y: 0, size: 4486, status: "critical" as const },
  { label: "TFS Shopping Summer", x: 1226, y: 9.5, size: 1226, status: "good" as const },
  { label: "Valley BF Hype", x: 1225, y: 0, size: 1225, status: "critical" as const },
  { label: "Pmax #RR", x: 1082, y: 6.96, size: 1082, status: "good" as const },
  { label: "Pmax Outdoor Dining", x: 1063, y: 1.72, size: 1063, status: "warning" as const },
  { label: "Sales-Performance Max-4", x: 1051, y: 2.27, size: 1051, status: "warning" as const },
  { label: "Pmax #Lounge", x: 459, y: 0.49, size: 459, status: "critical" as const },
  { label: "New Shopping", x: 434, y: 5.4, size: 434, status: "good" as const },
  { label: "New branding search", x: 292, y: 256.07, size: 292, status: "good" as const },
];

const html = renderToStaticMarkup(
  React.createElement(EfficiencyScatter, { data, breakEven: 2.0, target: 3.0, currency: "AUD" }),
);

const capMatch = html.match(/>([\d.]+)x<\/text>/g) ?? [];
console.log("y-axis ticks rendered:", capMatch.slice(0, 6).join(" "));
console.log();
console.log("pinned chevron drawn:", /M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L/.test(html) ? "yes" : "NO");
console.log("256x labelled on the dot:", html.includes(">256x<") ? "yes" : "NO");
console.log();
const caption = html.match(/The scale stops at[^<]*/)?.[0];
console.log("caption:", caption ?? "(no outlier note — FAIL)");
console.log();
console.log("break-even label anchor:", html.match(/text-anchor="(end|start)"[^>]*fill="var\(--status-critical\)"/)?.[1] ?? "?");
console.log("target label anchor:    ", html.match(/text-anchor="(end|start)"[^>]*fill="var\(--status-good\)"/)?.[1] ?? "?");

// The collision case: break-even and target close enough that two right-anchored
// labels would print over each other, which is how "break-targeti3.0x" happened.
const tight = renderToStaticMarkup(
  React.createElement(EfficiencyScatter, {
    data: data.slice(0, 5),
    breakEven: 2.9,
    target: 3.0,
    currency: "AUD",
  }),
);
const tightBreak = tight.match(/text-anchor="(end|start)"[^>]*fill="var\(--status-critical\)"/)?.[1];
const tightTarget = tight.match(/text-anchor="(end|start)"[^>]*fill="var\(--status-good\)"/)?.[1];
console.log();
console.log("--- lines 0.1x apart ---");
console.log("break-even anchor:", tightBreak, " target anchor:", tightTarget);
console.log(
  "labels separated:",
  tightBreak !== tightTarget ? "yes — target moved to the opposite end" : "NO — they would overlap",
);
