/**
 * Background Service Worker
 * Handles: tab management, API calls to admin backend
 */

// ================================================================
// Multi-site Config — extension เดียว รองรับ 2 เว็บ
// ================================================================

const SITES = {
  yoyocomputer: {
    adminUrl: 'https://api.yoyocomputer.com',
    adminKey: '1b31ea9fc29fb79db5fcfb1acfeab36cfb1a0a1ce60e212715d66478573c8cd8',
    name: 'YoYo Computer',
    emoji: '💻',
  },
  junservice: {
    adminUrl: 'http://5.78.74.134:8014',
    adminKey: 'CHANGE_ME',   // ← ใส่ ADMIN_API_KEY จาก .env ของ beag14
    name: 'จันทร์เซอร์วิส',
    emoji: '🔧',
  },
}

// Lazada API config (ใช้ร่วมกันทั้ง 2 site)
const CONFIG = {
  lazada: {
    apiUrl: 'https://api.lazada.co.th/rest',
    appKey: '105827',
    appSecret: 'r8ZMKhPxu1JZUCwTUBVMJiJnZKjhWeQF',
    userToken: '2f9d4c43d4ee4603ac291d4f3a17240e',
  },
}

// ── Power Tool keyword detection ──────────────────────────────────────
// ถ้า name/category ตรงกับ keyword เหล่านี้ → route to junservice
const POWER_TOOL_KEYWORDS = [
  // ภาษาไทย
  'ตู้เชื่อม', 'เชื่อม', 'สว่าน', 'หินเจียร', 'ลูกหมู', 'เครื่องสกัด',
  'สกัดปูน', 'สกัดไฟฟ้า', 'แย๊กปูน', 'วายจี้', 'วายจี้ปูน',
  'ปั๊มจุ่ม', 'เครื่องฉีดน้ำ', 'ฉีดน้ำแรงดัน',
  'เครื่องดัดเหล็ก', 'ดัดเหล็ก', 'เลื่อยวงเดือน', 'เลื่อยจิ๊กซอ',
  'เครื่องตัดไฟเบอร์', 'ตัดไฟเบอร์', 'พันมอเตอร์', 'พันทุ่น',
  'เครื่องมือช่าง', 'เครื่องมือไฟฟ้า', 'เครื่องมือก่อสร้าง',
  'ทุ่นไฟฟ้า', 'แปรงถ่าน', 'ตลับลูกปืน',
  // English
  'welding', 'welder', 'tig welder', 'mig welder', 'arc welder',
  'power drill', 'rotary drill', 'hammer drill', 'impact driver',
  'angle grinder', 'bench grinder', 'die grinder',
  'demolition hammer', 'breaker', 'jackhammer',
  'concrete mixer', 'cement mixer',
  'submersible pump', 'water pump',
  'pressure washer', 'power washer',
  'rebar bender', 'iron bender',
  'circular saw', 'jigsaw', 'reciprocating saw',
  'fiber cutter', 'cut-off machine',
  'motor winding', 'concrete vibrator',
  'power tool', 'electric tool', 'construction tool',
  // Brands (power tools only — not computer brands)
  'rilon', 'welpro', 'jasic', 'weldpro', 'lincoln electric',
  'makita', 'bosch', 'hitachi', 'dewalt', 'milwaukee',
  'maktec', 'ingco', 'kenbull',
]

/**
 * ตรวจสอบว่า product เป็น power tool ไหม → route to junservice
 * @param {object} productData - {name, category, categoryBreadcrumbs}
 * @returns {'junservice'|'yoyocomputer'}
 */
function detectSite(productData) {
  const text = [
    productData.name || '',
    productData.category || '',
    ...(productData.categoryBreadcrumbs || []),
  ].join(' ').toLowerCase()

  const isPowerTool = POWER_TOOL_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))
  return isPowerTool ? 'junservice' : 'yoyocomputer'
}

function getSiteConfig(siteKey) {
  return SITES[siteKey] || SITES.yoyocomputer
}

// ================================================================
// Lazada Affiliate API — Direct from extension (ใช้ IP ของเราเอง)
// ================================================================

