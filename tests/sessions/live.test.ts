import { describe, expect, it } from "vitest";
import { hasLiveBackendAuth } from "../../src/sessions/live.js";

/**
 * T-140 — the live-backend auth gate covers every transport the platform
 * ships (proven by execution: a Max-plan machine with no API key completed a
 * real SDK session). The v2 line hard-required ANTHROPIC_API_KEY; that check
 * would have locked subscription users out of their own self-build.
 */

describe("T-140 hasLiveBackendAuth", () => {
  const loggedOut = () => false;
  const loggedIn = () => true;

  it("an API key or an OAuth token is live, without probing the CLI", () => {
    expect(hasLiveBackendAuth({ ANTHROPIC_API_KEY: "sk-test" }, loggedOut)).toBe(true);
    expect(hasLiveBackendAuth({ CLAUDE_CODE_OAUTH_TOKEN: "tok" }, loggedOut)).toBe(true);
  });

  it("with no env credential, the CLI's own login decides (subscription path)", () => {
    expect(hasLiveBackendAuth({}, loggedIn)).toBe(true);
    expect(hasLiveBackendAuth({}, loggedOut)).toBe(false);
  });

  it("DETENT_NO_LIVE=1 forces no — the dry-run seam beats every credential", () => {
    expect(
      hasLiveBackendAuth({ DETENT_NO_LIVE: "1", ANTHROPIC_API_KEY: "sk", CLAUDE_CODE_OAUTH_TOKEN: "tok" }, loggedIn),
    ).toBe(false);
  });
});
