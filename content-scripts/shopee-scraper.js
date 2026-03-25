/**
 * Shopee Product Scraper
 * Extracts: name, price (sale+original+discount), images, description, category, URL
 */

function extractShopeePrices() {
  const result = { price: null, originalPrice: null, discount: null }

  // Find discount percentage from page
  const body = document.body?.innerText || ''
  const discountMatch = body.match(/-(\d+)%/)
  if (discountMatch) result.discount = parseInt(discountMatch[1])

  // Collect all ฿ prices from page text (allow optional space after ฿)
  const allBahtPrices = [...body.matchAll(/฿\s*([\d,]+(?:\.\d+)?)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(v => v > 0 && v < 10000000)

  // 1. Try __NEXT_DATA__
  try {
    const nextData = document.getElementById('__NEXT_DATA__')
    if (nextData) {
      const str = JSON.stringify(JSON.parse(nextData.textContent || '{}')?.props?.pageProps || {})

      // sale price
      const saleMatch = str.match(/"price":(\d+)/) || str.match(/"priceMin":(\d+)/)
      if (saleMatch) {
        let val = parseInt(saleMatch[1])
        if (val > 100000) val = val / 100000
        result.price = val
      }

      // original price — try many possible keys
      const origPatterns = [
        /"priceBeforeDiscount":(\d+)/,
        /"price_before_discount":(\d+)/,
        /"priceMinBeforeDiscount":(\d+)/,
        /"price_min_before_discount":(\d+)/,
        /"priceMaxBeforeDiscount":(\d+)/,
        /"originalPrice":(\d+)/,
        /"original_price":(\d+)/,
        /"priceOriginal":(\d+)/,
      ]
      for (const pattern of origPatterns) {
        const m = str.match(pattern)
        if (m) {
          let val = parseInt(m[1])
          if (val === 0 || val === -1) continue
          if (val > 100000) val = val / 100000
          if (val > (result.price || 0)) {
            result.originalPrice = val
            break
          }
        }
      }

      // discount from JSON
      const discMatch = str.match(/"discount"\s*:\s*"?(\d+)"?/)
      if (discMatch && !result.discount) result.discount = parseInt(discMatch[1])
    }
  } catch {}

  // 2. Try JSON-LD
  if (!result.price) {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent || '{}')
        if (d.offers?.price) { result.price = parseFloat(d.offers.price); break }
        if (d.offers?.lowPrice) { result.price = parseFloat(d.offers.lowPrice); break }
      } catch {}
    }
  }

  // 3. DOM-based original price (strikethrough elements)
  if (!result.originalPrice) {
    for (const el of document.querySelectorAll('del, s, [class*="before"], [class*="original"], [class*="deleted"]')) {
      const m = (el.textContent || '').match(/฿?\s*([\d,]+(?:\.\d+)?)/)
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''))
        if (v > 0 && v > (result.price || 0)) {
          result.originalPrice = v
          break
        }
      }
    }
  }

  // 4. Fallback: from ฿ amounts on page (for price)
  if (!result.price && allBahtPrices.length > 0) {
    result.price = Math.min(...allBahtPrices)
  }

  // 5. If we have price but no originalPrice, try from page ฿ amounts
  if (result.price && !result.originalPrice && allBahtPrices.length > 1) {
    // If we know the discount, calculate expected original and find closest match
    if (result.discount) {
      const expected = result.price / (1 - result.discount / 100)
      let bestMatch = null
      let bestDiff = Infinity
      for (const p of allBahtPrices) {
        if (p <= result.price) continue
        const diff = Math.abs(p - expected)
        if (diff < bestDiff) { bestDiff = diff; bestMatch = p }
      }
      // Accept if within 5% of expected
      if (bestMatch && bestDiff / expected < 0.05) {
        result.originalPrice = bestMatch
      }
    }

    // No discount to guide us — just take any price significantly higher
    if (!result.originalPrice) {
      const higher = allBahtPrices.filter(p => p > result.price * 1.2)
      if (higher.length > 0) result.originalPrice = Math.min(...higher)
    }
  }

  // 6. Last resort: calculate from price + discount
  if (result.price && result.discount && !result.originalPrice) {
    result.originalPrice = Math.round(result.price / (1 - result.discount / 100))
  }

  // Calculate discount if we have both prices but no discount
  if (result.price && result.originalPrice && !result.discount) {
    result.discount = Math.round((1 - result.price / result.originalPrice) * 100)
  }

  return result
}

