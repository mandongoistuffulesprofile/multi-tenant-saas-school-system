import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  formatMoney,
  isPositiveMoney,
  parseMoney,
  subtractMoney,
  sumMoney,
} from "./money";

describe("money", () => {
  it("parses decimal strings exactly", () => {
    expect(parseMoney("123456789.12")).toEqual({ digits: "12345678912", scale: 2 });
    expect(parseMoney("-0.05")).toEqual({ digits: "-5", scale: 2 });
    expect(parseMoney("")).toEqual({ digits: "0", scale: 0 });
    expect(parseMoney(null)).toEqual({ digits: "0", scale: 0 });
    expect(parseMoney("not a number")).toEqual({ digits: "0", scale: 0 });
  });

  it("adds values a double would drift on", () => {
    // 0.1 + 0.2 !== 0.3 in floating point.
    expect(formatMoney(addMoney("0.1", "0.2"))).toBe("0.30");
    // Large amounts lose precision as doubles long before this.
    expect(formatMoney(addMoney("123456789.11", "0.01"))).toBe("123,456,789.12");
    expect(formatMoney(sumMoney(["0.01", "0.02", "123456789.11"]))).toBe("123,456,789.14");
  });

  it("subtracts and compares", () => {
    expect(formatMoney(subtractMoney("15000", "4999.99"))).toBe("10,000.01");
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("10.00", "10")).toBe(0);
    expect(compareMoney("9.99", "10.00")).toBe(-1);
    expect(isPositiveMoney("0.01")).toBe(true);
    expect(isPositiveMoney("0.00")).toBe(false);
    expect(isPositiveMoney(null)).toBe(false);
  });

  it("formats without rounding the exact value", () => {
    expect(formatMoney("123456789.12")).toBe("123,456,789.12");
    expect(formatMoney("1250")).toBe("1,250.00");
    expect(formatMoney("33333.335")).toBe("33,333.335");
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney("-42.5")).toBe("-42.50");
  });
});
