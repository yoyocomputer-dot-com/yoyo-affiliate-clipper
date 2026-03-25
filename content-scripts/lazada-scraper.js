/**
 * Lazada Product Scraper
 * Extracts: name, price (sale+original+discount), images, description, category
 * Category = ใช้ข้อมูลจากหน้าสินค้าจริง (breadcrumbs + specs) ไม่ hardcode
 */

function extractBreadcrumbs() {
  const crumbs = []
  // JSON-LD BreadcrumbList
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent || '{}')
      if (d['@type'] === 'BreadcrumbList' && d.itemListElement) {
        for (const item of d.itemListElement) {
          const n = item.name || item.item?.name || ''
          if (n && n !== 'Home' && n !== 'Lazada') crumbs.push(n)
        }
        if (crumbs.length) return crumbs
      }
    } catch {}
  }
  // DOM breadcrumbs
  for (const el of document.querySelectorAll('[class*="breadcrumb"] a, .pdp-link--breadcrumb-item')) {
    const t = (el.textContent || '').trim()
    if (t && t !== 'Home' && t !== 'Lazada' && t !== 'หน้าแรก') crumbs.push(t)
  }
  return crumbs
}

function extractLazadaSpecs() {
  const specs = {}
  // Key-value pairs from product detail section
  for (const el of document.querySelectorAll(
    '.pdp-product-detail li, [class*="specification"] li, ' +
    '[class*="detail-content"] li, [class*="key-value"] li, ' +
    '[class*="product-detail"] tr, [class*="sku-prop"] li'
  )) {
    const text = (el.textContent || '').trim()
    // Try to parse "label: value" or "label value" patterns
    const match = text.match(/^(.+?)\s*[:：]\s*(.+)$/)
    if (match) {
      specs[match[1].trim().toLowerCase()] = match[2].trim()
    } else if (text) {
      // For elements with separate label/value children
      const children = el.children
      if (children.length >= 2) {
        const key = (children[0].textContent || '').trim().toLowerCase()
        const val = (children[1].textContent || '').trim()
        if (key && val) specs[key] = val
      }
    }
  }

  // Also check leaf text nodes in detail areas
  if (Object.keys(specs).length === 0) {
    const detailArea = document.querySelector(
      '[class*="pdp-product-detail"], [class*="product-detail"], ' +
      '[class*="specification"], [class*="detail-pane"]'
    )
    if (detailArea) {
      for (const el of detailArea.querySelectorAll('*')) {
        const text = (el.textContent || '').trim()
        if (text && el.children.length === 0 && text.length < 100 && text.length > 2) {
          const match = text.match(/^(.+?)\s*[:：]\s*(.+)$/)
          if (match) specs[match[1].trim().toLowerCase()] = match[2].trim()
        }
      }
    }
  }

  // Embedded JSON category
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent || ''
    if (t.length > 500000) continue
    const catMatch = t.match(/"categoryName"\s*:\s*"([^"]+)"/)
    if (catMatch && !specs._jsonCategory) specs._jsonCategory = catMatch[1]
    const bcMatch = t.match(/"breadcrumb"\s*:\s*"([^"]+)"/)
    if (bcMatch && !specs._jsonBreadcrumb) specs._jsonBreadcrumb = bcMatch[1]
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

