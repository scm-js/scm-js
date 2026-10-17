import { describe, expect, it } from "vitest";
import {
  decodeText, decodesCleanly, detectTextEncoding, encodeText, TEXT_ENCODINGS, unencodable, type TextEncoding,
} from "../src/formats/text/encoding";
import { decodeStrings, encodeStrings, unencodableStrings } from "../src/formats/chk/sections/strings";
import { decodeTbl } from "../src/formats/dat/tbl";
import { createScenario, requiredSections } from "../src/formats/chk/create";
import { parseScenario, scenarioName, serializeScenario, setExtendedStrings, setMapVersion, setScenarioName, setTextEncoding } from "../src/formats/chk/scenario";
import { validateScenario } from "../src/editor/validate";

const KOREAN = "스타크래프트 브루드 워";
const JAPANESE = "スタークラフト 日本語";
const CHINESE_S = "星际争霸 简体中文";
const CHINESE_T = "星海爭霸 繁體中文";
const RUSSIAN = "Звёздное ремесло";
const WESTERN = "Café résumé naïve — “quoted” €";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("text encoding", () => {
  it.each<[TextEncoding, string]>([
    ["utf-8", KOREAN + JAPANESE + RUSSIAN + WESTERN],
    ["euc-kr", KOREAN],
    ["shift_jis", JAPANESE],
    ["gbk", CHINESE_S],
    ["big5", CHINESE_T],
    ["windows-1251", RUSSIAN],
    ["windows-1252", WESTERN],
  ])("%s encodes and decodes its own script", (encoding, text) => {
    const encoded = encodeText(text, encoding);
    expect(decodeText(encoded, encoding)).toBe(text);
    expect(unencodable(text, encoding)).toEqual([]);
  });

  it("writes Korean the way a Korean StarEdit did (CP949) and reads it back", () => {
    // 가 is B0 A1 in EUC-KR; 똠 is only in the CP949 extension (8C 63).
    expect(Array.from(encodeText("가", "euc-kr"))).toEqual([0xb0, 0xa1]);
    expect(decodeText(bytes(0xb0, 0xa1), "euc-kr")).toBe("가");
  });

  // Browsers' `euc-kr` is Windows-949, the whole of CP949; Node's ICU one is KS X 1001
  // alone and drops the 8822 extension syllables. The editor runs in a browser.
  const cp949 = decodeText(bytes(0x8c, 0x63), "euc-kr") === "똠";
  it.skipIf(!cp949)("holds the CP949 extension syllables where the platform does", () => {
    expect(Array.from(encodeText("똠", "euc-kr"))).toEqual([0x8c, 0x63]);
  });

  it("gives Windows-1252's 0x80–0x9F the browser's meaning whatever the platform decoder says", () => {
    expect(decodeText(bytes(0x80, 0x93, 0x97, 0x94), "windows-1252")).toBe("€“—”");
    expect(Array.from(encodeText("€“—”", "windows-1252"))).toEqual([0x80, 0x93, 0x97, 0x94]);
  });

  it("keeps every windows-1252 byte, including the C1 range StarEdit could produce", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(Array.from(encodeText(decodeText(all, "windows-1252"), "windows-1252"))).toEqual(Array.from(all));
  });

  it("writes what an encoding cannot hold as '?' and names the characters", () => {
    expect(decodeText(encodeText("a한b", "windows-1252"), "windows-1252")).toBe("a?b");
    expect(unencodable("한글 and 漢字 and é", "windows-1252")).toEqual(["한", "글", "漢", "字"]);
    expect(unencodable("한글", "euc-kr")).toEqual([]);
    expect(unencodable("anything at all 한", "utf-8")).toEqual([]);
  });

  it("has an entry for every encoding in the table", () => {
    for (const e of TEXT_ENCODINGS) expect(decodesCleanly(bytes(0x41), e.id)).toBe(true);
  });
});

describe("detecting the encoding", () => {
  it("calls ASCII UTF-8", () => {
    expect(detectTextEncoding(encodeText("Just a map", "utf-8"))).toBe("utf-8");
  });

  it("recognises valid UTF-8 before anything else", () => {
    expect(detectTextEncoding(encodeText(KOREAN, "utf-8"))).toBe("utf-8");
    expect(detectTextEncoding(encodeText(WESTERN, "utf-8"))).toBe("utf-8");
  });

  it.each<[TextEncoding, string]>([
    ["euc-kr", `Map by 홍길동. ${KOREAN}. Player 1 wins.`],
    ["shift_jis", `Map ${JAPANESE} version 2`],
    ["windows-1251", `Карта ${RUSSIAN} для двоих`],
    ["windows-1252", WESTERN],
  ])("tells %s from its bytes", (encoding, text) => {
    expect(detectTextEncoding(encodeText(text, encoding))).toBe(encoding);
  });

  it("guesses Korean before Chinese when both would do, and lets a preference decide", () => {
    // Korean bytes are usually valid GBK too (they decode to ideographs there).
    expect(detectTextEncoding(encodeText(KOREAN, "euc-kr"))).toBe("euc-kr");
    const chinese = encodeText(CHINESE_S, "gbk");
    expect(detectTextEncoding(chinese, ["gbk"])).toBe("gbk");
  });

  it("falls back to Windows-1252 for bytes no script claims", () => {
    expect(detectTextEncoding(bytes(0x41, 0xa4, 0x20, 0x42))).toBe("windows-1252");
  });

  it("tells Cyrillic from Western by where the high bytes sit, whatever the mix of English", () => {
    expect(detectTextEncoding(encodeText(`Force 1 Force 2 Anywhere ${RUSSIAN} Player 1`, "windows-1251"))).toBe("windows-1251");
    expect(detectTextEncoding(encodeText("Force 1 Force 2 Anywhere Café résumé Player 1", "windows-1252"))).toBe("windows-1252");
  });
});