/**
 * Smart category detection — NO hardcoded mapping
 * ใช้ข้อมูลจาก Shopee เอง (breadcrumbs + specs + JSON)
 * Priority: specs → JSON category → last specific breadcrumb
 */
function extractShopeeSpecs() {
  const specs = {}

  // 1. Key-value pairs from product detail section
  for (const el of document.querySelectorAll(
    '[class*="product-detail"] li, [class*="specification"] li, ' +
    '[class*="key-value"] li, [class*="product-info"] li, ' +
    '[class*="attribute"] li, [class*="product-attribute"] tr'
  )) {
    const text = (el.textContent || '').trim()
    const match = text.match(/^(.+?)\s*[:：]\s*(.+)$/)
    if (match) {
      specs[match[1].trim().toLowerCase()] = match[2].trim()
    } else if (el.children.length >= 2) {
      const key = (el.children[0].textContent || '').trim().toLowerCase()
      const val = (el.children[1].textContent || '').trim()
      if (key && val) specs[key] = val
    }
  }

  // 2. From __NEXT_DATA__ — embedded category info
  try {
    const nextData = document.getElementById('__NEXT_DATA__')
    if (nextData) {
      const str = nextData.textContent || ''
      if (str.length < 1000000) {
        const catMatch = str.match(/"category_name"\s*:\s*"([^"]+)"/)
          || str.match(/"catname"\s*:\s*"([^"]+)"/)
        if (catMatch && !specs._jsonCategory) specs._jsonCategory = catMatch[1]

        // Category path from Shopee's own data
        const pathMatch = str.match(/"cat_path"\s*:\s*"([^"]+)"/)
        if (pathMatch && !specs._jsonBreadcrumb) specs._jsonBreadcrumb = pathMatch[1]
      }
    }
  } catch {}

  // 3. Embedded script category
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent || ''
    if (t.length > 500000) continue
    const catMatch = t.match(/"categoryName"\s*:\s*"([^"]+)"/)
    if (catMatch && !specs._jsonCategory) specs._jsonCategory = catMatch[1]
  }

  return specs
}

/**
 * Smart category detection — NO hardcoded mapping
 * Priority: last breadcrumb (most specific) → JSON breadcrumb → specs → JSON category (fallback)
 * E-commerce breadcrumbs: ยิ่งอยู่ท้ายยิ่งเฉพาะเจาะจง เช่น อิเล็กทรอนิกส์ > เน็ตเวิร์ค > Sim Cards
 */
function detectCategory(breadcrumbs, specs) {
  // Navigation labels — NOT categories (skip these)
  const NAV_LABELS = ['home', 'lazada', 'shopee', 'หน้าแรก', 'หมวดหมู่']

  // 1. Last breadcrumb from page = most specific category
  if (breadcrumbs && breadcrumbs.length) {
    for (let i = breadcrumbs.length - 1; i >= 0; i--) {
      const crumb = breadcrumbs[i].trim()
      if (crumb && !NAV_LABELS.includes(crumb.toLowerCase())) {
        return crumb
      }
    }
  }

  // 2. JSON embedded breadcrumb — last segment
  if (specs._jsonBreadcrumb) {
    const parts = specs._jsonBreadcrumb.split(/[>\/]/).map(p => p.trim()).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!NAV_LABELS.includes(parts[i].toLowerCase())) {
        return parts[i]
      }
    }
  }

  // 3. Specs fields that contain product type
  const specCategoryFields = ['ประเภท', 'ชนิด', 'หมวดหมู่', 'type']
  for (const field of specCategoryFields) {
    const val = specs[field]
    if (val && val.length < 50) return val
  }

  // 4. JSON category — last resort (often too broad like "phone")
  if (specs._jsonCategory) return specs._jsonCategory

  return null
}