function extractLazadaPrices() {
  const result = { price: null, originalPrice: null, discount: null }

  const body = document.body?.innerText || ''

  // Find discount percentage first (helps validate price pairs later)
  const discountMatch = body.match(/-(\d+)%/)
  if (discountMatch) result.discount = parseInt(discountMatch[1])

  // Collect all ฿ prices from visible text (ONLY ฿-prefixed = real prices)
  const allBahtPrices = [...body.matchAll(/฿\s*([\d,]+(?:\.\d+)?)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, '')))
    .filter(v => v > 0 && v < 10000000)

  // === Method 1: JSON-LD (only use offers.price, NOT lowPrice/highPrice) ===
  // Lazada JSON-LD lowPrice/highPrice = price range across ALL variants, not the displayed product price
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent || '{}')
      const offers = d.offers || d['@graph']?.find(i => i.offers)?.offers
      if (offers?.price) {
        result.price = parseFloat(offers.price)
        break
      }
      // DO NOT use lowPrice/highPrice — they represent variant price ranges, not actual product price
    } catch {}
  }

  // === Method 2: Meta tags ===
  if (!result.price) {
    try {
      const metaPrice = document.querySelector('meta[property="product:price:amount"]')
        || document.querySelector('meta[name="price"]')
        || document.querySelector('meta[itemprop="price"]')
      if (metaPrice) {
        const v = parseFloat(metaPrice.content)
        if (v > 0) result.price = v
      }
    } catch {}
  }

  // === Method 3: DOM price containers (reliable — reads visible price) ===
  if (!result.price) {
    // Try specific Lazada v2 selectors first (most precise)
    const saleAmountEl = document.querySelector(
      '.pdp-v2-product-price-content-salePrice-amount, ' +
      '[class*="salePrice-amount"]'
    )
    if (saleAmountEl) {
      const v = parseFloat((saleAmountEl.textContent || '').replace(/[^\d.]/g, ''))
      if (v > 0) result.price = v
    }

    const origAmountEl = document.querySelector(
      '.pdp-v2-product-price-content-originalPrice-amount, ' +
      '[class*="originalPrice-amount"]'
    )
    if (origAmountEl) {
      const v = parseFloat((origAmountEl.textContent || '').replace(/[^\d.]/g, ''))
      if (v > 0 && v > (result.price || 0)) result.originalPrice = v
    }

    const discountEl = document.querySelector(
      '.pdp-v2-product-price-content-originalPrice-discount, ' +
      '[class*="originalPrice-discount"]'
    )
    if (discountEl) {
      const dm = (discountEl.textContent || '').match(/-?(\d+(?:\.\d+)?)%/)
      if (dm) result.discount = parseFloat(dm[1])
    }
  }

  // Fallback: broader DOM price containers
  if (!result.price) {
    const containers = document.querySelectorAll(
      '[class*="pdp-product-price"], [class*="pdp-price"], ' +
      '[class*="product-price"], [class*="price-content"]'
    )
    for (const container of containers) {
      const text = container.textContent || ''
      const bahtNumbers = [...text.matchAll(/฿\s*([\d,]+\.?\d*)/g)]
        .map(m => parseFloat(m[1].replace(/,/g, '')))
        .filter(v => v > 0 && v < 10000000)

      if (bahtNumbers.length >= 2) {
        result.price = Math.min(...bahtNumbers)
        result.originalPrice = Math.max(...bahtNumbers)
        break
      } else if (bahtNumbers.length === 1) {
        result.price = bahtNumbers[0]
        break
      }
    }
  }

  // === Method 4: ฿ amounts from page text (last resort) ===
  if (!result.price && allBahtPrices.length > 0) {
    // Simple: take the first ฿ price that looks reasonable (skip very small amounts like shipping)
    const sorted = [...allBahtPrices].sort((a, b) => a - b)
    // Skip prices under ฿50 (likely shipping/voucher) unless it's the only one
    const reasonable = sorted.filter(p => p >= 50)
    if (reasonable.length > 0) {
      result.price = reasonable[0]
      if (reasonable.length >= 2) {
        const maxP = reasonable[reasonable.length - 1]
        if (maxP > result.price * 1.05) result.originalPrice = maxP
      }
    } else {
      result.price = sorted[0]
    }
  }

  // === Method 5: Embedded script JSON ===
  if (!result.price) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || ''
      if (t.length > 500000) continue
      const m = t.match(/"priceCurrency".*?"price"\s*:\s*"?([\d.]+)"?/)
        || t.match(/"salePrice"\s*:\s*"?([\d.]+)"?/)
        || t.match(/"price"\s*:\s*"?([\d.]+)"?/)
      if (m) { result.price = parseFloat(m[1]); break }
      if (!result.originalPrice) {
        const orig = t.match(/"originalPrice"\s*:\s*"?([\d.]+)"?/)
        if (orig) result.originalPrice = parseFloat(orig[1])
      }
    }
  }

  // === Method 6: Original price from strikethrough DOM elements ===
  if (result.price && !result.originalPrice) {
    for (const el of document.querySelectorAll(
      '.pdp-price .pdp-price_type_deleted, .pdp-price--original, ' +
      '[class*="origin-price"], [class*="price_type--deleted"], del, s'
    )) {
      const m = (el.textContent || '').match(/฿?\s*([\d,]+\.?\d*)/)
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''))
        if (v > 0 && v > result.price) { result.originalPrice = v; break }
      }
    }
  }

  // === Fallback: calculate originalPrice from price + discount ===
  if (result.price && result.discount && !result.originalPrice) {
    result.originalPrice = Math.round(result.price / (1 - result.discount / 100) * 100) / 100
  }

  // Calculate discount if missing
  if (result.price && result.originalPrice && !result.discount) {
    result.discount = Math.round((1 - result.price / result.originalPrice) * 100)
  }

  return result
}

