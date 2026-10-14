// Opens the built app, reports runtime errors, and dumps the visible text.
const { APP, ok, launch, run, SP } = require('../helpers.cjs');
run(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SP}/smoke.png`, fullPage: false });
  ok(errors.length === 0, 'the app opens with no runtime errors ' + errors.join(' | '));
  ok((await page.innerText('body')).includes('WORD'), 'the home screen shows');
  await browser.close();
});
