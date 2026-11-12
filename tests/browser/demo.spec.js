import {test, expect} from '@playwright/test';

async function start(page, prefix = '') {
  await page.goto(`${prefix}/sim/index.html?test`);
  await page.getByRole('button', {name: 'Start simulation'}).click();
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.softWalkerTest?.state?.time || 0)).toBeGreaterThan(.2);
}

test('real policy, keyboard, upper-body drag, reset and compliance controls', async ({page}, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.screenshot({path: `test-results/live-demo-${testInfo.project.name}.png`});
  const canvas = page.locator('canvas');
  await canvas.focus();
  await page.keyboard.down('w'); await page.keyboard.down('q');
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.command[0])).toBeCloseTo(.6);
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.command[2])).toBeCloseTo(.5);
  await page.keyboard.up('w'); await page.keyboard.up('q');
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.command)).toEqual([0,0,0]);
  // Reset before grabbing a known visible body.
  const episode = await page.evaluate(() => window.softWalkerTest.state.episode);
  await page.getByRole('button', {name: 'Reset', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.episode)).toBe(episode + 1);
  const point = await page.evaluate(() => window.softWalkerTest.grabPosition('torso_link'));
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 160, point.y - 80, {steps: 8});
  await expect.poll(() => page.evaluate(() => Math.hypot(...window.softWalkerTest.state.force.force))).toBeGreaterThan(15);
  expect(await page.evaluate(() => Math.hypot(...window.softWalkerTest.state.force.force))).toBeLessThanOrEqual(40.00001);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Math.hypot(...window.softWalkerTest.state.force.force))).toBe(0);
  await canvas.focus(); await page.keyboard.down('a');
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.command[1])).toBeCloseTo(.5);
  await page.locator('#alpha').focus();
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.command)).toEqual([0,0,0]);
  await page.keyboard.up('a');
  await page.locator('#alpha').fill('2'); await page.locator('#beta').fill('0.5');
  await page.getByRole('button', {name: 'Apply & Reset'}).click();
  await expect(page.locator('#applied')).toHaveText('Active: α 2.00 · β 0.50');
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
  const time = await page.evaluate(() => window.softWalkerTest.state.time);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.softWalkerTest.state.time)).toBe(time);
  expect(errors).toEqual([]);
});

test('unsupported WebAssembly shows an actionable error', async ({page}) => {
  await page.addInitScript(() => { window.WebAssembly = undefined; });
  await page.goto('/sim/index.html');
  await page.getByRole('button', {name: 'Start simulation'}).click();
  await expect(page.locator('#status')).toContainText('WebAssembly');
  await expect(page.getByRole('button', {name: 'Reload & retry'})).toBeVisible();
});

test('continuous 30-second run remains live, with finite state and no residual input', async ({page}, testInfo) => {
  test.setTimeout(120000);
  await start(page);
  const startTime = Date.now();
  await expect.poll(() => page.evaluate(() => window.softWalkerTest.state.time), {timeout: 90000}).toBeGreaterThan(30);
  const result = await page.evaluate(() => ({running: window.softWalkerTest.running,
    root: window.softWalkerTest.state.root, command: window.softWalkerTest.state.command,
    force: window.softWalkerTest.state.force.force, rate: document.getElementById('rate').textContent}));
  expect(result.running).toBeTruthy();
  expect(result.root.every(Number.isFinite)).toBeTruthy();
  expect(result.root[2]).toBeGreaterThan(.5);
  expect(result.command).toEqual([0,0,0]); expect(result.force).toEqual([0,0,0]);
  console.log(`${testInfo.project.name}: 30 s simulated, ${((Date.now()-startTime)/1000).toFixed(1)} s observed, ${result.rate}`);
});

test('unavailable WebGL shows an actionable error', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.goto('/sim/index.html');
  await page.getByRole('button', {name: 'Start simulation'}).click();
  await expect(page.locator('#status')).toContainText('WebGL');
});

test('subdirectory deployment and missing model failure', async ({page}) => {
  await start(page, '/soft-walker');
  await page.reload();
  await page.route('**/policy_ampdual.onnx', route => route.fulfill({status: 404, body: 'missing'}));
  await page.getByRole('button', {name: 'Start simulation'}).click();
  await expect(page.locator('#status')).toContainText('404');
  await expect(page.getByRole('button', {name: 'Reload & retry'})).toBeVisible();
});

test('page embedding pauses offscreen and original figures remain usable', async ({page}) => {
  await page.goto('/');
  await page.locator('#try').scrollIntoViewIfNeeded();
  const frame = page.frameLocator('#walker-demo');
  expect(await frame.locator('body').evaluate(el => el.scrollHeight <= window.innerHeight + 1)).toBeTruthy();
  await frame.getByRole('button', {name: 'Start simulation'}).click();
  await expect(frame.locator('#overlay')).toBeHidden();
  await expect(frame.getByRole('button', {name: 'Pause', exact: true})).toBeEnabled();
  await page.locator('#top').scrollIntoViewIfNeeded();
  await expect(frame.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
  await page.locator('[data-lightbox]').first().click();
  await expect(page.locator('#figure-dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Close expanded figure'}).click();
  await page.getByRole('tab', {name: 'Base following'}).click();
  await expect(page.locator('#panel-base')).toBeVisible();
});
