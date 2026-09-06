import { expect, test } from "@playwright/test";

test("serves the built home page and health endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a private room" })).toBeEnabled();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({ status: "ok" });
});

test("can toggle and persist dark mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);

  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if (currentTheme !== "light" && currentTheme !== "dark") {
    throw new Error("Theme attribute was not initialized");
  }
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  await page.getByRole("button", { name: `Switch to ${nextTheme} mode` }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
  await expect(
    page.getByRole("button", { name: `Switch to ${currentTheme} mode` }),
  ).toHaveAttribute("aria-pressed", nextTheme === "dark" ? "true" : "false");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
});
