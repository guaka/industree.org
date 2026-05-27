const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route("https://audio.industree.org/**", (route) => route.abort());
});

test("renders the music archive and keeps filters interactive", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Audio \(/ })).toBeVisible();

  const search = page.getByPlaceholder("Search songs, artists, files...");
  await search.fill("butter");

  await expect(page.getByText("Butter Fun by 2L84US")).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("butter");

  await page.getByRole("link", { name: /IT \(/ }).click();
  await expect(page).toHaveURL(/\/audio\/#it$/);
  await expect(page.locator("[data-music-status='it']")).toHaveAttribute("aria-pressed", "true");
});

test("opens a song detail page and uses the persistent audio player", async ({ page }) => {
  await page.goto("/audio/butter-fun-2l84us/");

  await expect(page.getByRole("heading", { name: "Butter Fun by 2L84US" })).toBeVisible();
  await page.getByRole("button", { name: "Play audio" }).click();

  const player = page.locator(".bottom-player");
  await expect(player).toBeVisible();
  await expect(player.locator(".bottom-player-title")).toHaveText("Butter Fun by 2L84US");
  await expect(player.locator("[data-mixtape-audio]")).toHaveAttribute("src", /audio\.industree\.org\/audio\//);
});

test("supports archive routes, hash compatibility, and not-found pages", async ({ page }) => {
  await page.goto("/archive/");
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();

  await page.goto("/#/archive/");
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();

  await page.goto("/lyrics/");
  await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
  await expect(page.locator("[data-music-status='lyrics']")).toHaveAttribute("aria-pressed", "true");

  await page.goto("/this-page-does-not-exist/");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("loads the compact Impulse player on demand", async ({ page }) => {
  await page.goto("/impulse/");

  await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
  await expect(page.locator("[data-music-status='it']")).toHaveAttribute("aria-pressed", "true");

  await page.locator("[data-track-kind='it']").first().click();

  await expect(page.locator(".bottom-player-it")).toBeVisible();
  await expect(page.locator(".compact-impulse-player")).toBeVisible();
  await expect(page.locator("#compactImpulseStatus")).toContainText(/Loading|Failed|Ready/);
});

test("supports the full Impulse player tabs and file list", async ({ page }) => {
  await page.goto("/");

  await page.locator("[data-track-kind='it']").first().click();
  await expect(page.locator(".compact-impulse-player")).toBeVisible();

  await page.evaluate(() => {
    const template = document.getElementById("impulse-player-template");
    const mount = document.createElement("div");
    mount.id = "impulsePlayerMount";
    mount.className = "impulse-player-mount";
    mount.appendChild(template.content.cloneNode(true));
    document.body.appendChild(mount);
    window.initIndusTreeImpulsePlayer({
      baseUrl: "https://audio.industree.org/itfiles/",
      files: ["1-2sleepy.it", "fake-second.it"],
      initialFile: "1-2sleepy.it",
    });
  });

  await expect(page.locator("#samplePanel")).not.toHaveClass(/active/);
  await page.locator(".tab[data-panel='samplePanel']").click();
  await expect(page.locator("#samplePanel")).toHaveClass(/active/);

  await expect(page.locator("[data-it-file='1-2sleepy.it']")).toHaveClass(/active/);
  await page.locator("[data-it-file='fake-second.it']").click();
  await expect(page.locator("[data-it-file='fake-second.it']")).toHaveClass(/active/);
});
