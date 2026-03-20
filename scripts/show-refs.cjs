const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://localhost:9322");
  const page = browser.contexts()[0].pages()[0];

  // Expand posts folder
  const posts = page.locator('span:has-text("posts")');
  if (await posts.count() > 0) await posts.click();
  await page.waitForTimeout(500);

  // Click even-cycle post (name is truncated in tree)
  const post = page.locator('span:has-text("even-cy")');
  if (await post.count() > 0) {
    await post.first().click();
    await page.waitForTimeout(2000);
  } else {
    console.log("Post not found");
    process.exit(1);
  }

  // Scroll to show references
  await page.evaluate(() => {
    const cm = document.querySelector(".cm-scroller");
    if (cm) cm.scrollTop = cm.scrollHeight;
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: "/tmp/cg-refs-final.png" });
  console.log("Screenshot saved");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
