import { test } from "../src/fixtures";

// Workflow 2: continuous AI-powered testing.
// These natural-language steps stay in the spec permanently.
// First run: AI generates Playwright code and caches it in .pwai-cache/.
// Later runs (and CI): cached code replays instantly, no LLM needed.
// If the app's UI changes and a cached step fails, it self-heals:
// the step is regenerated against the live page and the cache updates.

test.describe("Sauce Demo shop", () => {
  test("logs in with valid credentials", async ({ page, ai }) => {
    await page.goto("https://www.saucedemo.com");
    await ai(
      [
        // {{placeholders}} keep the cache valid when values change
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        'verify the page shows the "Swag Labs" title',
      ],
      { username: "standard_user", password: "secret_sauce" },
    );
  });

  test("adds an item to the cart", async ({ page, ai }) => {
    await page.goto("https://www.saucedemo.com");
    await ai(
      [
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        'add the "Sauce Labs Backpack" to the cart',
        "verify the cart badge shows 1",
      ],
      { username: "standard_user", password: "secret_sauce" },
    );
  });

  test("shows an error for locked out user", async ({ page, ai }) => {
    await page.goto("https://www.saucedemo.com");
    await ai(
      [
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        "verify an error message says the user is locked out",
      ],
      { username: "locked_out_user", password: "secret_sauce" },
    );
  });
});