async function _lazadaSign(apiPath, params) {
  // Sort params alphabetically, concat key+value
  const str = apiPath + Object.keys(params).sort()
    .map(k => k + params[k])
    .join('')

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(CONFIG.lazada.appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const buf = await crypto.subtle.sign('HMAC', key, encoder.encode(str))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

async function _lazadaRequest(path, extraParams = {}) {
  const params = {
    app_key: CONFIG.lazada.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    userToken: CONFIG.lazada.userToken,
    ...extraParams,
  }
  params.sign = await _lazadaSign(path, params)

  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${CONFIG.lazada.apiUrl}${path}?${qs}`)
  if (!r.ok) throw new Error(`Lazada API HTTP ${r.status}`)
  const data = await r.json()

  const code = data.code
  if (code && String(code) !== '0' && code !== 'SUCCESS') {
    throw new Error(`Lazada API [${code}]: ${data.message || 'Unknown error'}`)
  }
  return data
}

/**
 * สร้าง affiliate tracking link จาก Lazada product URL
 * เรียกตรงจาก extension — ใช้ IP ของเรา ไม่ผ่าน server
 */
async function generateAffiliateLinkDirect(productUrl) {
  try {
    // Extract product_id จาก URL (-i12345)
    const m = productUrl.match(/-i(\d+)/)
    const productId = m ? m[1] : null

    let data
    if (productId) {
      // เร็วกว่า: ใช้ productId ตรงๆ
      data = await _lazadaRequest('/marketing/getlink', {
        inputType: 'productId',
        inputValue: productId,
      })
      const list = data?.data?.productBatchGetLinkInfoList || []
      const link = list[0]?.regularPromotionLink
      if (link) return link
    }

    // Fallback: ใช้ URL
    data = await _lazadaRequest('/marketing/getlink', {
      inputType: 'url',
      inputValue: productUrl,
    })
    const list = data?.data?.urlBatchGetLinkInfoList || []
    return list[0]?.regularPromotionLink || null

  } catch (e) {
    console.warn('generateAffiliateLinkDirect failed:', e.message)
    return null
  }
}

// Save product data to admin backend — auto-route to correct site
async function saveToAdmin(productData) {
  // ถ้า popup ส่ง targetSite มาให้ใช้เลย ถ้าไม่มีให้ auto-detect
  const siteKey = productData.targetSite || detectSite(productData)
  const site = getSiteConfig(siteKey)

  const body = {
    items: [{
      name: productData.name,
      current_price: productData.price ? parseFloat(productData.price) : undefined,
      original_price: productData.originalPrice ? parseFloat(productData.originalPrice) : undefined,
      discount: productData.discount ? parseInt(productData.discount) : undefined,
      affiliate_url: productData.affiliateUrl || undefined,
      shopee_url: productData.source === 'shopee' ? productData.url : undefined,
      lazada_url: productData.source === 'lazada' ? productData.url : undefined,
      image_url: productData.image || undefined,
      notes: productData.description || undefined,
      source: productData.source,
      category_breadcrumbs: productData.categoryBreadcrumbs
        ? JSON.stringify(productData.categoryBreadcrumbs) : undefined,
    }],
    group_name: productData.groupName || undefined,
    category: productData.category || undefined,
  }

  const response = await fetch(`${site.adminUrl}/api/admin/products/bulk-create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': site.adminKey,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`[${site.name}] API Error ${response.status}: ${err}`)
  }

  const result = await response.json()
  return { ...result, _site: siteKey, _siteName: site.name }
}

// ================================================================
// AUTO MATCH: Search Lazada + Save Affiliate URL
// ใช้ browser ของ user → มี session cookies → ไม่โดน CAPTCHA
// ================================================================

/**
 * ดึง unmatched products จาก admin backend ของ site ที่กำหนด
 * @param {'yoyocomputer'|'junservice'} siteKey
 */
async function fetchUnmatchedProducts(siteKey = 'yoyocomputer') {
  const site = getSiteConfig(siteKey)
  const r = await fetch(`${site.adminUrl}/api/admin/products?no_lazada=true&limit=200`, {
    headers: { 'X-Admin-Key': site.adminKey },
  })
  if (!r.ok) throw new Error(`[${site.name}] API ${r.status}`)
  const data = await r.json()
  return (data.items || data.products || []).filter(p => p.shopee_url && !p.lazada_url)
}

/**
 * เปิด Lazada search tab, รอโหลด, scrape results
 */
async function searchLazadaInBrowser(query) {
  const url = `https://www.lazada.co.th/catalog/?q=${encodeURIComponent(query)}`
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, async (tab) => {
      const tabId = tab.id

      // รอ tab โหลดเสร็จ
      function onUpdated(id, info) {
        if (id !== tabId || info.status !== 'complete') return
        chrome.tabs.onUpdated.removeListener(onUpdated)

        // รอสักครู่ให้ JS render แล้วค่อย scrape
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_SEARCH_RESULTS', query }, (resp) => {
            chrome.tabs.remove(tabId)
            resolve(resp?.products || [])
          })
        }, 2500)
      }
      chrome.tabs.onUpdated.addListener(onUpdated)

      // Safety timeout: ถ้า tab ไม่โหลดใน 30 วิ
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        chrome.tabs.remove(tabId, () => {})
        resolve([])
      }, 30000)
    })
  })
}

/**
 * Score product match — ชื่อใกล้เคียงมากแค่ไหน
 */
function scoreMatch(queryName, product) {
  const q = queryName.toLowerCase()
  const p = (product.name || '').toLowerCase()
  const tokens = q.split(/\s+/).filter(t => t.length > 2)
  const matches = tokens.filter(t => p.includes(t)).length
  let score = matches / Math.max(tokens.length, 1)

  // Boost official/mall stores
  if (product.is_official || product.is_mall) score += 0.3
  // Boost by rating
  if (product.rating >= 4.5) score += 0.1
  // Boost by reviews
  if (product.review_count > 100) score += 0.1

  return score
}

/**
 * สร้าง Lazada affiliate link — เรียกตรงจาก extension (IP เรา, ไม่ผ่าน server)
 */