function extractLazadaImages() {
  const images = []
  const seen = new Set()

  function add(url) {
    if (!url || seen.has(url)) return
    if (url.startsWith('data:') || url.includes('avatar') || url.includes('logo')) return
    const clean = url.split('?')[0]
    if (seen.has(clean)) return
    seen.add(url)
    seen.add(clean)
    images.push(url)
  }

  // 1. OG image
  add(document.querySelector('meta[property="og:image"]')?.content)

  // 2. Gallery/carousel thumbnails
  for (const img of document.querySelectorAll(
    '.pdp-mod-common-image img, ' +
    '[class*="gallery-preview"] img, ' +
    '[class*="item-gallery"] img, ' +
    '.pdp-block__image-gallery img, ' +
    '[class*="slick"] img, ' +
    '[class*="carousel"] img, ' +
    '[class*="gallery"] img'
  )) {
    add(img.src || img.dataset?.src || img.getAttribute('data-lazy-src'))
  }

  // 3. Large images within product area
  const productArea = document.querySelector(
    '[class*="pdp-block"], [class*="product-detail"], [class*="gallery-wrapper"], main'
  )
  if (productArea) {
    for (const img of productArea.querySelectorAll('img')) {
      const src = img.src || img.dataset?.src
      if (src && (img.naturalWidth > 100 || img.width > 100 || src.includes('lazada'))) {
        add(src)
      }
    }
  }

  // 4. From JSON-LD
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent || '{}')
      if (d.image) {
        const imgs = Array.isArray(d.image) ? d.image : [d.image]
        imgs.forEach(i => add(typeof i === 'string' ? i : i?.url))
      }
    } catch {}
  }

  return images.slice(0, 10)
}

function extractLazadaData() {
  const data = {
    name: '', price: null, originalPrice: null, discount: null,
    image: '', images: [], description: '',
    url: window.location.href.split('?')[0],
    source: 'lazada', category: null, categoryBreadcrumbs: [],
  }

  // Name
  data.name = (
    document.querySelector('h1.pdp-mod-product-badge-title')?.textContent ||
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector('h1')?.textContent ||
    document.title
  ).trim().replace(/\s*[-|]\s*Lazada\.co\.th/i, '').trim()

  // Prices
  const prices = extractLazadaPrices()
  data.price = prices.price
  data.originalPrice = prices.originalPrice
  data.discount = prices.discount

  // Images (gallery)
  data.images = extractLazadaImages()
  data.image = data.images[0] || ''

  // Description
  data.description = (
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('.pdp-product-desc')?.textContent || ''
  ).trim()

  // Category — dynamic, no hardcoded mapping
  const breadcrumbs = extractBreadcrumbs()
  const specs = extractLazadaSpecs()
  data.categoryBreadcrumbs = breadcrumbs
  data.category = detectCategory(breadcrumbs, specs)

  return data
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_PRODUCT_DATA') sendResponse(extractLazadaData())
  return true
})
