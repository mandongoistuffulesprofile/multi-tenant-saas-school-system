import { describe, expect, it, vi } from "vitest";
import i18n from "./index";

/**
 * A missing key is not an exception: i18next falls back to rendering the key
 * itself, which is how a parent tab ended up labelled "parent.child". These
 * tests pin the development-time report that makes the next one visible.
 */
describe("missing translations", () => {
  it("keeps rendering the key but reports it once in development", async () => {
    await i18n.changeLanguage("en");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(i18n.t("this.key.does.not.exist", { lng: "en" })).toBe("this.key.does.not.exist");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('"this.key.does.not.exist"');
    expect(error.mock.calls[0][0]).toContain("translations.ts");

    // the same key twice must not spam the console
    i18n.t("this.key.does.not.exist", { lng: "en" });
    expect(error).toHaveBeenCalledTimes(1);

    error.mockRestore();
  });

  it("reports a missing key that is called with a defaultValue", async () => {
    await i18n.changeLanguage("en");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(i18n.t("another.missing.key", { lng: "en", defaultValue: "Fallback copy" })).toBe("Fallback copy");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('"another.missing.key"');

    error.mockRestore();
  });

  it("stays quiet for keys that exist in both languages", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const key of ["gate.title", "parent.child", "terminate_learner", "auth.login_button"]) {
      for (const lng of ["en", "sw"]) {
        expect(i18n.exists(key, { lng }), `${key} missing in ${lng}`).toBe(true);
        expect(i18n.t(key, { lng })).not.toBe(key);
      }
    }
    expect(error).not.toHaveBeenCalled();

    error.mockRestore();
  });
});
