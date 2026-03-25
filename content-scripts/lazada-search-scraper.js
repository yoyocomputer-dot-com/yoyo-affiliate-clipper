/**
 * Lazada Search Page Scraper
 * ทำงานใน user's browser ที่ https://www.lazada.co.th/catalog/?q=xxx
 * ดึง product list แล้วส่งกลับ background.js
 */

function extractSearchResults() {
  const products = []
  const seen = new Set()

  // Method 1: ดึงจาก window.__INITIAL_STATE__ หรือ script JSON
  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent || ''
    if (text.length > 500000) continue

    // Try to find listItems in embedded JSON
    if (text.includes('listItems') && text.includes('nid')) {
      try {
        // Find JSON object containing listItems
        const match = text.match(/"listItems"\s*:\s*(\[[\s\S]*?\])\s*,\s*"[a-z]/)
        if (match) {
          const items = JSON.parse(match[1])
          for (const item of items.slice(0, 20)) {
            const nid = item.nid || item.itemId
            if (!nid || seen.has(nid)) continue
            seen.add(nid)
            products.push({
              product_id: String(nid),
              name: (item.name || '').trim(),
              price: parseFloat(String(item.price || '0').replace(/,/g, '')) || 0,
              sold_count: parseSold(item.itemSoldCntShow || '0'),
              rating: parseFloat(item.ratingScore) || 0,
              review_count: parseInt(item.review) || 0,
              image: item.image ? (item.image.startsWith('http') ? item.image : 'https:' + item.image) : '',
              url: `https://www.lazada.co.th/products/pdp-i${nid}.html`,
              is_official: !!(item.isOfficialStore),
              is_mall: String(item.icons || '').toLowerCase().includes('lazmall'),
              seller: item.sellerName || '',
              brand: item.brandName || '',
            })
          }
          if (products.length >= 10) break
        }
      } catch (e) {}
    }
  }

  // Method 2: DOM scraping จาก product cards
  if (products.length === 0) {
    const cards = document.querySelectorAll('[data-qa-locator="product-item"], [data-tracking="product-card"], .Bm3ON')
    for (const card of Array.from(cards).slice(0, 20)) {
      try {
        const link = card.querySelector('a[href*="/products/"]')
        if (!link) continue
        const href = link.getAttribute('href') || ''
        const nidMatch = href.match(/-i(\d+)/)
        if (!nidMatch) continue
        const nid = nidMatch[1]
        if (seen.has(nid)) continue
        seen.add(nid)

        const nameEl = card.querySelector('[data-qa-locator="product-title"], .RfADt, a[title]')
        const priceEl = card.querySelector('.ooOxS, [data-qa-locator="product-price"]')
        const imgEl = card.querySelector('img')

        const name = (nameEl?.title || nameEl?.textContent || '').trim()
        if (!name) continue

        products.push({
          product_id: nid,
          name: name,
          price: parseFloat((priceEl?.textContent || '0').replace(/[^\d.]/g, '')) || 0,
          sold_count: 0,
          rating: 0,
          review_count: 0,
          image: imgEl?.src || '',
          url: `https://www.lazada.co.th/products/pdp-i${nid}.html`,
          is_official: false,
          is_mall: false,
          seller: '',
          brand: '',
        })
      } catch (e) {}
    }
  }

  return products
}

function parseSold(soldStr) {
  const s = String(soldStr).toLowerCase().replace('sold', '').replace(',', '').trim()
  if (!s || s === '?' || s === '0') return 0
  try {
    if (s.includes('k')) return Math.round(parseFloat(s) * 1000)
    if (s.includes('m')) return Math.round(parseFloat(s) * 1000000)
    return parseInt(s) || 0
  } catch { return 0 }
}

// ตอบ background.js เมื่อถูกถาม
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_SEARCH_RESULTS') {
    const results = extractSearchResults()
    sendResponse({ products: results, query: message.query })
  }
  return true
})
