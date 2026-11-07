/**
 * `--qr` (cli/src/qr.ts): the command's own QR encoder and how it draws in a terminal. The pinned matrix was checked
 * module for module against the `qrcode` package (1.5.4) with the same mask, for every mask, both levels and versions
 * 1 to 40, and read back by jsQR (1.4.0) — neither is a dependency here; the check was run once by hand (the internals
 * note says how). What stays in the test: that matrix, the standard's own numbers (capacities, format bits, the
 * Reed–Solomon codewords of the worked "HELLO WORLD"), and that the drawing reads back to the modules.
 */
import { describe, expect, it } from "vitest";
import { byteCapacity, encodeQr, formatBits, QUIET, qrFor, qrLines, rsRemainder, versionBits, type QrCode } from "../cli/src/qr";
import { visible } from "../cli/src/ui";

/** https://scmjs.dev at level M: version 2, mask 0, as the qrcode package draws it. */
const SCMJS_DEV = [
  "#######..#...##.#.#######",
  "#.....#.#..#..##..#.....#",
  "#.###.#..#.#.###..#.###.#",
  "#.###.#..###.####.#.###.#",
  "#.###.#.#.....##..#.###.#",
  "#.....#..###.#.##.#.....#",
  "#######.#.#.#.#.#.#######",
  ".........#..#####........",
  "#.#.#.#...###.#.#...#..#.",
  "#.#.#..###.##.#.###.....#",
  ".##.###....#.#..#.##..###",
  "##.##...#.##...##.##...#.",
  "#....###.##.#...####.#.##",
  ".#..#..#..####..###..#..#",
  "#.##..#.##.##.#.##.#..###",
  ".###.#.####.###.#...#..#.",
  "#.###.#..###..########...",
  "........#..#..###...##.##",
  "#######...#..#.##.#.##.##",
  "#.....#..#.#...##...##...",
  "#.###.#.#...#...######..#",
  "#.###.#....###..#..####..",
  "#.###.#.#####.#.#...#...#",
  "#.....#..#..###.###.##.#.",
  "#######.##.#..###..#...##",
];
const rowsOf = (c: QrCode) => c.modules.map((r) => r.map((v) => (v ? "#" : ".")).join(""));

describe("scmjs --qr: the encoder", () => {
  it("encodes a link as the qrcode package does", () => {
    const c = encodeQr("https://scmjs.dev");
    expect([c.version, c.level, c.mask, c.size]).toEqual([2, "M", 0, 25]);
    expect(rowsOf(c)).toEqual(SCMJS_DEV);
  });

  it("holds what the standard says each version holds in byte mode", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map((v) => byteCapacity(v, "M"))).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 2331]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map((v) => byteCapacity(v, "L"))).toEqual([17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 2953]);
  });

  it("works the standard's numbers out: Reed–Solomon, format and version bits", () => {
    // "HELLO WORLD" at 1-M, the worked example: its 16 data codewords give these 10.
    const data = [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, 10)).toEqual([0xc4, 0x23, 0x27, 0x77, 0xeb, 0xd7, 0xe7, 0xe2, 0x5d, 0x17]);
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("L", 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
  });

  it("grows the version with the link and refuses what no code holds", () => {
    const link = "https://scmjs.dev/editor/share/abcdefghijklmnop?scmjs-server=http%3A%2F%2F127.0.0.1%3A18787";
    const c = encodeQr(link);
    // 91 bytes: past version 5's 84 at M.
    expect([link.length, c.version, c.size]).toEqual([91, 6, 41]);
    expect(() => encodeQr("x".repeat(3000))).toThrow(/more than a QR code holds/);
  });
});

/** The modules back out of half-block lines: in colour the marks are dark. */
function readBack(lines: string[], color: boolean): boolean[][] {
  const grid: boolean[][] = [];
  for (const line of lines.map(visible)) {
    const top: boolean[] = [], bottom: boolean[] = [];
    for (const ch of line) {
      top.push(ch === "█" || ch === "▀");
      bottom.push(ch === "█" || ch === "▄");
    }
    grid.push(top, bottom);
  }
  return grid.map((r) => r.map((m) => (color ? m : !m)));
}

describe("scmjs --qr: in the terminal", () => {
  const code = encodeQr("https://scmjs.dev");
  const width = code.size + QUIET * 2;

  it("draws two rows a line, as wide as the code and its quiet zone", () => {
    for (const color of [true, false]) {
      const lines = qrLines(code, { ascii: false, color });
      expect(lines).toHaveLength(Math.ceil(width / 2));
      for (const l of lines) expect([...visible(l)]).toHaveLength(width);
      const grid = readBack(lines, color);
      for (let y = 0; y < code.size; y++) expect(grid[y + QUIET].slice(QUIET, QUIET + code.size)).toEqual(code.modules[y]);
      // The quiet zone is light all round.
      expect(grid[0].every((dark) => !dark)).toBe(true);
      expect(grid.slice(0, width).every((r) => !r[0] && !r[width - 1])).toBe(true);
    }
  });

  it("paints black on white with colour, whatever the terminal's own colours", () => {
    const lines = qrLines(code, { ascii: false, color: true });
    for (const l of lines) expect([l.startsWith("\x1b[30;107m"), l.endsWith("\x1b[0m")]).toEqual([true, true]);
    expect(qrLines(code, { ascii: false, color: false }).join("")).not.toContain("\x1b");
  });

  it("falls back to ASCII where the marks do: a module two characters wide and a line high", () => {
    const lines = qrLines(code, { ascii: true, color: false });
    expect(lines).toHaveLength(width);
    for (const l of lines) expect(l).toMatch(/^(##| {2}){29}$/);
    // Without colour the marks are the light modules: a dark finder's corner is blank.
    expect(lines[QUIET].slice(QUIET * 2, QUIET * 2 + 2)).toBe("  ");
  });

  it("a share link fits an 80-column terminal", () => {
    const lines = qrFor("https://scmjs.dev/editor/map/0123456789abcdefghij0123456789", { ascii: false, color: false });
    expect(Math.max(...lines.map((l) => [...l].length))).toBeLessThanOrEqual(40);
  });
});
