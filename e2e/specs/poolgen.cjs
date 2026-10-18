// New practice sentences in a real browser (local mode, made-up content from fixtures/content-admin.json): a correct
// answer to a word's only pool item asks the AI for a new one in the background. Local mode has no AI, so the request
// fails at once; this checks that it was made, that the failure is only logged, that the round goes on to its end, and
// that nothing half-made is saved in the pools. How new items are added: tests/ai-generation-hook.test.jsx.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');
const WORDS = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).words;
const answerFor = (body) => WORDS.find((w) => body.includes(w.meaning) || body.includes(w.gap) || body.includes(w.situation.replace(w.word, '______')));

const idbGet = (page, key) => page.evaluate((k) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const g = open.result.transaction('kv', 'readonly').objectStore('kv').get(k); g.onsuccess = () => resolve(g.result || null); };
}), key);

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })).newPage();
  const errors = [], generation = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (/generation failed/i.test(m.text())) generation.push(m.text()); });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(1500);
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

  await page.click('.wh-level-btn:has-text("Practice") >> nth=0'); await page.waitForTimeout(1200);
  let answered = 0, finished = false;
  for (let i = 0; i < 30 && !finished; i++) {
    const body = await page.innerText('body');
    if (/Save results/.test(body)) { finished = true; break; }
    const next = page.locator('button:has-text("Continue"):visible, button:has-text("Next word"):visible').first();
    const options = page.locator('button:visible').filter({ hasText: /^\d\S/ });
    const input = page.locator('input[aria-label="Your answer"]');
    if (await next.count()) {
      await next.click();
    } else if (await options.count()) {
      const texts = (await options.allTextContents()).map((t) => t.replace(/^\d/, ''));
      const prompt = texts.reduce((b, t) => b.split(t).join(' '), body);
      const right = texts.find((t) => { const w = WORDS.find((x) => x.word === t); return w && (prompt.includes(w.meaning) || prompt.includes(w.gap)); })
        || texts.find((t) => { const w = WORDS.find((x) => x.meaning === t); return w && new RegExp(`\\b${w.word}\\b`).test(prompt); });
      if (!right) break;
      await options.nth(texts.indexOf(right)).click();
      await page.locator('button:has-text("Submit"):visible').click(); answered++;
    } else if (answerFor(body) && (await input.count()) && !(await input.isDisabled())) {
      await input.fill(answerFor(body).word); await page.keyboard.press('Enter'); answered++;
    }
    await page.waitForTimeout(700);
  }
  ok(answered >= 2 && finished, `the round's questions were answered and it reached its end (${answered} answered)`);
  ok(generation.length >= 1, 'a correct answer asked for a new sentence; local mode logs the failure: ' + (generation[0] || 'none').slice(0, 90));
  ok(generation.every((t) => /^(Content|Variant) generation failed/.test(t)), 'only the generation log line, nothing else broke');
  await page.click('button:has-text("Save results")'); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SP}/shot-poolgen.png`, fullPage: true });
  const progress = await idbGet(page, 'local:progress');
  const generated = JSON.stringify(progress?.pools || {}).match(/"gen-/g) || [];
  ok(generated.length === 0, 'no new item was added to the saved pools (the AI gave nothing)');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});