// Known Shopee navigation items — NOT breadcrumbs
const SHOPEE_NAV_ITEMS = new Set([
  'shopee', 'shopee home', 'หน้าแรก', 'เปิดร้านค้า', 'ดาวน์โหลด',
  'การแจ้งเตือน', 'ช่วยเหลือ', 'ติดตามคำสั่งซื้อ', 'สมัครสมาชิก',
  'เข้าสู่ระบบ', 'login', 'register', 'ตะกร้า', 'cart',
  'flash sale', 'shopee mall', 'ส่งฟรี',
])

function extractShopeeBreadcrumbs() {
  const breadcrumbs = []

  function isNavItem(text) {
    return SHOPEE_NAV_ITEMS.has(text.toLowerCase().trim())
  }

  // 1. Try JSON-LD BreadcrumbList (most reliable)
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || '{}')
      if (data['@type'] === 'BreadcrumbList' && data.itemListElement) {
        for (const item of data.itemListElement) {
          const name = (item.name || '').trim()
          if (name && !isNavItem(name)) breadcrumbs.push(name)
        }
        if (breadcrumbs.length > 0) return breadcrumbs
      }
    } catch {}
  }

  // 2. Try __NEXT_DATA__ categories
  try {
    const nextData = document.getElementById('__NEXT_DATA__')
    if (nextData) {
      const str = nextData.textContent || ''
      // Look for category path like "catid":... or "categories":[...]
      const catMatch = str.match(/"categories"\s*:\s*\[([^\]]+)\]/)
      if (catMatch) {
        const names = [...catMatch[1].matchAll(/"display_name"\s*:\s*"([^"]+)"/g)]
        for (const m of names) {
          const name = m[1].trim()
          if (name && !isNavItem(name)) breadcrumbs.push(name)
        }
        if (breadcrumbs.length > 0) return breadcrumbs
      }
    }
  } catch {}

  // 3. DOM breadcrumb elements (NOT nav a — too broad!)
  for (const el of document.querySelectorAll(
    '[class*="breadcrumb"] a, .page-product__breadcrumb a, [data-testid*="breadcrumb"] a'
  )) {
    const text = (el.textContent || '').trim()
    if (text && !isNavItem(text)) breadcrumbs.push(text)
  }
  if (breadcrumbs.length > 0) return breadcrumbs

  // 4. Product detail "หมวดหมู่" label
  for (const label of document.querySelectorAll(
    '[class*="product-detail"] label, [class*="detail"] .label, [class*="info"] label'
  )) {
    if ((label.textContent || '').includes('หมวดหมู่')) {
      const next = label.nextElementSibling || label.parentElement
      if (next) {
        for (const a of next.querySelectorAll('a')) {
          const text = (a.textContent || '').trim()
          if (text && !isNavItem(text)) breadcrumbs.push(text)
        }
      }
    }
  }

  return breadcrumbs
}

