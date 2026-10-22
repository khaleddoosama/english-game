// Synthetic, isolated local-mode content; no production service or user data.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const content = {
  words: Array.from({ length: 65 }, (_, i) => ({ word: `Sample${String(i).padStart(2, '0')}`, type: 'vocab', category: i % 2 ? 'Other' : 'Travel', meaning: `Synthetic example ${i}`, partsOfSpeech: ['noun'], ...(i === 1 ? {} : { units: i === 2 ? [] : ['Unit 2', 'Unit 10'] }) })),
  grammar: [
    { id: 'g1', rule: 'Past habits', category: 'Travel', units: ['Unit 2', 'Unit 10'] },
    { id: 'g2', rule: 'Present habits', category: 'Travel', units: [] },
    { id: 'g3', rule: 'Future plans', category: 'Other' },
  ].map((g) => ({ ...g, explanation: 'Synthetic grammar example.', questions: [{ type: 'choose', prompt: 'I ______ swim.', options: ['can', 'able'], answer: 'can' }] })),
  challenges: [], stories: [], combos: [], levelOrder: ['Travel', 'Other'], note: 'Synthetic units and folding checks',
};
run(async () => {
  const browser = await launch();
  for (const [size, width] of [['desktop', 1280], ['mobile', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.evaluate(async (data) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('word-hunter', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = reject;
        open.onsuccess = () => { const tx = open.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(data, 'local:content'); tx.oncomplete = resolve; tx.onerror = reject; };
      });
      const entries = Object.fromEntries(data.words.slice(0, 64).map((w) => [w.word, { at: 1 }]));
      const rules = Object.fromEntries(data.grammar.map((g) => [g.id, { at: 1 }]));
      const player = JSON.parse(sessionStorage.getItem('wh-live-player'));
      localStorage.setItem(`library1:${player.id}`,  JSON.stringify({ seq: 3, entries, rules, views: [
        { id: 'root', parent: null, name: 'Travel', path: 'Travel', position: 0, senses: entries, rules },
        { id: 'branch', parent: 'root', name: 'Transport', path: 'Travel::Transport', position: 0, senses: {}, rules: {} },
        { id: 'leaf', parent: 'branch', name: 'Airport', path: 'Travel::Transport::Airport', position: 0, senses: {}, rules: {} },
      ] }));
    }, content);
    for (const kind of ['words', 'grammar']) {
      await page.goto(`${APP}/admin/${kind}?page=2`, { waitUntil: 'networkidle' });
      await page.getByRole('combobox', { name: 'Units', exact: true }).selectOption('unit:Unit 2');
      ok(!new URL(page.url()).searchParams.has('page'), `${size} ${kind}: unit resets pagination`);
      await page.reload({ waitUntil: 'networkidle' });
      ok(await page.getByRole('combobox', { name: 'Units', exact: true }).inputValue() === 'unit:Unit 2', `${size} ${kind}: URL restores unit`);
      await page.getByRole('combobox', { name: kind === 'words' ? 'Category' : 'Lesson', exact: true }).selectOption('Travel');
      await page.locator('.adm-search input').fill(kind === 'words' ? 'Sample00' : 'Past');
      ok(await page.locator('tbody .adm-word').count() === 1, `${size} ${kind}: unit combines with search and category`);
      await page.screenshot({ path: `${SP}/units-${kind}-${size}.png`, fullPage: true });
      await page.getByRole('combobox', { name: 'Units', exact: true }).selectOption('none');
      ok(await page.locator('tbody .adm-word').count() === 0, `${size} ${kind}: no matches shown`);
      await page.getByRole('button', { name: 'Clear units filter', exact: true }).click();
      ok(await page.locator('tbody .adm-word').count() === 1, `${size} ${kind}: clear recovers results`);
      await page.locator('.adm-search input').fill('');
      await page.getByRole('combobox', { name: kind === 'words' ? 'Category' : 'Lesson', exact: true }).selectOption('');
      await page.getByRole('combobox', { name: 'Units', exact: true }).selectOption('none');
      ok(await page.locator('tbody .adm-word').count() === 2, `${size} ${kind}: absent and empty units`);
    }
    await page.goto(`${APP}/library?view=root`, { waitUntil: 'networkidle' });
    await page.getByRole('combobox', { name: 'Word units', exact: true }).selectOption('none');
    await page.getByRole('combobox', { name: 'Grammar units', exact: true }).selectOption('unit:Unit 10');
    ok(await page.locator('.lib-chips li:not(.rule)').count() === 2 && await page.locator('.lib-chips li.rule').count() === 1, `${size}: independent view word/grammar filters`);
    await page.screenshot({ path: `${SP}/units-view-${size}.png`, fullPage: true });
    await page.getByRole('tab', { name: /^Library/ }).click();
    const pickers = page.locator('.lib-words .lib-picker');
    await pickers.first().getByRole('combobox', { name: 'Units', exact: true }).selectOption('none');
    await pickers.nth(1).getByRole('combobox', { name: 'Units', exact: true }).selectOption('none');
    ok(await pickers.first().locator('.lib-results li').count() === 2 && await pickers.nth(1).locator('.lib-results li').count() === 2, `${size}: library words and rules without unit`);
    await pickers.first().getByRole('combobox', { name: 'Units', exact: true }).selectOption('unit:Unit 2');
    await pickers.first().locator('input[aria-label="Search your library"]').fill('Sample00');
    ok(await pickers.first().locator('.lib-results li').count() === 1, `${size}: library unit combines with search`);
    await page.screenshot({ path: `${SP}/units-library-${size}.png`, fullPage: true });
    await page.getByRole('tab', { name: /^Views/ }).click();
    const arrow = (name) => page.getByRole('button', { name: new RegExp(`the views inside ${name}$`) });
    await arrow('Transport').focus(); await page.keyboard.press('Enter');
    ok(await arrow('Transport').getAttribute('aria-expanded') === 'false', `${size}: Enter folds branch`);
    await arrow('Travel').focus(); await page.keyboard.press('Space');
    ok(await page.locator('.lib-tree > li:visible').count() === 1 && await page.locator('.lib-panel').isVisible(), `${size}: Space folds root without closing its selected panel`);
    await arrow('Travel').click();
    ok(await arrow('Transport').getAttribute('aria-expanded') === 'false', `${size}: nested folding retained`);
    await arrow('Transport').click();
    ok(await page.locator('.lib-tree > li:visible').count() === 3, `${size}: tree expanded`);
    ok(await page.locator('.lib-tree > li').last().locator('.lib-fold').count() === 0, `${size}: leaf has no arrow`);
    await page.waitForTimeout(200); // let the arrow rotation settle for the screenshot
    await page.screenshot({ path: `${SP}/fold-tree-${size}.png`, fullPage: true });
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.locator('.wh-level-view-toggle').getByRole('button', { name: 'Travel', exact: true }).click();
    await arrow('Transport').click(); await arrow('Travel').click(); await arrow('Travel').click();
    ok(await arrow('Transport').getAttribute('aria-expanded') === 'false', `${size}: Home root retains nested collapse`);
    await arrow('Transport').click();
    await page.waitForTimeout(200); // let the arrow rotation settle for the screenshot
    await page.screenshot({ path: `${SP}/fold-home-${size}.png`, fullPage: true });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size}: Home fits viewport`);
    ok(errors.length === 0, `${size}: no page errors ${errors.join('; ')}`);
    await context.close();
  }
});
