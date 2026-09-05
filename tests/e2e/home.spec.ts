import { expect, test } from "@playwright/test";

test("serves the built home page and health endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a private room" })).toBeEnabled();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({ status: "ok" });
});