async function generateAffiliateLink(productUrl) {
  return generateAffiliateLinkDirect(productUrl)
}

/**
 * อัพเดท Lazada URL สำหรับ product ใน admin
 * @param {string} productId
 * @param {string} lazadaUrl
 * @param {string|null} affiliateUrl
 * @param {'yoyocomputer'|'junservice'} siteKey
 */
async function updateProductLazada(productId, lazadaUrl, affiliateUrl, siteKey = 'yoyocomputer') {
  const site = getSiteConfig(siteKey)
  const r = await fetch(`${site.adminUrl}/api/admin/products/${productId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': site.adminKey,
    },
    body: JSON.stringify({
      lazada_url: affiliateUrl || lazadaUrl,
    }),
  })
  return r.ok
}

/**
 * Main auto-match runner
 * ส่ง progress updates กลับ popup ผ่าน chrome.runtime.sendMessage
 */
async function runAutoMatch(siteKey = 'yoyocomputer') {
  // Mark running
  await chrome.storage.local.set({ autoMatchRunning: true, autoMatchProgress: null, autoMatchSite: siteKey })

  try {
    const products = await fetchUnmatchedProducts(siteKey)
    const total = products.length
    let matched = 0
    let failed = 0

    // Notify popup: started
    chrome.runtime.sendMessage({
      type: 'AUTO_MATCH_PROGRESS',
      status: 'started',
      total,
      matched: 0,
      failed: 0,
      current: null,
    }).catch(() => {})

    for (let i = 0; i < products.length; i++) {
      // Check ว่า user กด Stop หรือยัง
      const state = await chrome.storage.local.get({ autoMatchRunning: true })
      if (!state.autoMatchRunning) break

      const product = products[i]
      const name = product.name || ''

      // Search Lazada ใน browser
      const searchQuery = name.length > 60 ? name.slice(0, 60) : name
      const results = await searchLazadaInBrowser(searchQuery)

      let bestMatch = null
      let bestScore = 0
      for (const r of results) {
        const s = scoreMatch(name, r)
        if (s > bestScore) { bestScore = s; bestMatch = r }
      }

      // เกณฑ์ขั้นต่ำ: match ต้องมีคะแนน >= 0.3 (คำตรงกันอย่างน้อย 30%)
      if (bestMatch && bestScore >= 0.3) {
        // สร้าง affiliate link
        const affiliateUrl = await generateAffiliateLink(bestMatch.url)
        const saved = await updateProductLazada(product.id, bestMatch.url, affiliateUrl, siteKey)
        if (saved) matched++
        else failed++
      } else {
        failed++
      }

      // Notify popup: progress
      chrome.runtime.sendMessage({
        type: 'AUTO_MATCH_PROGRESS',
        status: 'progress',
        total,
        matched,
        failed,
        current: { index: i + 1, name, found: !!(bestMatch && bestScore >= 0.3) },
      }).catch(() => {})

      // Rate limit: รอ 1 วิก่อนไปสินค้าถัดไป
      await new Promise(r => setTimeout(r, 1000))
    }

    // Done
    chrome.runtime.sendMessage({
      type: 'AUTO_MATCH_PROGRESS',
      status: 'done',
      total,
      matched,
      failed,
    }).catch(() => {})

  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'AUTO_MATCH_PROGRESS',
      status: 'error',
      error: err.message,
    }).catch(() => {})
  } finally {
    await chrome.storage.local.set({ autoMatchRunning: false })
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_TO_ADMIN') {
    saveToAdmin(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }))
    return true // async response
  }

  if (message.type === 'OPEN_AFFILIATE_PORTAL') {
    const url = message.source === 'lazada'
      ? 'https://adsense.lazada.co.th/index.htm#!/'
      : 'https://affiliate.shopee.co.th/offer/custom_link'

    chrome.tabs.create({ url, active: true }, (tab) => {
      // Store the product URL to auto-fill
      chrome.storage.local.set({
        pendingAffiliateUrl: message.productUrl,
        pendingTabId: tab.id,
        sourceTabId: sender.tab?.id,
      })
      sendResponse({ success: true, tabId: tab.id })
    })
    return true
  }

  if (message.type === 'START_AUTO_MATCH') {
    runAutoMatch(message.siteKey || 'yoyocomputer') // fire-and-forget
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'DETECT_SITE') {
    const siteKey = detectSite(message.productData || {})
    const site = getSiteConfig(siteKey)
    sendResponse({ siteKey, siteName: site.name, emoji: site.emoji })
    return true
  }

  if (message.type === 'STOP_AUTO_MATCH') {
    chrome.storage.local.set({ autoMatchRunning: false })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'AFFILIATE_LINK_READY') {
    // Affiliate link was generated, send it back
    chrome.storage.local.get(['sourceTabId'], (data) => {
      if (data.sourceTabId) {
        chrome.runtime.sendMessage({
          type: 'AFFILIATE_LINK_RESULT',
          affiliateUrl: message.affiliateUrl,
        })
      }
    })
    // Close the affiliate tab
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id)
    }
    sendResponse({ success: true })
    return true
  }
})
