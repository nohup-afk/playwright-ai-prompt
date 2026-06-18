import { test } from "../src/fixtures";
import { BASE_URL, CREDENTIALS } from "../src/test-config";

// Workflow 2: continuous AI-powered testing.
// Target URL and credentials come from .env (see .env.example) via src/test-config.
// First run: AI generates Playwright code and caches it in .pwai-cache/.
// Later runs (and CI): cached code replays instantly, no LLM needed.
// If the app's UI changes and a cached step fails, it self-heals.

test.describe("Sauce Demo shop", () => {
  test("logs in with valid credentials", async ({ page, ai }) => {
    await page.goto(BASE_URL);
    await ai(
      [
        // {{placeholders}} keep the cache valid when values change
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        'verify the page shows the "Swag Labs" title',
      ],
      CREDENTIALS,
    );
  });

  test("adds an item to the cart", async ({ page, ai }) => {
    await page.goto(BASE_URL);
    await ai(
      [
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        'add the "Sauce Labs Backpack" to the cart',
        "verify the cart badge shows 1",
      ],
      CREDENTIALS,
    );
  });

  test("shows an error for locked out user", async ({ page, ai }) => {
    await page.goto(BASE_URL);
    await ai(
      [
        'type "{{username}}" into the username field',
        'type "{{password}}" into the password field',
        "click the login button",
        "verify an error message says the user is locked out",
      ],
      // This test needs a specific user, so it overrides the .env default username
      { username: "locked_out_user", password: CREDENTIALS.password },
    );
  });
});