function extractShopeeImages() {
  const images = []
  const seen = new Set()

  function add(url) {
    if (!url || seen.has(url)) return
    if (url.startsWith('data:') || url.includes('avatar') || url.includes('logo')
        || url.includes('icon') || url.includes('flag') || url.includes('badge')) return
    const clean = url.split('?')[0]
    if (seen.has(clean)) return
    seen.add(url)
    seen.add(clean)
    images.push(url)
  }

  // === 1. From __NEXT_DATA__ — find product images (LONGEST "images" array) ===
  try {
    const nextData = document.getElementById('__NEXT_DATA__')
    if (nextData) {
      const str = nextData.textContent || ''
      if (str.length < 2000000) {
        // Find ALL "images" arrays — pick the LONGEST one (= product gallery, not reviews)
        // Product gallery has 4-10 images, review arrays typically have 1-3
        const allMatches = [...str.matchAll(/"images"\s*:\s*\[([^\]]{20,})\]/g)]
        let bestHashes = []

        for (const match of allMatches) {
          const hashes = [...match[1].matchAll(/"([a-z0-9][a-z0-9_-]{14,})"/gi)]
            .map(m => m[1])
            .filter(h => !h.includes('avatar') && !h.includes('logo'))
          if (hashes.length > bestHashes.length) {
            bestHashes = hashes
          }
        }

        for (const hash of bestHashes) {
          add(`https://down-th.img.susercontent.com/file/${hash}`)
        }
      }
    }
  } catch {}

  // === 2. OG image ===
  add(document.querySelector('meta[property="og:image"]')?.content)

  // === 3. JSON-LD images ===
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent || '{}')
      if (d.image) {
        const imgs = Array.isArray(d.image) ? d.image : [d.image]
        imgs.forEach(i => add(typeof i === 'string' ? i : i?.url))
      }
    } catch {}
  }

  // === 4. DOM: Gallery thumbnails (Shopee uses <picture> with 82x82 thumbs) ===
  if (images.length < 2) {
    // Method A: Shopee thumbnail images (82x82 in gallery)
    for (const img of document.querySelectorAll('picture img[width="82"]')) {
      let src = img.src || img.getAttribute('src') || ''
      if (src.includes('susercontent')) {
        // Strip resize suffix → full-size image
        src = src.replace(/@resize_\w+/g, '')
        add(src)
      }
    }

    // Method B: Main hero image
    const heroImg = document.querySelector('img.rWN4DK, .center img[src*="susercontent"]')
    if (heroImg) {
      let src = (heroImg.src || '').replace(/_tn$/, '')
      add(src)
    }

    // Method C: Any img with susercontent in the top product area (before reviews)
    if (images.length < 2) {
      const allImgs = document.querySelectorAll('img[src*="susercontent"]')
      for (const img of allImgs) {
        // Stop at review section — reviews are usually after first 20 susercontent images
        if (images.length >= 8) break
        const src = img.src || ''
        // Skip tiny icons, avatars, badges
        const w = img.width || img.naturalWidth || 0
        if (w > 0 && w < 50) continue
        if (src.includes('avatar') || src.includes('logo') || src.includes('icon')) continue
        if (src.includes('shopee-pcmall-live')) continue // UI icons
        add(src.replace(/@resize_\w+/g, ''))
      }
    }
  }

  return images.slice(0, 8)
}

function extractShopeeData() {
  const data = {
    name: '', price: null, originalPrice: null, discount: null,
    image: '', images: [], description: '',
    url: window.location.href.split('?')[0],  // strip tracking params
    source: 'shopee', category: null, categoryBreadcrumbs: [],
  }

  // Name: from og:title or document title
  data.name = (
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector('h1')?.textContent ||
    document.title
  ).trim()

  // Clean up name (remove " | Shopee Thailand" suffix)
  data.name = data.name.replace(/\s*\|\s*Shopee\s*Thailand/i, '').trim()

  // Prices (sale + original + discount)
  const prices = extractShopeePrices()
  data.price = prices.price
  data.originalPrice = prices.originalPrice
  data.discount = prices.discount

  // Images (gallery)
  data.images = extractShopeeImages()
  data.image = data.images[0] || (
    document.querySelector('meta[property="og:image"]')?.content ||
    document.querySelector('.product-image img')?.src ||
    ''
  )

  // Description
  data.description = (
    document.querySelector('meta[property="og:description"]')?.content ||
    ''
  ).trim()

  // Category from breadcrumbs + specs
  const breadcrumbs = extractShopeeBreadcrumbs()
  const specs = extractShopeeSpecs()
  data.categoryBreadcrumbs = breadcrumbs
  data.category = detectCategory(breadcrumbs, specs)

  return data
}

// Listen for requests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_PRODUCT_DATA') {
    const data = extractShopeeData()
    sendResponse(data)
  }
  return true
})
