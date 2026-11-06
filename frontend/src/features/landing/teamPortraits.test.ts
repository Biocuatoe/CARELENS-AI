import { describe, expect, it } from "vitest";
import { missingPortraits, teamPortraitFiles } from "../../../scripts/team-portraits";
import contentSource from "./content.ts?raw";
import { TEAM } from "./content";

/** The same files TeamSection loads (members/ at the project root). */
const membersFiles = Object.keys(import.meta.glob("../../../../members/*.{jpg,JPG,jpeg,JPEG}", { query: "?url", import: "default" }));

describe("team portrait build guard", () => {
  it("reads every core member and expert portrait from TEAM, in order", () => {
    expect(teamPortraitFiles(contentSource)).toEqual([...TEAM.core.map((m) => m.file), ...TEAM.experts.map((e) => e.file)].map((f) => f.normalize("NFC")));
    expect(teamPortraitFiles(contentSource)).toHaveLength(7);
  });

  it("reports each missing file by name, matching like portraitFor (NFC, case-insensitive, base name)", () => {
    const required = ["Lê Đức Hùng - CEO.jpg", "Nguyễn Hải Yến - CMO.JPG", "ThS Chu Huy Anh - Chuyên gia.jpg"];
    expect(missingPortraits(required, [])).toEqual(required);
    expect(missingPortraits(required, ["../members/lê đức hùng - ceo.JPG".normalize("NFD"), "x/Nguyễn Hải Yến - CMO.jpg"])).toEqual(["ThS Chu Huy Anh - Chuyên gia.jpg"]);
    expect(missingPortraits(required, required)).toEqual([]);
  });

  it("every portrait named in TEAM exists in members/ (a checkout without the photos fails here and in vite build)", () => {
    expect(missingPortraits(teamPortraitFiles(contentSource), membersFiles)).toEqual([]);
  });
});
