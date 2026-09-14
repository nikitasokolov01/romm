import { describe, expect, it, vi } from "vitest";
import type { RomioCandidate, RomioGame } from "@/services/api/romio";
import {
  canPlayInBrowser,
  canPrepare,
  fileBasename,
  progressPercent,
  readSavedChoice,
  safeCode,
} from "@/v2/components/Romio/launchPolicy";
import { playerDocument } from "@/v2/components/Romio/playerDocument";

function candidate(overrides: Partial<RomioCandidate> = {}): RomioCandidate {
  return {
    id: "a".repeat(64),
    title: "Game (USA)",
    system: "nes",
    region: "USA",
    revision: "",
    source: {
      infoHash: "b".repeat(40),
      filePath: "collection/Game (USA).zip",
      size: 1000,
      sha256: "",
    },
    origin: "Minerva",
    provenance: "descriptor",
    totalSize: 1000,
    score: 1,
    reasons: [],
    cached: true,
    packaging: "zip",
    ...overrides,
  };
}
function game(overrides: Partial<RomioGame> = {}): RomioGame {
  return {
    id: "c".repeat(64),
    title: "Game",
    system: "nes",
    systemName: "NES",
    rommSlug: "nes",
    browserCore: "nes",
    sourceCount: 1,
    coverUrl: null,
    rating: null,
    ratingSource: null,
    awards: [],
    metadataSource: null,
    ...overrides,
  };
}

describe("remote game launch policy", () => {
  it("requires confirmed cache for cache-only collections", () => {
    expect(canPrepare(candidate({ cacheOnly: true, cached: null }))).toBe(
      false,
    );
    expect(canPrepare(candidate({ cacheOnly: true, cached: false }))).toBe(
      false,
    );
    expect(canPrepare(candidate({ cacheOnly: true, cached: true }))).toBe(true);
  });
  it("does not offer unsupported browser archives or missing cores", () => {
    expect(canPlayInBrowser(game(), candidate())).toBe(true);
    expect(canPlayInBrowser(game(), candidate({ packaging: "7z" }))).toBe(
      false,
    );
    expect(canPlayInBrowser(game(), candidate({ packaging: "rar" }))).toBe(
      false,
    );
    expect(canPlayInBrowser(game({ browserCore: null }), candidate())).toBe(
      false,
    );
    expect(
      canPlayInBrowser(
        game(),
        candidate({ source: { ...candidate().source, size: 513 * 1024 ** 2 } }),
      ),
    ).toBe(false);
  });
  it("retains the selected archive basename for native installation", () => {
    expect(fileBasename(candidate())).toBe("Game (USA).zip");
  });
  it("never renders arbitrary provider errors or credentials", () => {
    expect(safeCode("PROVIDER_BUSY")).toBe("PROVIDER_BUSY");
    expect(safeCode("https://provider.invalid/?key=secret")).toBeNull();
    expect(safeCode("Error with token secret")).toBeNull();
  });
  it("bounds nonfinite and out-of-range progress", () => {
    expect(progressPercent(NaN)).toBe(0);
    expect(progressPercent(-4)).toBe(0);
    expect(progressPercent(140)).toBe(100);
  });
  it("restores only valid stable identifiers and discards unrelated stored data", () => {
    expect(
      readSavedChoice('{"candidateId":"../secret","jobId":"invalid"}'),
    ).toBeNull();
    expect(readSavedChoice("not json")).toBeNull();
    expect(
      readSavedChoice(
        JSON.stringify({
          candidateId: "a".repeat(64),
          jobId: "b".repeat(64),
          url: "https://provider.invalid/?secret=key",
        }),
      ),
    ).toEqual({ candidateId: "a".repeat(64), jobId: "b".repeat(64) });
  });
});

describe("isolated browser player document", () => {
  const options = {
    core: "nes",
    acquisitionId: "a".repeat(64),
    candidateId: "b".repeat(64),
    userId: 7,
    extension: "zip",
    title: "Test Game",
  };
  it("uses only a stable same-origin redirect and bundled emulator assets", () => {
    const html = playerDocument(options);
    expect(html).toContain(
      `/api/romio/acquisitions/${"a".repeat(64)}/content/Romio-7-${"b".repeat(64)}.zip`,
    );
    expect(html).toContain(`Romio-7-nes-${"b".repeat(64)}`);
    expect(html).toContain("/assets/emulatorjs/data/loader.js");
    expect(html).not.toContain("https://");
  });
  it("rejects untrusted core and acquisition identifiers", () => {
    expect(() =>
      playerDocument({ ...options, core: "nes';alert(1)" }),
    ).toThrow();
    expect(() =>
      playerDocument({ ...options, acquisitionId: "../secret" }),
    ).toThrow();
    expect(() =>
      playerDocument({ ...options, extension: "../../zip" }),
    ).toThrow();
    expect(() => playerDocument({ ...options, userId: -1 })).toThrow();
  });
  it("cannot turn a source title into executable HTML", () => {
    const html = playerDocument({
      ...options,
      title: "</script><script>alert(1)</script>",
    });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
  it("isolates save databases in the player frame while leaving core caches shared", () => {
    const opened = vi.fn();
    const deleted = vi.fn();
    class FrameIDBFactory {
      open(name: string, version?: number) {
        opened(name, version);
      }
      deleteDatabase(name: string) {
        deleted(name);
      }
    }
    const script = playerDocument(options).match(
      /<script>([\s\S]*?)<\/script>/,
    )?.[1];
    expect(script).toBeDefined();
    new Function("window", "document", "IDBFactory", script!)(
      { addEventListener: vi.fn() },
      { title: "" },
      FrameIDBFactory,
    );
    const factory = new FrameIDBFactory();
    factory.open("/data/saves", 21);
    factory.open("EmulatorJS-states");
    factory.open("EmulatorJS-core");
    factory.deleteDatabase("/data/saves");
    const prefix = `Romio-7-nes-${"b".repeat(64)}:`;
    expect(opened).toHaveBeenCalledWith(`${prefix}/data/saves`, 21);
    expect(opened).toHaveBeenCalledWith(
      `${prefix}EmulatorJS-states`,
      undefined,
    );
    expect(opened).toHaveBeenCalledWith("EmulatorJS-core", undefined);
    expect(deleted).toHaveBeenCalledWith(`${prefix}/data/saves`);
  });
});
