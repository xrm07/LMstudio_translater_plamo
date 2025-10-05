import puppeteer, { Browser, Page, Target } from 'puppeteer';

export interface ExtensionContext {
  browser: Browser;
  extensionId: string;
  serviceWorker: any;
}

/**
 * Chrome拡張機能を読み込んでブラウザを起動
 * @param extensionPath 拡張機能のパス
 * @returns ブラウザ、拡張ID、サービスワーカー
 */
export async function launchWithExtension(extensionPath: string): Promise<ExtensionContext> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      // CI 安定化用フラグ
      '--no-sandbox',
      '--disable-gpu',
      // 開発モード用の追加フラグ
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ['--disable-extensions']
  });

  // MV3 Service Workerターゲットから拡張IDを抽出
  const serviceWorkerTarget = await waitForServiceWorkerTarget(browser);
  if (!serviceWorkerTarget) {
    throw new Error('Service Workerターゲットが見つかりません。拡張機能が正しく読み込まれているか確認してください。');
  }

  const extensionId = new URL(serviceWorkerTarget.url()).host;
  const serviceWorker = await serviceWorkerTarget.worker();
  if (!serviceWorker) {
    throw new Error('Service Workerの初期化に失敗しました。');
  }

  return {
    browser,
    extensionId,
    serviceWorker
  };
}

/**
 * Service Workerターゲットを見つける
 */
async function waitForServiceWorkerTarget(browser: Browser): Promise<Target | null> {
  try {
    const target = await browser.waitForTarget(
      candidate => candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
      { timeout: 30000 }
    );
    return target || null;
  } catch (error) {
    return null;
  }
}

/**
 * ページを作成し、拡張機能のポップアップページを開く
 */
export async function openPopupPage(context: ExtensionContext): Promise<Page> {
  const { browser, extensionId } = context;

  // 新しいページを作成
  const page = await browser.newPage();

  // ポップアップページを開く
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  await page.goto(popupUrl, { waitUntil: 'load' });

  return page;
}

/**
 * テスト用ページを作成（テキスト選択用）
 */
export async function createTestPage(browser: Browser, baseUrl: string, fixturePath = '/fixtures/index.html'): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}${fixturePath}`, { waitUntil: 'networkidle2' });
  return page;
}

/**
 * ページのスクリーンショットを保存
 */
export async function takeScreenshot(page: Page, filename: string): Promise<void> {
  const screenshotsDir = './test-results/screenshots';
  try {
    // テスト結果ディレクトリを作成（存在しない場合）
    const fs = require('fs').promises;
    await fs.mkdir(screenshotsDir, { recursive: true });

    const filepath = `${screenshotsDir}/${filename}.png`;
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`Screenshot saved: ${filepath}`);
  } catch (error) {
    console.warn(`Failed to save screenshot: ${error.message}`);
  }
}

/**
 * ブラウザをクリーンアップ
 */
export async function cleanupBrowser(context?: ExtensionContext): Promise<void> {
  if (context?.browser) {
    await context.browser.close();
  }
}
