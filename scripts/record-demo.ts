/**
 * Automated demo recording for harness-studio.
 *
 * Prerequisites:
 *   - Dev server running at localhost:3000  (`npm run dev`)
 *   - Playwright + Chromium installed        (`npx playwright install chromium`)
 *
 * Run:
 *   npx tsx scripts/record-demo.ts
 *
 * Output:
 *   demo-output/harness-studio-demo.webm
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = 'http://localhost:3000';
const PROJECT_PATH = (process.env.HOME ?? '') + '/Claude/code-dojo';
const OUTPUT_DIR = path.resolve(import.meta.dirname ?? __dirname, '..', 'demo-output');
const TYPING_DELAY = 70; // ms per character

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  try {
    // ──────────────────────────────────────────────
    // Scene 1: Welcome page (3s)
    // ──────────────────────────────────────────────
    console.log('[Scene 1] Welcome page');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await sleep(2000);

    // ──────────────────────────────────────────────
    // Scene 2: Open project via localStorage (5s)
    // ──────────────────────────────────────────────
    console.log('[Scene 2] Open project');

    // Set localStorage keys so the frontend auto-restores the project on load
    await page.evaluate((projectPath: string) => {
      // Active project ID
      localStorage.setItem('harness-studio:activeProjectId', projectPath);

      // Recent projects list (ensures sidebar Recent section has data)
      const projectName = projectPath.split('/').pop() ?? 'project';
      const recent = JSON.stringify([
        { path: projectPath, name: projectName, openedAt: Date.now() },
      ]);
      localStorage.setItem('harness-studio:recentProjects', recent);
    }, PROJECT_PATH);

    // Reload — frontend reads localStorage and auto-opens the project
    await page.reload({ waitUntil: 'networkidle' });

    // Wait for sidebar to populate
    await page.waitForSelector('text=Agents', { timeout: 10_000 }).catch(() => {
      console.log('  Sidebar Agents section not found — continuing');
    });
    await sleep(2000);

    // ──────────────────────────────────────────────
    // Scene 3: Browse agents (8s)
    // ──────────────────────────────────────────────
    console.log('[Scene 3] Browse agents');

    // Click agent items in the sidebar (they end with .md but are not CLAUDE.md)
    const agentItems = page.locator('button').filter({ hasText: /^(?!.*CLAUDE\.md)(?!.*workflow).*\.md$/i });
    const agentCount = await agentItems.count();
    const browsableCount = Math.min(agentCount, 3);

    for (let i = 0; i < browsableCount; i++) {
      const btn = agentItems.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await sleep(1500);
      }
    }

    if (browsableCount === 0) {
      console.log('  No agent buttons found — skipping browse');
      await sleep(2000);
    }

    // ──────────────────────────────────────────────
    // Scene 4: AI Generate workflow (20s) — highlight
    // ──────────────────────────────────────────────
    console.log('[Scene 4] Generate workflow');

    // Click "New" under Workflows section
    const newBtns = page.locator('button').filter({ hasText: /^\s*New\s*$/ });
    const newBtnCount = await newBtns.count();
    if (newBtnCount > 0) {
      // Pick the last "New" (more likely to be the Workflows section one)
      await newBtns.last().click();
      await sleep(600);
    }

    // Click "Blank" in the template dropdown
    const blankBtn = page.locator('button:has-text("Blank")');
    if (await blankBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await blankBtn.first().click();
      await sleep(2000);
    }

    // Wait for canvas nodes to appear
    await page.waitForSelector('.react-flow__node', { timeout: 8000 }).catch(() => {
      console.log('  Canvas nodes not found — continuing');
    });
    await sleep(1000);

    // Type workflow name
    const nameInput = page.locator('input[placeholder="Workflow name"]');
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.click();
      await nameInput.type('code-review-pipeline', { delay: TYPING_DELAY });
      await sleep(500);
    }

    // Click "Generate" button in toolbar to open the modal
    const toolbarGenerate = page.locator('button:has-text("Generate")').first();
    if (await toolbarGenerate.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toolbarGenerate.click();
      await sleep(800);
    }

    // Type description in the Generate modal textarea
    const textarea = page.locator('textarea');
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await textarea.type(
        'Code review pipeline with security audit and TDD',
        { delay: TYPING_DELAY },
      );
      await sleep(1000);

      // Click the "Generate" button inside the modal (last one on page)
      const modalGenBtn = page.locator('button:has-text("Generate")').last();
      await modalGenBtn.click();

      // Wait for generation to complete (more than 2 nodes = generated)
      console.log('  Waiting for workflow generation...');
      await page.waitForFunction(
        () => document.querySelectorAll('.react-flow__node').length > 2,
        { timeout: 45_000 },
      ).catch(() => {
        console.log('  Generation timed out — continuing with current state');
      });
    } else {
      console.log('  Generate modal textarea not found — skipping AI generation');
    }

    await sleep(3000);

    // ──────────────────────────────────────────────
    // Scene 5: Visual editing (8s)
    // ──────────────────────────────────────────────
    console.log('[Scene 5] Visual editing');

    const dagNodes = page.locator('.react-flow__node');
    const nodeCount = await dagNodes.count();
    if (nodeCount > 2) {
      // Click the 3rd node (index 2), skipping user and team-lead
      await dagNodes.nth(2).click();
      await sleep(2000);
    }

    // Wait for Node Editor panel
    await page.waitForSelector('text=Node Editor', { timeout: 3000 }).catch(() => {});
    await sleep(2000);

    // ──────────────────────────────────────────────
    // Scene 6: Save & CLAUDE.md sync (5s)
    // ──────────────────────────────────────────────
    console.log('[Scene 6] Save');

    const saveBtn = page.locator('button:has-text("Save")');
    const saveEnabled = await saveBtn.isEnabled({ timeout: 2000 }).catch(() => false);
    if (saveEnabled) {
      await saveBtn.click();
      await sleep(2000);
    }
    await sleep(1000);

    // ──────────────────────────────────────────────
    // Scene 7: Ending (2s)
    // ──────────────────────────────────────────────
    console.log('[Scene 7] Ending');
    await page.mouse.click(960, 540);
    await sleep(2000);

    console.log('Recording complete!');
  } catch (err) {
    console.error('Recording error:', err);
  } finally {
    // Close page + context to finalize video
    await page.close();
    await context.close();
    await browser.close();
  }

  // Rename the output video to a predictable name
  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.webm'));
  if (files.length > 0) {
    const latest = files.sort().pop()!;
    const src = path.join(OUTPUT_DIR, latest);
    const dest = path.join(OUTPUT_DIR, 'harness-studio-demo.webm');
    if (src !== dest) {
      fs.renameSync(src, dest);
    }
    console.log(`Video saved to: ${dest}`);
    console.log('');
    console.log('To convert to MP4:');
    console.log(`  ffmpeg -i ${dest} -vcodec libx264 -crf 28 -preset slow ${path.join(OUTPUT_DIR, 'harness-studio-demo.mp4')}`);
  } else {
    console.log(`Video files in: ${OUTPUT_DIR}/`);
  }
}

main().catch(console.error);
