// The game's copy of the content (engine/data.js, mergeCustomData) in a real browser, local mode, made-up content
// stored as a saved copy: the levels follow the level order (an empty name makes an empty level, a category outside
// the order makes none), words are one per text (case and spaces ignored, the first wins), grammar rules one per id,
// antonyms that name another word become opposites both ways, and there is one badge per level plus four fixed ones.
// The same after an admin edit and after a reload. Docs: docs/modules/content/content-catalog.md.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(__dirname, '..', 'out');

const W = (word, category, extra = {}) => ({ word, type: 'vocab', category, meaning: `The meaning of ${word.trim()}.`, situation: `We saw the ${word.trim()} today.`, gap: 'We saw the ______ today.', ...extra });
const SAVED = {
  note: 'Made-up content for the game copy browser spec.', combos: [], stories: [], challenges: [],
  words: [W('Drizzle', 'Weather', { antonyms: ['Downpour'] }), W('Downpour', 'Weather'), W('Gust', 'Weather'), W(' gust', 'Weather', { meaning: 'A second copy.' }), W('Humid', 'Climate'), W('Concierge', 'Hotel')],
  grammar: [{ id: 'g-past', type: 'grammar', category: 'Weather', rule: 'Past simple' }, { id: 'g-past', type: 'grammar', category: 'Climate', rule: 'A second copy' }],
  levelOrder: ['Weather', 'Climate', 'Empty'],
};

const store = (page, value) => page.evaluate((v) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => { const t = open.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'local:content'); t.oncomplete = resolve; };
}), value);
const home = async (page) => {
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const cards = page.locator('.wh-level-card');
  const levels = [];
  for (let i = 0; i < await cards.count(); i++) levels.push(`${await cards.nth(i).locator('.wh-level-title').innerText()}:${(await cards.nth(i).locator('.wh-level-meta').first().innerText()).split(' ')[0]}`);
  return { cleared: await page.locator('.wh-sub').innerText(), badges: (await page.locator('button[title="View badges"]').innerText()).trim(), levels };
};
const strip = async (page) => {
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  return (await page.locator('.ie-strip > div').nth(1).innerText()).replace(/\s+/g, ' ');
};
const exported = async (page) => {
  await page.click('.ie-option:has-text("Content only")'); await page.waitForTimeout(300);
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('.ie-btn.primary:has-text("Download")')]);
  const to = path.join(OUT, `gamecopy-${file.suggestedFilename()}`);
  await file.saveAs(to);
  return JSON.parse(fs.readFileSync(to, 'utf8'));
};
const badges = async (page) => {
  await page.click('button[title="View badges"]'); await page.waitForTimeout(500);
  const all = page.locator('.wh-badge');
  const out = [];
  for (let i = 0; i < await all.count(); i++) out.push(`${await all.nth(i).locator('.wh-badge-label').innerText()}${(await all.nth(i).getAttribute('class')).includes('earned') ? ' (earned)' : ''}`);
  return out;
};

run(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const empty = `${await page.locator('.wh-sub').innerText()} · ${(await page.locator('button[title="View badges"]').innerText()).trim()}`;
  ok(empty === '0/0 levels cleared · 1/4', 'before any content: no levels and the four fixed badges; "Full Case Archive" counts as earned with no levels: ' + empty);
  await store(page, SAVED);

  // the saved copy
  const first = await home(page);
  ok(/^0\/3 levels cleared/.test(first.cleared), 'one level per name in the order: ' + first.cleared);
  ok(JSON.stringify(first.levels) === JSON.stringify(['Weather:4', 'Climate:1', 'Empty:0']), 'levels in order; Weather has 3 words and its rule, Climate only Humid (the second g-past is dropped), Empty is empty, Hotel is in no level: ' + first.levels.join(', '));
  ok(first.badges === '1/7', 'one badge per level plus four; the empty level\'s badge counts as earned already: ' + first.badges);
  const list = await badges(page);
  ok(JSON.stringify(list) === JSON.stringify(['Weather Files Closed', 'Climate Files Closed', 'Empty Files Closed (earned)', 'Warming Up', 'On a Roll', 'Unstoppable', 'Full Case Archive']), 'the badges, in order: ' + list.join(', '));
  const counts = await strip(page);
  ok(counts === 'GAME CONTENT 5 words 1 grammar · 0 stories · 0 challenges · 3 categories', 'the counts come from the game\'s copy (one Gust, one g-past): ' + counts);
  const file = await exported(page);
  const words = Object.fromEntries(file.words.map((w) => [w.word, w]));
  ok(JSON.stringify(file.words.map((w) => w.word)) === JSON.stringify(['Drizzle', 'Downpour', 'Gust', 'Humid', 'Concierge']), 'the exported words are the game\'s copy: the first Gust kept, " gust" dropped');
  ok(words.Drizzle.opposite === 'Downpour' && words.Downpour.opposite === 'Drizzle' && words.Gust.meaning === 'The meaning of Gust.', 'an antonym naming another word becomes an opposite both ways');
  ok(file.grammar.length === 1 && file.grammar[0].category === 'Weather', 'one grammar rule per id, the first one kept');

  // an admin edit rebuilds the copy
  await page.goto(APP + '/admin/categories', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  await page.click('button:has-text("New category")');
  await page.locator('[role="alertdialog"] input').fill('Spare');
  await page.locator('[role="alertdialog"] button:has-text("Add")').click(); await page.waitForTimeout(1200);
  const edited = await home(page);
  ok(/^0\/4 levels cleared/.test(edited.cleared) && edited.badges === '2/8' && edited.levels.at(-1) === 'Spare:0', 'a new category makes a level and a badge at once: ' + JSON.stringify(edited));

  // after a reload
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const again = await home(page);
  ok(JSON.stringify(again) === JSON.stringify(edited), 'the same after a reload');
  await page.screenshot({ path: `${SP}/shot-gamecopy.png`, fullPage: true });
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});
