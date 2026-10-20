// Run with Playwright installed: node tests/layout.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const pageUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

async function assertClearLayout(page, label) {
  const layout = await page.evaluate(() => {
    const card = document.getElementById('greetingCard').getBoundingClientRect();
    const covered = ['.greeting', '.scene-footer', '#bouquetStageWrapper', '#openCard'].filter(selector => {
      const text = document.querySelector(selector).getBoundingClientRect();
      return Math.min(text.right, card.right) - Math.max(text.left, card.left) > 1
        && Math.min(text.bottom, card.bottom) - Math.max(text.top, card.top) > 1;
    });
    const envelope = document.getElementById('openCard').getBoundingClientRect();
    return {
      covered,
      overflow: document.documentElement.scrollWidth > innerWidth,
      envelopeFits: envelope.left >= 0 && envelope.right <= innerWidth,
      cardFits: card.left >= 0 && card.right <= innerWidth,
      modal: document.getElementById('greetingCard').matches(':modal'),
      expanded: document.getElementById('openCard').getAttribute('aria-expanded')
    };
  });
  assert.deepEqual(layout.covered, [], `${label}: card must reserve space instead of covering existing content`);
  assert.equal(layout.overflow, false, `${label}: no horizontal overflow`);
  assert.equal(layout.envelopeFits, true, `${label}: envelope stays visible`);
  assert.equal(layout.cardFits, true, `${label}: card stays inside the page`);
  assert.equal(layout.modal, false, `${label}: page remains interactive`);
  assert.equal(layout.expanded, 'true');
}

(async () => {
  const browser = await chromium.launch();
  try {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1024, height: 860 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pageUrl);
    assert.equal(await page.locator('#memoryAlbum').count(), 0, 'the photo album is removed');
    assert.equal(await page.locator('.garden-link').getAttribute('href'), './garden.html', 'the garden opens as a separate page');
    assert.equal(await page.locator('#cardRecipient').textContent(), 'Như Ý', 'the default greeting is addressed to Như Ý');
    assert.ok((await page.locator('#cardTitle').textContent()).includes('Như Ý'), 'the greeting title includes the recipient name');
    assert.equal(await page.locator('#bouquetStageWrapper').evaluate(e => {
      const r = e.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2;
    }), true, 'bouquet is centered on arrival');
    await page.locator('#openCard').click();
    await assertClearLayout(page, '1024px original regression');

    for (const viewport of [
      { width: 1440, height: 1000 }, { width: 1367, height: 860 },
      { width: 1280, height: 720 }, { width: 1100, height: 768 },
      { width: 1099, height: 768 }, { width: 768, height: 1024 },
      { width: 600, height: 800 }, { width: 390, height: 844 },
      { width: 320, height: 568 }, { width: 844, height: 390 }
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      await assertClearLayout(page, `${viewport.width} × ${viewport.height}`);
    }
    await page.setViewportSize({ width: 1222, height: 709 });
    await page.locator('#closeCard').click();
    await page.locator('#openCard').click();
    const compactCard = await page.locator('#greetingCard').evaluate(e => {
      const rect = e.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: innerHeight };
    });
    assert.ok(compactCard.top >= 0 && compactCard.bottom <= compactCard.viewport,
      'opened default letter fits vertically on a short desktop viewport');
    await page.setViewportSize({ width: 1367, height: 860 });
    await page.locator('#editCard').click();
    await page.locator('#recipientInput').fill('Mẹ yêu');
    await page.locator('#messageInput').fill('Chúc mẹ luôn khỏe mạnh và bình an.\n'.repeat(30));
    await page.locator('#senderInput').fill('Con của mẹ');
    await page.getByRole('button', { name: 'Lưu lời chúc', exact: true }).click();
    assert.equal(await page.locator('#cardRecipient').textContent(), 'Mẹ yêu');
    assert.equal(await page.locator('#cardTitleRecipient').textContent(), 'Mẹ yêu', 'the title follows a customized recipient');
    assert.equal(await page.locator('#envelopeRecipient').textContent(), 'Mẹ yêu', 'the envelope follows a customized recipient');
    await assertClearLayout(page, 'long personalized letter');
    await page.setViewportSize({ width: 1367, height: 860 });
    assert.equal(await page.locator('#greetingCard').evaluate(d => d.scrollHeight <= d.clientHeight + 1), true,
      'Long letter grows with the document instead of clipping into a fixed overlay');
    await page.locator('#bouquetStageWrapper').focus();
    await page.keyboard.press('Enter');
    assert.ok((await page.locator('#roseWish').textContent()).length, 'roses remain interactive with the card open');
    await assertClearLayout(page, 'flower wish with open letter');
    await page.locator('#openCard').click();
    assert.equal(await page.locator('#greetingCard').isVisible(), false, 'envelope folds the letter');
    assert.equal(await page.locator('#openCard').getAttribute('aria-expanded'), 'false');
    await page.locator('#openCard').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#greetingCard').isVisible(), false);
    assert.equal(await page.locator('#openCard').evaluate(e => e === document.activeElement), true);
    await page.locator('#openCard').click();
    await page.locator('#closeCard').click();
    assert.equal(await page.locator('#greetingCard').isVisible(), false);

    // Exercise the layout movement with animations enabled and while changing orientation.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#openCard').click();
    await page.waitForTimeout(900);
    await assertClearLayout(page, 'animated open');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await assertClearLayout(page, 'resize open letter to mobile');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#openCard').evaluate(e => {
      const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
    }), true, 'closing returns the opener into view');
    assert.deepEqual(errors, []);
    console.log('PASS: centered bouquet, no photo album, no card/text/bouquet overlap across 11 viewport sizes, resize while open, long letters, editable greeting, flower interaction and keyboard/toggle close. No page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
