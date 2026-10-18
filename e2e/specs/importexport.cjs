// Import & export in a real browser (local mode, the local player is the admin), with made-up content
// (fixtures/content-admin.json): the files Download makes (a full backup, content only), and a backup imported back
// in "My progress only" and in "Content and my progress". Each result is read from what the game saved (IndexedDB)
// and again after a reload.
const { APP, OUT, ok, launch, run, SP } = require('../helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content-admin.json');
const EXTRA = path.join(OUT, 'importexport-extra.json');

const idb = (page, key, value) => page.evaluate(([k, v]) => new Promise((resolve) => {
  const open = indexedDB.open('word-hunter', 1);
  open.onsuccess = () => {
    const store = open.result.transaction('kv', v === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    if (v === undefined) { const g = store.get(k); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); }
    else { const g = store.get(k); g.onsuccess = () => { store.put({ ...(g.result || {}), ...v }, k).onsuccess = () => resolve(); }; }
  };
  open.onerror = () => resolve(null);
}), [key, value]);
const saved = async (page) => {
  const content = await idb(page, 'local:content'), progress = await idb(page, 'local:progress');
  return { words: (content?.words || []).map((w) => `${w.word}:${w.category}`).sort(), score: progress?.score ?? null, drizzle: progress?.mastery?.Drizzle?.total ?? null };
};
const download = async (page, option) => {
  await page.click(`.ie-option:has-text("${option}")`); await page.waitForTimeout(300);
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('.ie-btn.primary:has-text("Download")')]);
  const to = path.join(OUT, `importexport-${file.suggestedFilename()}`);
  await file.saveAs(to);
  return { name: file.suggestedFilename(), to, text: fs.readFileSync(to, 'utf8') };
};
const importFile = async (page, file, modeTitle) => {
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.setInputFiles('#ie-file', file); await page.waitForTimeout(1200);
  if (modeTitle) await page.click(`.ie-modes .ie-option:has-text("${modeTitle}")`);
  await page.click('.ie-apply'); await page.waitForTimeout(2000);
  return (await page.locator('.ie-done b').textContent().catch(() => '')) || '';
};

run(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(2000);
  const course = (await saved(page)).words;
  ok(course.length === 6, 'the made-up course is in: ' + course.join(', '));

  // progress a player would have: a score and a practised word
  await idb(page, 'local:progress', { score: 120, mastery: { Drizzle: { total: 4, correct: 3, recent: [] } } });
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
  const before = await saved(page);
  ok(before.score === 120 && before.drizzle === 4, 'the player has 120 points and practised Drizzle');

  // export: a full backup and the content only
  const backup = await download(page, 'Full backup');
  const b = JSON.parse(backup.text);
  ok(/^word-hunter-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backup.name), 'backup file name: ' + backup.name);
  ok(!backup.text.includes('\n') && b.kind === 'backup' && typeof b.exportedAt === 'string' && typeof b.exportedBy === 'string', 'the backup is one line with kind, exportedAt and exportedBy');
  ok(b.score === 120 && b.mastery?.Drizzle?.total === 4 && b.words.length === 6, 'the backup holds the progress and the 6 words');
  const content = await download(page, 'Content only');
  const c = JSON.parse(content.text);
  ok(/^word-hunter-content-\d{4}-\d{2}-\d{2}\.json$/.test(content.name) && c.words.length === 6 && c.mastery === undefined && c.score === undefined, 'content only: the 6 words, no progress');

  // the progress is lost; "My progress only" brings it back and leaves the content
  await idb(page, 'local:progress', { score: 0, mastery: {} });
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok((await saved(page)).score === 0, 'the progress is gone');
  const progressText = await importFile(page, backup.to, 'My progress only');
  ok(progressText.includes('Your progress was restored'), 'progress only: the screen says so: ' + progressText);
  const restored = await saved(page);
  ok(restored.score === 120 && restored.drizzle === 4 && JSON.stringify(restored.words) === JSON.stringify(course), 'progress only: 120 points and Drizzle are back, the content is the same');

  // an extra word is added, the progress changes; "Content and my progress" brings both back to the backup's
  fs.writeFileSync(EXTRA, JSON.stringify({ schemaVersion: 2, kind: 'content', words: [{ word: 'Kettle', type: 'vocab', category: 'Hotel', meaning: 'A pot for boiling water.', situation: 'She filled the Kettle and made tea for everyone.', gap: 'She filled the ______ and made tea for everyone.', partsOfSpeech: ['noun'] }] }));
  const extraText = await importFile(page, EXTRA);
  ok(extraText.includes("Content imported; everyone's progress is kept"), 'a content file: the screen says so: ' + extraText);
  await idb(page, 'local:progress', { score: 5 });
  await page.goto(APP + '/data', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const changed = await saved(page);
  ok(changed.words.includes('Kettle:Hotel') && changed.words.length === 7 && changed.score === 5, 'Kettle is in, the score is 5');
  const fullText = await importFile(page, backup.to, 'Content and my progress');
  ok(fullText.includes('Backup restored: content and progress'), 'content and progress: the screen says so: ' + fullText);
  const full = await saved(page);
  ok(JSON.stringify(full.words) === JSON.stringify(course) && full.score === 120 && full.drizzle === 4, 'content and progress: the 6 words (no Kettle) and 120 points: ' + full.words.join(', '));
  await page.screenshot({ path: `${SP}/shot-importexport.png`, fullPage: true });

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  ok(JSON.stringify(await saved(page)) === JSON.stringify(full), 'the same after a reload');
  ok(errors.length === 0, 'no page errors ' + errors.join(' / '));
  await browser.close();
});
