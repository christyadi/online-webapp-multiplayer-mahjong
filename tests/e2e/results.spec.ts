import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test("a host can start the next hand from the completed result dialog", async ({ page }) => {
  await startCompletedHand(page);

  const resultDialog = page.getByRole("dialog", { name: "Draw hand" });
  await expect(resultDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to lobby" })).toHaveCount(0);
  await resultDialog.getByRole("button", { name: "Close Draw hand" }).click();
  await expect(resultDialog).toHaveCount(0);
  await page.getByRole("button", { name: "View result" }).click();
  await expect(resultDialog).toBeVisible();
  await resultDialog.getByRole("button", { name: "Show other hands" }).click();
  const opponentHands = resultDialog.locator("#opponent-hands");
  await expect(opponentHands).toBeVisible();
  await expect(opponentHands.locator(".opponent-hand")).toHaveCount(3);
  await resultDialog.getByRole("button", { name: "Hide other hands" }).click();
  await expect(opponentHands).toHaveCount(0);
  await expect(resultDialog).toBeVisible();
  const autoPlay = resultDialog.getByRole("checkbox", { name: /Auto-play next hand/ });
  await expect(autoPlay).toBeChecked();
  await autoPlay.uncheck();
  await expect(autoPlay).not.toBeChecked();
  let rematchStarts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/start")) {
      rematchStarts += 1;
    }
  });
  await page.waitForTimeout(16_000);
  await expect(resultDialog).toBeVisible();
  expect(rematchStarts).toBe(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await resultDialog.getByRole("button", { name: "Play again" }).click();

  await expect(resultDialog).toBeHidden();
  await expect(page.locator(".table-felt")).toBeVisible();
  expect(rematchStarts).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the next hand stays interactive when the other hands panel was left open", async ({
  page,
}) => {
  await startCompletedHand(page);

  const resultDialog = page.getByRole("dialog", { name: "Draw hand" });
  await resultDialog.getByRole("button", { name: "Show other hands" }).click();
  await expect(resultDialog.locator("#opponent-hands")).toBeVisible();

  await resultDialog.getByRole("button", { name: "Play again" }).click();

  await expect(resultDialog).toHaveCount(0);
  await expect(page.locator("#opponent-hands")).toHaveCount(0);
  await expect(page.locator(".table-felt")).toBeVisible();
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await page.getByRole("button", { name: "Table menu" }).click();
  await expect(page.getByRole("dialog", { name: "Table menu" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("escape closes the result dialog and leaves the table interactive", async ({ page }) => {
  await startCompletedHand(page);

  const resultDialog = page.getByRole("dialog", { name: "Draw hand" });
  await resultDialog.getByRole("button", { name: "Show other hands" }).click();
  await expect(resultDialog.locator("#opponent-hands")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(resultDialog).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert");

  // Reopening and starting the next hand keeps this test at two started hands, which the
  // fixture's alternating completed/in-play parity depends on.
  await page.getByRole("button", { name: "View result" }).click();
  await expect(resultDialog).toBeVisible();
  await resultDialog.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator(".table-felt")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a completed hand automatically rematches after fifteen seconds by default", async ({
  page,
}) => {
  await startCompletedHand(page);

  let rematchStarts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/start")) {
      rematchStarts += 1;
    }
  });
  const resultDialog = page.getByRole("dialog", { name: "Draw hand" });
  await expect(resultDialog.getByText(/Auto-play next hand in \d+s/)).toBeVisible();
  await page.waitForTimeout(14_000);
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".table-felt")).toBeVisible();
  expect(rematchStarts).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a result-screen host disconnect transfers one auto-rematch to the remaining human", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await host.getByLabel("Nickname").fill("Host");
    await host.getByRole("button", { name: "Create a private room" }).click();
    const friend = await newGuestPage(browser, contexts);
    await friend.goto(host.url());
    await friend.getByLabel("Nickname").fill("Friend");
    await friend.getByRole("button", { name: "Join room" }).click();

    await host.getByRole("button", { name: "I’m ready" }).click();
    await friend.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "Start hand" }).click();
    await expect(host.getByRole("dialog", { name: "Draw hand" })).toBeVisible();
    await expect(friend.getByRole("dialog", { name: "Draw hand" })).toBeVisible();

    let rematchStarts = 0;
    friend.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/start")) {
        rematchStarts += 1;
      }
    });
    const hostContext = contexts.shift();
    if (hostContext === undefined) throw new Error("Missing host context");
    await hostContext.close();

    const resultDialog = friend.getByRole("dialog", { name: "Draw hand" });
    await expect(resultDialog.getByRole("button", { name: "Play again" })).toBeEnabled();
    await friend.waitForTimeout(14_000);
    expect(rematchStarts).toBe(0);
    await expect(resultDialog).toBeHidden({ timeout: 5_000 });
    await expect(friend.getByLabel("South is dealer")).toBeVisible();
    expect(rematchStarts).toBe(1);
    await friend.waitForTimeout(1_000);
    expect(rematchStarts).toBe(1);
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

async function startCompletedHand(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Nickname").fill("Host");
  await page.getByRole("button", { name: "Create a private room" }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await expect(page.getByText("Draw hand", { exact: true })).toBeVisible();
}

async function newGuestPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}
