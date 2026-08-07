const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('http://localhost:3000');
  
  await new Promise(r => setTimeout(r, 1000));
  
  const toggleBtn = await page.$('#tools-toggle');
  if (toggleBtn) {
    console.log('Found toggle button, clicking...');
    await toggleBtn.click();
    
    await new Promise(r => setTimeout(r, 500));
    
    const display = await page.evaluate(() => {
      const el = document.querySelector('.example-prompts');
      if (!el) return 'NOT FOUND';
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        width: style.width,
        height: style.height,
        top: style.top,
        bottom: style.bottom,
        classes: Array.from(el.classList)
      };
    });
    console.log('Popup styles after click:', display);
  } else {
    console.log('Toggle button not found.');
  }
  
  await browser.close();
})();
