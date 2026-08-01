import { describe, it, expect } from "vitest";
import { triggerAlert, notify } from "@/lib/notifier";

describe("Notifier", () => {
  it("notify writes to outbox", async () => {
    const item = await notify({
      channel: "line",
      recipient: "test-token",
      subject: "Test",
      body: "Test body",
      metadata: {},
    });
    expect(item.id).toBeTruthy();
    expect(item.status).toBe("sent");
  });

  it("triggerAlert fires when sentiment < -50 and push > 10", async () => {
    const items = await triggerAlert(
      "brand_asus",
      "Negative title",
      "https://example.com",
      -75,
      20
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it("triggerAlert does NOT fire when sentiment >= -50", async () => {
    const items = await triggerAlert(
      "brand_asus",
      "Neutral title",
      "https://example.com",
      50,
      20
    );
    expect(items.length).toBe(0);
  });

  it("triggerAlert does NOT fire when push count <= 10", async () => {
    const items = await triggerAlert(
      "brand_asus",
      "Negative but low push",
      "https://example.com",
      -75,
      5
    );
    expect(items.length).toBe(0);
  });
});