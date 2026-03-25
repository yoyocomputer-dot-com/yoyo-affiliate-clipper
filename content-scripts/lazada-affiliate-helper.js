/**
 * Lazada Affiliate Portal Helper
 * Runs on adsense.lazada.co.th
 * Flow: เปิดหน้า → กด "ตัวแปลงลิงก์" → วาง URL → กดยืนยัน → จับ affiliate link
 */

(async function() {
  const data = await chrome.storage.local.get(['pendingAffiliateUrl'])
  if (!data.pendingAffiliateUrl) return

  const productUrl = data.pendingAffiliateUrl
  console.log('[YoYo Clipper] Lazada Affiliate - Converting:', productUrl)

  // Wait for SPA to load
  await sleep(2500)

  // Step 1: Click "ตัวแปลงลิงก์" button in top nav
  const converterBtn = findByText('a, button, div[class*="link"], span', [
    'ตัวแปลงลิงก์', 'Link Converter', 'แปลงลิงก์'
  ])
  if (converterBtn) {
    converterBtn.click()
    console.log('[YoYo Clipper] Clicked "ตัวแปลงลิงก์"')
    await sleep(1500)
  } else {
    console.log('[YoYo Clipper] Could not find converter button, trying URL hash')
    // Try navigating directly to link converter
    if (!window.location.hash.includes('link')) {
      window.location.hash = '#!/link-converter'
      await sleep(2000)
    }
  }

  // Step 2: Wait for the modal input field
  const input = await waitForElement(
    'input[placeholder*="URL"], input[placeholder*="วาง"], input[placeholder*="url"], input[placeholder*="ลิงก์"]',
    10000
  )
  if (!input) {
    console.log('[YoYo Clipper] Could not find URL input field')
    showNotification('ไม่พบช่องกรอก URL — กรุณาเปิด modal ตัวแปลงลิงก์ เอง', false)
    return
  }
  await sleep(500)

  // Step 3: Fill the URL
  fillInput(input, productUrl)
  console.log('[YoYo Clipper] URL filled:', productUrl)
  await sleep(800)

  // Step 4: Click "ยืนยันการแปลงลิงก์"
  await sleep(500)
  const confirmBtn = findByText('button, div[class*="btn"], a[class*="btn"]', [
    'ยืนยันการแปลงลิงก์', 'ยืนยัน', 'Confirm', 'Convert'
  ])
  if (confirmBtn) {
    // Wait for button to become enabled
    let retries = 10
    while (retries > 0 && (confirmBtn.disabled || confirmBtn.classList.contains('disabled'))) {
      await sleep(300)
      retries--
    }
    confirmBtn.click()
    console.log('[YoYo Clipper] Clicked "ยืนยันการแปลงลิงก์"')
  } else {
    console.log('[YoYo Clipper] Could not find confirm button')
  }

  // Step 5: Watch for affiliate link in success modal
  observeForLazadaLink(productUrl)

  // Clean up pending URL
  chrome.storage.local.remove(['pendingAffiliateUrl'])
})()

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findByText(selector, keywords) {
  for (const el of document.querySelectorAll(selector)) {
    const text = (el.textContent || '').trim().toLowerCase()
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      return el
    }
  }
  return null
}

function fillInput(el, value) {
  // React/Vue compatible value setting
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.focus()
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector)
    if (el) { resolve(el); return }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(null) }, timeout)
  })
}

function observeForLazadaLink(originalUrl) {
  let found = false

  const check = () => {
    if (found) return

    // Look for the Lazada affiliate link pattern: https://c.lazada.co.th/t/c.XXXXX
    const allText = document.body.innerText || ''
    const linkMatch = allText.match(/(https?:\/\/c\.lazada\.co\.th\/t\/c\.[A-Za-z0-9]+)/)
    if (linkMatch) {
      found = true
      const url = linkMatch[1]
      console.log('[YoYo Clipper] Found Lazada affiliate link:', url)
      chrome.storage.local.set({ generatedAffiliateUrl: url })
      chrome.runtime.sendMessage({
        type: 'AFFILIATE_LINK_READY',
        affiliateUrl: url,
      })
      showNotification(url, true)
      return
    }

    // Also check all elements for the link
    for (const el of document.querySelectorAll('[class*="result"], [class*="link"], [class*="modal"], [class*="dialog"]')) {
      const text = el.textContent || ''
      const m = text.match(/(https?:\/\/c\.lazada\.co\.th\/t\/c\.[A-Za-z0-9]+)/)
      if (m) {
        found = true
        console.log('[YoYo Clipper] Found Lazada affiliate link:', m[1])
        chrome.storage.local.set({ generatedAffiliateUrl: m[1] })
        chrome.runtime.sendMessage({
          type: 'AFFILIATE_LINK_READY',
          affiliateUrl: m[1],
        })
        showNotification(m[1], true)
        return
      }
    }
  }

  // Poll + observe
  const interval = setInterval(check, 1000)
  setTimeout(() => clearInterval(interval), 30000)

  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  setTimeout(() => observer.disconnect(), 30000)
}

function showNotification(text, success) {
  const div = document.createElement('div')
  const bg = success ? '#ff6633' : '#dc3545'
  div.innerHTML = `
    <div style="position:fixed;top:20px;right:20px;z-index:999999;background:${bg};color:white;padding:16px 24px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:400px;">
      <div style="font-weight:bold;margin-bottom:8px;">${success ? '✅ Lazada Affiliate Link พร้อม!' : '⚠️ Lazada Affiliate'}</div>
      <div style="font-size:12px;word-break:break-all;opacity:0.9;margin-bottom:8px;">${text}</div>
      <div style="font-size:11px;opacity:0.8;">กลับไปที่หน้าสินค้า แล้วกดปุ่ม Extension เพื่อบันทึก</div>
    </div>
  `
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 10000)
}
