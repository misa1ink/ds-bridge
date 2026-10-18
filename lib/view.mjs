/**
 * Live browser view over CDP.
 *
 * DeepSeek sends X-Frame-Options so the page cannot be iframed. Instead of
 * fighting that, this module mirrors the real tab: Page.startScreencast pushes
 * JPEG frames, and mouse/keyboard input is forwarded back into the page.
 * The user sees and drives an actual logged-in browser inside our web UI.
 */

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 820;

/**
 * Attaches to a tab and returns a controllable view.
 * Frames are delivered through onFrame as data URLs.
 */
export class BrowserView {
  constructor(cdp, { onFrame, onNav } = {}) {
    this.cdp = cdp;
    this.onFrame = onFrame || (() => {});
    this.onNav = onNav || (() => {});
    this.active = false;
    this.frameCount = 0;
    this.lastFrameAt = 0;
    this.viewport = { width: MAX_WIDTH, height: MAX_HEIGHT };
  }

  async start() {
    // A small screen keeps JPEG payloads light while staying readable.
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }).catch(() => {});

    await this.cdp.send('Page.enable').catch(() => {});
    await this.cdp.send('Runtime.enable').catch(() => {});

    this.cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      if (!this.active) return;
      this.frameCount++;
      this.lastFrameAt = Date.now();
      try {
        this.onFrame({
          dataUrl: `data:image/jpeg;base64,${data}`,
          width: metadata?.deviceWidth || this.viewport.width,
          height: metadata?.deviceHeight || this.viewport.height,
          scrollX: metadata?.scrollOffsetX || 0,
          scrollY: metadata?.scrollOffsetY || 0,
        });
      } finally {
        // Must ack or the stream stalls after the first frame.
        this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      }
    });

    this.cdp.on('Page.frameNavigated', ({ frame }) => {
      if (frame && !frame.parentId) this.onNav({ url: frame.url });
    });

    this.active = true;
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
    return this;
  }

  async stop() {
    this.active = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
  }

  /**
   * Single-shot capture. Used as a fallback when the screencast is idle so the
   * user still gets a fresh picture after a click.
   */
  async snapshot() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    return `data:image/jpeg;base64,${data}`;
  }

  async navigate(url) {
    await this.cdp.send('Page.navigate', { url });
  }

  /** Mouse events use CSS pixels relative to the viewport. */
  async mouse(type, x, y, { button = 'left', clickCount = 1 } = {}) {
    const nx = Math.round(x);
    const ny = Math.round(y);
    if (type === 'move') {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny, button: 'none' });
    } else if (type === 'down') {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nx, y: ny, button, clickCount });
    } else if (type === 'up') {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nx, y: ny, button, clickCount });
    }
  }

  async click(x, y, button = 'left') {
    await this.mouse('down', x, y, { button });
    await this.mouse('up', x, y, { button });
  }

  async scroll(x, y, deltaY) {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY,
    });
  }

  /**
   * Inserts text as a paste rather than synthesising key events: QR logins and
   * IME-heavy fields behave badly with per-character dispatch, and pasting also
   * survives unicode that has no key code.
   */
  async type(text) {
    await this.cdp.send('Input.insertText', { text: String(text) });
  }

  /** Sends a named key like Enter, Tab, Backspace. */
  async key(keyName) {
    const map = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    };
    const def = map[keyName];
    if (!def) throw new Error('unsupported key: ' + keyName);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...def });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...def });
  }

  async status() {
    const url = await this.cdp.eval('location.href').catch(() => '');
    const title = await this.cdp.eval('document.title').catch(() => '');
    return {
      active: this.active,
      url,
      title,
      frames: this.frameCount,
      lastFrameAt: this.lastFrameAt,
      viewport: this.viewport,
    };
  }
}
