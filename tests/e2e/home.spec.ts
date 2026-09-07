import { expect, test, type Locator } from "@playwright/test";

test("serves the built home page and health endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a private room" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Join a lobby" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join lobby" })).toBeEnabled();

  const [tileBox, createButtonBox, joinButtonBox] = await Promise.all([
    page.locator(".home-hero-tile").boundingBox(),
    page.getByRole("button", { name: "Create a private room" }).boundingBox(),
    page.getByRole("button", { name: "Join lobby" }).boundingBox(),
  ]);
  if (tileBox === null || createButtonBox === null || joinButtonBox === null)
    throw new Error("Landing-page layout controls are unavailable");
  expect(tileBox.width).toBeLessThan(Math.min(createButtonBox.width, joinButtonBox.width) / 2);
  expect(createButtonBox.height).toBeGreaterThanOrEqual(52);
  expect(joinButtonBox.height).toBeGreaterThanOrEqual(52);
  expect(Math.abs(createButtonBox.width - joinButtonBox.width)).toBeLessThanOrEqual(1);

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({ status: "ok" });

  await page.getByLabel("Lobby code").fill("not-a-code");
  await page.getByRole("button", { name: "Join lobby" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter the 12-character lobby code from your invitation.",
  );

  await page.getByLabel("Lobby code").fill("WESTROOM0001");
  await page.getByRole("button", { name: "Join lobby" }).click();
  await expect(page).toHaveURL(/\/room\/westroom0001$/);
  await expect(page.getByRole("heading", { name: "Join Mahjong Together" })).toBeVisible();
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

  if (nextTheme !== "dark") {
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await contrastRatio(page.locator(".home-card"))).toBeGreaterThanOrEqual(4.5);
});

async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const parseColor = (color: string) => {
      const channels = color
        .match(/\d+(?:\.\d+)?/g)
        ?.slice(0, 3)
        .map(Number);
      if (channels?.length !== 3) throw new Error(`Unsupported color ${color}`);
      return channels;
    };
    const luminance = (channels: number[]) => {
      const [red, green, blue] = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const style = window.getComputedStyle(element);
    const foreground = luminance(parseColor(style.color));
    const background = luminance(parseColor(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}
