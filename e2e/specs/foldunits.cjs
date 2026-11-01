// Folding views and the Unit filter in a real browser, at a desktop and a phone width (local mode, the local player
// is the admin), with made-up content (fixtures/units-content.json: words and rules in one unit, in two, with an
// empty list and with none).
// - Library tree and My views on Home: an arrow only on views with views inside; it folds with a click, Enter or
//   Space, keeps focus, opens nothing, and keeps the open view; a folded view still practises.
// - Add words / Add grammar rules in a view and the Library tab: the Unit list (options from the list shown), All
//   units, Without unit, a word in two units, with the search, and "Show all units" when nothing matches.
// - Admin Words and Grammar: the Unit filter in the address, with the other filters and the search, and the way out.
const path = require('node:path');
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'units-content.json');

const options = (page, sel) => page.$eval(sel, (s) => [...s.options].map((o) => o.textContent));
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const query = (page) => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));

async function scenario(browser, { width, height, tag }) {
  const page = await (await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.click('text=Open Import & Export');
  await page.setInputFiles('#ie-file', FIXTURE); await page.waitForTimeout(1200);
  await page.click('.ie-apply'); await page.waitForTimeout(2000);

  // Gateway > A1.1 > Articles
  await page.goto(APP + '/library?new=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.fill('input[aria-label="New view name"]', 'Gateway'); await page.click('.lib-make button:has-text("Create")'); await page.waitForTimeout(500);
  const inside = async (name) => {
    await page.fill('.lib-panel input[aria-label="New view inside"]', name);
    await page.locator('.lib-panel form.lib-inline', { has: page.locator('input[aria-label="New view inside"]') }).locator('button').click();
    await page.waitForTimeout(500);
  };
  await inside('A1.1'); await inside('Articles');

  // Add words to Articles from the dictionary, by unit
  const addPicker = '.lib-panel .lib-picker';
  ok(JSON.stringify(await options(page, `${addPicker} select[aria-label="Unit"]`)) === JSON.stringify(['All units', 'Without unit', 'Unit 1', 'Unit 2', 'Unit 10']), `${tag}: Add words (dictionary): every unit once, natural order`);
  await page.selectOption(`${addPicker} select[aria-label="Unit"]`, 'Unit 2'); await page.waitForTimeout(200);
  ok(JSON.stringify(await texts(page, `${addPicker} .lib-results li b`)) === JSON.stringify(['Luggage', 'Ticket', 'Recipe']), `${tag}: Unit 2 shows Luggage (in two units), Ticket and Recipe`);
  await page.fill(`${addPicker} input.lib-search`, 'zzz'); await page.waitForTimeout(200);
  ok((await page.innerText(addPicker)).includes('No words match in “Unit 2”.'), `${tag}: nothing left: says so`);
  await page.$eval(`${addPicker} .lib-link`, (b) => b.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SP}/foldunits-${tag}-add-empty.png` });
  await page.fill(`${addPicker} input.lib-search`, ''); await page.waitForTimeout(200);
  await page.click(`${addPicker} button:has-text("Select all shown")`);
  await page.click('.lib-panel .lib-actionbar button:has-text("selected")'); await page.waitForTimeout(700);
  await page.selectOption(`${addPicker} select[aria-label="Unit"]`, '__none__'); await page.waitForTimeout(200);
  ok(JSON.stringify(await texts(page, `${addPicker} .lib-results li b`)) === JSON.stringify(['Delay', 'Journey']), `${tag}: Without unit: an empty list and no field`);
  await page.click(`${addPicker} button:has-text("Select all shown")`);
  await page.click('.lib-panel .lib-actionbar button:has-text("selected")'); await page.waitForTimeout(700);
  await page.click('.lib-add-rules summary'); await page.waitForTimeout(300);
  await page.selectOption('.lib-add-rules select[aria-label="Unit"]', 'Unit 1'); await page.waitForTimeout(200);
  ok(JSON.stringify(await texts(page, '.lib-add-rules .lib-results li b')) === JSON.stringify(['Use the past simple for finished actions']), `${tag}: Add grammar rules: Unit 1`);
  await page.click('.lib-add-rules button:has-text("Select all shown")');
  await page.click('.lib-add-rules .lib-actionbar button:has-text("Add 1 rule")'); await page.waitForTimeout(700);

  // The tree: arrows only on Gateway and A1.1; Articles is open
  const row = (name) => page.locator('.lib-tree > li', { has: page.locator(`.lib-name b:text-is("${name}")`) });
  const names = () => texts(page, '.lib-tree > li .lib-name b');
  const arrows = await page.$$eval('.lib-tree .lib-fold', (b) => b.map((x) => x.getAttribute('aria-label')));
  ok(JSON.stringify(arrows) === JSON.stringify(['Hide the views inside Gateway', 'Hide the views inside A1.1']), `${tag}: library: arrows only on views with views inside (Articles has none)`);
  ok(await row('Articles').locator('.lib-panel').count() === 1, `${tag}: Articles is open`);
  await page.focus('.lib-tree button[aria-label="Hide the views inside A1.1"]');
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  ok(JSON.stringify(await names()) === JSON.stringify(['Gateway', 'A1.1']), `${tag}: Enter folds A1.1`);
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Show the views inside A1.1', `${tag}: the arrow keeps focus and says Show`);
  ok(await page.getAttribute('.lib-tree button[aria-label="Show the views inside A1.1"]', 'aria-expanded') === 'false', `${tag}: aria-expanded false`);
  ok(await row('A1.1').locator('.lib-name').getAttribute('aria-pressed') === 'false', `${tag}: folding did not open A1.1`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-tree-folded.png` });
  await page.keyboard.press('Space'); await page.waitForTimeout(200);
  ok((await names()).includes('Articles') && await row('Articles').locator('.lib-panel').count() === 1, `${tag}: Space unfolds; Articles is still the open view`);
  if (width < 500) {
    const box = await page.locator('.lib-tree .lib-fold').first().boundingBox();
    ok(box.width >= 32 && box.height >= 40, `${tag}: the arrow is at least 32 x 40 px on a phone (${box.width}x${box.height})`);
    ok(await page.$eval('.lib-tree .lib-name b', (b) => b.scrollWidth <= b.clientWidth), `${tag}: "Gateway" is not cut short next to the arrow`);
  }
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: library: no sideways scroll`);
  await page.click('.lib-tree button[aria-label="Hide the views inside Gateway"]'); await page.waitForTimeout(200);
  ok(JSON.stringify(await names()) === JSON.stringify(['Gateway']), `${tag}: folding Gateway hides two levels`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-tree-gateway-folded.png` });
  await page.click('.lib-tree button[aria-label="Show the views inside Gateway"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-tree-open.png`, fullPage: true });

  // Library tab: the Unit lists offer only what is in my library
  await page.click('[role="tab"]:has-text("Library")'); await page.waitForTimeout(400);
  const mine = '.lib-words > .lib-picker', rules = '.lib-rules .lib-picker';
  ok(JSON.stringify(await options(page, `${mine} select[aria-label="Unit"]`)) === JSON.stringify(['All units', 'Without unit', 'Unit 1', 'Unit 2']), `${tag}: Library tab words: only my words' units (no Unit 10)`);
  ok(JSON.stringify(await options(page, `${rules} select[aria-label="Unit"]`)) === JSON.stringify(['All units', 'Without unit', 'Unit 1', 'Unit 2']), `${tag}: Library tab rules: only my rule's units`);
  await page.selectOption(`${mine} select[aria-label="Unit"]`, 'Unit 1'); await page.waitForTimeout(200);
  ok(JSON.stringify(await texts(page, `${mine} .lib-results li b`)) === JSON.stringify(['Luggage']), `${tag}: Library tab: Unit 1 is Luggage`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-library-unit.png`, fullPage: true });
  await page.fill(`${mine} input.lib-search`, 'ticket'); await page.waitForTimeout(200);
  await page.click(`${mine} button:has-text("Show all units")`); await page.waitForTimeout(200);
  ok(JSON.stringify(await texts(page, `${mine} .lib-results li b`)) === JSON.stringify(['Ticket']) && await page.inputValue(`${mine} input.lib-search`) === 'ticket', `${tag}: Show all units keeps the search`);

  // Home: My views tab Gateway, heading A1.1 folds
  await page.goto(APP, { waitUntil: 'networkidle' }); await page.click('.wh-level-view-toggle button:has-text("Gateway")'); await page.waitForTimeout(800);
  const cards = () => texts(page, '.lib-readonly .wh-level-title');
  ok(JSON.stringify(await cards()) === JSON.stringify(['All of Gateway', 'All of A1.1', 'Articles']), `${tag}: Home: cards before folding`);
  await page.focus('.lib-readonly button[aria-label="Hide the views inside A1.1"]');
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  ok(JSON.stringify(await cards()) === JSON.stringify(['All of Gateway', 'All of A1.1']), `${tag}: Home: Enter folds A1.1, All of A1.1 stays`);
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Show the views inside A1.1', `${tag}: Home: the arrow keeps focus`);
  ok(new URL(page.url()).pathname === '/', `${tag}: Home: the arrow opens nothing`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: Home: no sideways scroll`);
  await page.evaluate(() => [...document.querySelectorAll('.lib-readonly h3')].find((h) => h.textContent.includes('A1.1')).scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SP}/foldunits-${tag}-home-folded.png` });

  // Admin Words and Grammar
  await page.goto(APP + '/admin/words', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok(JSON.stringify(await options(page, 'select[aria-label="Unit"]')) === JSON.stringify(['All units', 'Without unit', 'Unit 1', 'Unit 2', 'Unit 10']), `${tag}: admin words: unit options`);
  await page.selectOption('select[aria-label="Unit"]', 'Unit 2'); await page.waitForTimeout(300);
  const adminWords = () => texts(page, 'tbody .adm-word b');
  ok((await query(page)).unit === 'Unit 2' && JSON.stringify((await adminWords()).sort()) === JSON.stringify(['Luggage', 'Recipe', 'Ticket']), `${tag}: admin words: Unit 2 in the address and the rows`);
  await page.selectOption('select[aria-label="Category"]', 'Food'); await page.waitForTimeout(300);
  ok(JSON.stringify(await adminWords()) === JSON.stringify(['Recipe']), `${tag}: admin words: with the category`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-admin-words.png` });
  await page.fill('.adm-search input', 'zzz'); await page.waitForTimeout(300);
  ok((await page.innerText('.adm-empty')).includes('No rows match your search.'), `${tag}: admin words: empty, says why`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-admin-words-empty.png` });
  await page.click('.adm-empty button:has-text("Show all units")'); await page.waitForTimeout(300);
  const q = await query(page);
  ok(!q.unit && q.category === 'Food' && q.q === 'zzz', `${tag}: admin words: Show all units clears only the unit (${JSON.stringify(q)})`);
  await page.goto(APP + '/admin/words?unit=__none__', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok(JSON.stringify((await adminWords()).sort()) === JSON.stringify(['Delay', 'Journey']), `${tag}: admin words: Without unit from the address`);
  await page.goto(APP + '/admin/grammar?unit=Unit%201', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok(JSON.stringify(await texts(page, 'tbody .adm-word b')) === JSON.stringify(['Use the past simple for finished actions']), `${tag}: admin grammar: Unit 1 from the address`);
  await page.selectOption('select[aria-label="Unit"]', 'Unit 10'); await page.waitForTimeout(300);
  ok(JSON.stringify(await texts(page, 'tbody .adm-word b')) === JSON.stringify(['Countable nouns take many']), `${tag}: admin grammar: Unit 10`);
  await page.screenshot({ path: `${SP}/foldunits-${tag}-admin-grammar.png` });

  ok(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`);
  await page.context().close();
}

run(async () => {
  const browser = await launch();
  await scenario(browser, { width: 1280, height: 900, tag: 'desktop' });
  await scenario(browser, { width: 390, height: 844, tag: 'mobile' });
  await browser.close();
});
