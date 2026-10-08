import { describe, expect, it } from "vitest";
import {
  CSV_RECORD_SEPARATOR,
  CSV_UTF8_BOM,
  escapeCsvCell,
  neutralizeFormula,
  toCsv,
  toCsvRecord,
} from "@/lib/domain/csv";

describe("escapeCsvCell — quoting (RFC 4180)", () => {
  it("leaves a plain value unquoted", () => {
    expect(escapeCsvCell("ROI-STU-0001")).toBe("ROI-STU-0001");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvCell("Sharma, Asha")).toBe('"Sharma, Asha"');
  });

  it("doubles embedded quotes and quotes the field", () => {
    expect(escapeCsvCell('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("quotes values containing LF, CR or CRLF and keeps the line breaks", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(escapeCsvCell("a\rb")).toBe('"a\rb"');
  });

  it("quotes values with leading or trailing whitespace so readers do not trim them", () => {
    expect(escapeCsvCell(" padded")).toBe('" padded"');
    expect(escapeCsvCell("padded ")).toBe('"padded "');
  });

  it("renders null and undefined as an empty field", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
});

describe("escapeCsvCell — Unicode", () => {
  it("passes Devanagari, accented and emoji text through unchanged", () => {
    expect(escapeCsvCell("आशा शर्मा")).toBe("आशा शर्मा");
    expect(escapeCsvCell("Zoë Ångström")).toBe("Zoë Ångström");
    expect(escapeCsvCell("🎓 Graduate")).toBe("🎓 Graduate");
  });

  it("still quotes a Unicode value that needs quoting", () => {
    expect(escapeCsvCell("शर्मा, आशा")).toBe('"शर्मा, आशा"');
  });

  it("exposes a UTF-8 BOM constant for the start of an export", () => {
    expect(CSV_UTF8_BOM).toBe("﻿");
    expect(CSV_UTF8_BOM.length).toBe(1);
  });
});

describe("escapeCsvCell — decimals and numbers", () => {
  it("keeps decimal money strings exactly, including trailing zeros", () => {
    expect(escapeCsvCell("1234.50")).toBe("1234.50");
    expect(escapeCsvCell("0.10")).toBe("0.10");
    expect(escapeCsvCell("100000.00")).toBe("100000.00");
  });

  it("writes integers as plain digits", () => {
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell(42)).toBe("42");
  });

  it("never writes NaN or Infinity", () => {
    expect(escapeCsvCell(Number.NaN)).toBe("");
    expect(escapeCsvCell(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("does not treat a number cell as a formula", () => {
    expect(escapeCsvCell(-5)).toBe("-5");
  });
});

describe("formula-injection protection", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+91 98765 43210", "'+91 98765 43210"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tTabbed", "'\tTabbed"],
  ])("neutralizes %j", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it("neutralizes then quotes a formula that also needs quoting", () => {
    expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe(
      '"\'=HYPERLINK(""http://x"",""y"")"',
    );
  });

  it("quotes a leading carriage return after neutralizing it", () => {
    expect(escapeCsvCell("\r=1")).toBe('"\'\r=1"');
  });

  it("does not alter values whose formula character is not leading", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
    expect(escapeCsvCell("user@example.com")).toBe("user@example.com");
    expect(escapeCsvCell("ROI-ENR-0001")).toBe("ROI-ENR-0001");
  });
});

describe("toCsvRecord / toCsv", () => {
  it("joins cells with commas and terminates each record with CRLF", () => {
    expect(CSV_RECORD_SEPARATOR).toBe("\r\n");
    expect(toCsvRecord(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"\r\n');
  });

  it("writes the header row first, then every data row", () => {
    expect(
      toCsv(
        ["Code", "Name", "Amount"],
        [
          ["S1", "Asha", "10.50"],
          ["S2", "=evil", "0.00"],
        ],
      ),
    ).toBe("Code,Name,Amount\r\nS1,Asha,10.50\r\nS2,'=evil,0.00\r\n");
  });

  it("produces only the header for an empty result", () => {
    expect(toCsv(["Code"], [])).toBe("Code\r\n");
  });
});
