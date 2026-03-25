/**
 * Affiliate Portal Helper
 * Auto-fills product URL in Shopee Affiliate portal
 * and provides easy copy-back of generated link
 */

(async function() {
  // Check if we have a pending URL to convert
  const data = await chrome.storage.local.get(['pendingAffiliateUrl'])
  if (!data.pendingAffiliateUrl) return

  const productUrl = data.pendingAffiliateUrl
  console.log('[YoYo Clipper] Auto-filling URL:', productUrl)

  // Wait for SPA to render
  await waitForElement('textarea, input[type="text"]', 10000)
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Find the main URL textarea
  const textarea = document.querySelector('textarea')
  if (textarea) {
    fillInput(textarea, productUrl)
    console.log('[YoYo Clipper] URL filled in textarea')
  } else {
    // Try input fields
    const inputs = document.querySelectorAll('input[type="text"]')
    for (const input of inputs) {
      if (input.offsetParent !== null && !input.value) {
        fillInput(input, productUrl)
        console.log('[YoYo Clipper] URL filled in input')
        break
      }
    }
  }

  // Try to click the generate button
  await new Promise(resolve => setTimeout(resolve, 500))
  clickGenerateButton()

  // Watch for generated affiliate link
  observeForAffiliateLink(productUrl)

  // Clean up pending URL
  chrome.storage.local.remove(['pendingAffiliateUrl'])
})()

function fillInput(el, value) {
  // React-compatible value setting
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
}

function clickGenerateButton() {
  const buttons = document.querySelectorAll('button, [role="button"]')
  const keywords = ['generate', 'สร้าง', 'create', 'รับลิงก์', 'แปลง', 'convert', 'get link']

  for (const btn of buttons) {
    const text = (btn.textContent || '').toLowerCase().trim()
    if (keywords.some(k => text.includes(k))) {
      console.log('[YoYo Clipper] Clicking button:', text)
      btn.click()
      return true
    }
  }

  // Try submit-like buttons
  for (const btn of buttons) {
    const cls = (btn.className || '').toLowerCase()
    if (cls.includes('submit') || cls.includes('primary') || cls.includes('generate')) {
      console.log('[YoYo Clipper] Clicking button by class:', cls)
      btn.click()
      return true
    }
  }

  return false
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

function observeForAffiliateLink(originalUrl) {
  let found = false

  const check = () => {
    if (found) return

    // Check all inputs and textareas for affiliate links
    const elements = document.querySelectorAll('input, textarea, [class*="result"], [class*="link"], [class*="output"]')
    for (const el of elements) {
      const val = el.value || el.textContent || ''
      if (isAffiliateLink(val) && val !== originalUrl) {
        found = true
        const url = extractUrl(val)
        if (url) {
          console.log('[YoYo Clipper] Found affiliate link:', url)
          // Store it so popup can read it later
          chrome.storage.local.set({ generatedAffiliateUrl: url })
          // Also notify background
          chrome.runtime.sendMessage({
            type: 'AFFILIATE_LINK_READY',
            affiliateUrl: url,
          })
          showCopyNotification(url)
        }
        return
      }
    }
  }

  // Check periodically
  const interval = setInterval(check, 1000)
  setTimeout(() => clearInterval(interval), 30000) // stop after 30s

  // Also observe DOM changes
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  setTimeout(() => observer.disconnect(), 30000)
}

function isAffiliateLink(text) {
  return text.includes('shp.ee') ||
         text.includes('s.shopee') ||
         text.includes('affiliate') ||
         text.includes('s.lazada') ||
         text.includes('c.lazada.co.th')
}

function extractUrl(text) {
  const match = text.match(/(https?:\/\/[^\s<>"]+)/)
  return match ? match[1] : null
}

function showCopyNotification(url) {
  const div = document.createElement('div')
  div.innerHTML = `
    <div style="position:fixed;top:20px;right:20px;z-index:999999;background:#ff6633;color:white;padding:16px 24px;border-radius:12px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:400px;">
      <div style="font-weight:bold;margin-bottom:8px;">✅ Affiliate Link พร้อมแล้ว!</div>
      <div style="font-size:12px;word-break:break-all;opacity:0.9;margin-bottom:12px;">${url}</div>
      <div style="font-size:11px;opacity:0.8;">กลับไปเปิด Popup ที่หน้าสินค้า แล้วกด บันทึก</div>
    </div>
  `
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 10000)
}
