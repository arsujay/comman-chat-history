/**
 * Capture README screenshots using Electron + Playwright.
 * Prerequisites: npm run vite:build
 * Env: CHAT_HISTORY_VIEWER_USE_DIST=1 (set below) loads dist/ instead of Vite dev server.
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const electronExe = require('electron');
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');

async function main() {
  const distIndex = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    console.error('Missing dist/index.html. Run: npm run vite:build');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const app = await electron.launch({
    executablePath: electronExe,
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      CHAT_HISTORY_VIEWER_USE_DIST: '1',
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('load');
  await win.waitForTimeout(2800);

  await win.screenshot({
    path: path.join(outDir, '01-main-empty-state.png'),
    fullPage: false,
  });

  await win.locator('#btn-dashboard').click();
  await win.waitForTimeout(2000);

  await win.screenshot({
    path: path.join(outDir, '02-usage-dashboard.png'),
    fullPage: false,
  });

  await win.locator('#btn-dashboard').click();
  await win.waitForTimeout(400);

  const codexTab = win.locator('.filter-tab[data-filter="codex"]');
  if (await codexTab.count()) {
    await codexTab.click();
    await win.waitForTimeout(500);
  }

  await win.screenshot({
    path: path.join(outDir, '03-sidebar-filters.png'),
    fullPage: false,
  });

  const folderHeader = win.locator('.session-folder-header').first();
  if (await folderHeader.count()) {
    await folderHeader.click();
    await win.waitForTimeout(600);
  }
  const firstCard = win.locator('.session-card').first();
  if (await firstCard.count()) {
    await firstCard.click({ force: true });
    await win.waitForTimeout(2200);
    await win.screenshot({
      path: path.join(outDir, '04-conversation-view.png'),
      fullPage: false,
    });
  }

  await app.close();
  console.log('Wrote PNGs to', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