describe("string table encoding", () => {
  it("round-trips Korean in a legacy STR and in STRx", () => {
    for (const extended of [false, true]) {
      const table = { strings: [null, KOREAN, "Force 1", "혼합 mixed"], extended, encoding: "euc-kr" as TextEncoding };
      const encoded = encodeStrings(table);
      const decoded = decodeStrings(encoded, extended);
      expect(decoded.encoding).toBe("euc-kr");
      expect(decoded.strings).toEqual(table.strings);
    }
  });

  it("guesses from the whole table, so one Korean name among ASCII strings is enough", () => {
    const table = { strings: [null, "Map", "Force 1", "Force 2", "Force 3", "Force 4", "Anywhere", "홍길동"], extended: false, encoding: "euc-kr" as TextEncoding };
    const decoded = decodeStrings(encodeStrings(table), false);
    expect(decoded.encoding).toBe("euc-kr");
    expect(decoded.strings[7]).toBe("홍길동");
  });

  it("takes the encoding it is told over the guess", () => {
    const encoded = encodeStrings({ strings: [null, KOREAN], extended: false, encoding: "euc-kr" });
    expect(decodeStrings(encoded, false, "windows-1252").strings[1]).not.toBe(KOREAN);
    expect(decodeStrings(encoded, false, "euc-kr").strings[1]).toBe(KOREAN);
  });

  it("lists the strings the table's encoding would lose", () => {
    const table = { strings: [null, "fine", "한글", "漢字 too"], extended: false, encoding: "windows-1252" as TextEncoding };
    expect(unencodableStrings(table)).toEqual([{ index: 2, chars: ["한", "글"] }, { index: 3, chars: ["漢", "字"] }]);
    expect(unencodableStrings({ ...table, encoding: "utf-8" })).toEqual([]);
  });
});

describe("a scenario's text encoding", () => {
  it("is UTF-8 for a new map and survives a save and reopen with Korean text", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "New" });
    expect(scn.strings.encoding).toBe("utf-8");
    setScenarioName(scn, KOREAN);
    const back = parseScenario(serializeScenario(scn));
    expect(back.strings.encoding).toBe("utf-8");
    expect(scenarioName(back)).toBe(KOREAN);
  });

  it("is changed in place, marks the table dirty, and the file comes back in the new bytes", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: KOREAN });
    scn.dirty.delete("STR ");
    setTextEncoding(scn, "euc-kr");
    expect(scn.dirty.has("STR ")).toBe(true);
    const back = parseScenario(serializeScenario(scn));
    expect(back.strings.encoding).toBe("euc-kr");
    expect(scenarioName(back)).toBe(KOREAN);
  });

  it("moves to UTF-8 with STRx and stays there on the way back", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: KOREAN });
    setTextEncoding(scn, "euc-kr");
    setMapVersion(scn, "remastered", true);
    expect(scn.strings.encoding).toBe("utf-8");
    setExtendedStrings(scn, false);
    expect(scn.strings.encoding).toBe("utf-8");
    expect(requiredSections(scn.fileVersion)).toContain("STR ");
  });

  it("is reported by Check Map when the encoding would lose characters", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: KOREAN });
    setTextEncoding(scn, "windows-1252");
    const issue = validateScenario(scn).find((i) => i.where === "Strings" && i.text.includes("cannot hold"));
    expect(issue?.level).toBe("error");
    expect(issue?.text).toContain("Windows-1252");
    setTextEncoding(scn, "euc-kr");
    expect(validateScenario(scn).some((i) => i.text.includes("cannot hold"))).toBe(false);
  });
});

describe("tbl encoding", () => {
  const tbl = (entries: string[], encoding: TextEncoding) => {
    const blobs = entries.map((e) => encodeText(e + "\0", encoding));
    const header = 2 + entries.length * 2;
    const out = new Uint8Array(header + blobs.reduce((n, b) => n + b.length, 0));
    const view = new DataView(out.buffer);
    view.setUint16(0, entries.length, true);
    let at = header;
    blobs.forEach((b, i) => { view.setUint16(2 + i * 2, at, true); out.set(b, at); at += b.length; });
    return out;
  };

  it("reads a Windows-1252 table, a UTF-8 one and an EUC-KR one", () => {
    expect(decodeTbl(tbl(["Marine", "Zealot", "Café"], "windows-1252"))).toEqual(["Marine", "Zealot", "Café"]);
    expect(decodeTbl(tbl(["해병", "광전사"], "utf-8"))).toEqual(["해병", "광전사"]);
    expect(decodeTbl(tbl(["해병", "광전사"], "euc-kr"))).toEqual(["해병", "광전사"]);
  });
});
