/**
 * Popup Logic
 * Tab 1: Extract product data from current tab + save to admin
 * Tab 2: Clip Queue — show articles needing products, open SP/LAZ search
 */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

// Site config (display only — routing logic is in background.js)
const SITES_DISPLAY = {
  yoyocomputer: { name: 'YoYo Computer', emoji: '💻', cls: 'site-yoyo' },
  junservice:   { name: 'จันทร์เซอร์วิส', emoji: '🔧', cls: 'site-jun' },
}

let currentProductData = null
let currentSiteKey = 'yoyocomputer'   // detected site (overridden from storage on init)
let clipQueueData = []

// Load persisted site selection on startup — always render badge
chrome.storage.local.get(['selectedSiteKey'], (res) => {
  if (res.selectedSiteKey && SITES_DISPLAY[res.selectedSiteKey]) {
    currentSiteKey = res.selectedSiteKey
  }
  updateSiteBadge(currentSiteKey)  // render เสมอ ไม่ว่าจะมี stored หรือไม่
})

// Admin API config per site (mirrors SITES in background.js)
const ADMIN_SITES = {
  yoyocomputer: {
    adminUrl: 'https://api.yoyocomputer.com',
    adminKey: '1b31ea9fc29fb79db5fcfb1acfeab36cfb1a0a1ce60e212715d66478573c8cd8',
  },
  junservice: {
    adminUrl: 'http://5.78.74.134',   // nginx proxy → port 8014
    adminKey: '26d68da4cb084b6e1a69b88210034ce77a4ab42fdd9673fb6c04ec5ea03de936',
  },
}
// CONFIG proxy — resolves to current site's admin config dynamically
const CONFIG = {
  get adminUrl() { return (ADMIN_SITES[currentSiteKey] || ADMIN_SITES.yoyocomputer).adminUrl },
  get adminKey() { return (ADMIN_SITES[currentSiteKey] || ADMIN_SITES.yoyocomputer).adminKey },
}

// ================================================================
// Tab Switching
// ================================================================

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab
    $$('.tab').forEach((t) => t.classList.remove('active'))
    $$('.tab-content').forEach((c) => c.classList.remove('active'))
    tab.classList.add('active')
    $(`#tab-${target}`).classList.add('active')

    if (target === 'queue') loadClipQueue()
  })
})

// ================================================================
// TAB 1: Clip Product (same as before)
// ================================================================

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) { showNotSupported(); return }

  const url = tab.url
  let source = null
  if (url.includes('shopee.co.th') && !url.includes('affiliate.shopee')) {
    source = 'shopee'
  } else if (url.includes('lazada.co.th')) {
    source = 'lazada'
  }

  if (!source) { showNotSupported(); return }

  const badge = $('#source-badge')
  badge.textContent = source.toUpperCase()
  badge.className = `badge ${source}`

  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PRODUCT_DATA' })
    if (data && data.name) {
      currentProductData = data
      showProductForm(data)

      // Detect site from product category
      chrome.runtime.sendMessage(
        { type: 'DETECT_SITE', productData: data },
        (resp) => {
          if (resp?.siteKey) {
            currentSiteKey = resp.siteKey
            updateSiteBadge(resp.siteKey)
          }
        }
      )
    } else {
      showNotSupported()
    }
  } catch (err) {
    console.error('Error extracting data:', err)
    showNotSupported()
  }

  // Show active clip item banner if set
  showClipForBanner()
}

function showNotSupported() {
  $('#loading').style.display = 'none'
  $('#not-supported').style.display = 'block'
  // Still show clip-for banner
  showClipForBanner()
}

function updateSiteBadge(siteKey) {
  const el = $('#site-badge')
  if (!el) return
  const s = SITES_DISPLAY[siteKey] || SITES_DISPLAY.yoyocomputer
  el.textContent = `${s.emoji} ${s.name}`
  el.className = `site-badge ${s.cls}`
  el.title = 'คลิกเพื่อเปลี่ยน site'
}

// Manual site override (click badge to toggle)
document.addEventListener('click', (e) => {
  if (!e.target.matches('#site-badge')) return
  const sites = Object.keys(SITES_DISPLAY)
  const idx = sites.indexOf(currentSiteKey)
  currentSiteKey = sites[(idx + 1) % sites.length]
  updateSiteBadge(currentSiteKey)
  // Persist selection
  chrome.storage.local.set({ selectedSiteKey: currentSiteKey })
  // Reload queue if queue tab is active
  if ($('#tab-queue')?.classList.contains('active')) loadClipQueue()
})

async function showClipForBanner() {
  const stored = await chrome.storage.local.get(['activeClipItem'])
  const item = stored.activeClipItem
  if (item) {
    $('#clip-for-banner').style.display = 'flex'
    $('#clip-for-name').textContent = item.productName || item.keyword
    $('#clip-for-name').title = `บทความ: ${item.title || item.keyword}`
    const priceEl = $('#clip-for-price')
    if (priceEl) {
      priceEl.textContent = item.priceRange || ''
      priceEl.style.display = item.priceRange ? '' : 'none'
    }
  }
}

$('#clip-for-clear').addEventListener('click', async () => {
  await chrome.storage.local.remove(['activeClipItem'])
  $('#clip-for-banner').style.display = 'none'
})

async function showProductForm(data) {
  $('#loading').style.display = 'none'
  $('#product-form').style.display = 'block'

  $('#product-name').value = data.name || ''
  $('#product-price').value = data.price || ''
  $('#product-original-price').value = data.originalPrice || ''
  $('#product-discount').value = data.discount || ''
  $('#product-url').value = data.url || ''
  $('#product-description').value = data.description || ''

  // Show price display
  if (data.price) {
    const priceDisplay = $('#price-display')
    priceDisplay.style.display = 'flex'
    $('#display-sale-price').textContent = `฿${Number(data.price).toLocaleString()}`
    if (data.originalPrice && data.originalPrice > data.price) {
      $('#display-original-price').textContent = `฿${Number(data.originalPrice).toLocaleString()}`
      $('#display-original-price').style.display = ''
    } else {
      $('#display-original-price').style.display = 'none'
    }
    if (data.discount && data.discount > 0) {
      $('#display-discount').textContent = `-${data.discount}%`
      $('#display-discount').style.display = ''
    } else {
      $('#display-discount').style.display = 'none'
    }
  }

  // Category badge
  if (data.category) {
    const catEl = $('#display-category')
    catEl.textContent = data.category
    catEl.style.display = ''
  }

  // Main image
  if (data.image) {
    $('#product-image').src = data.image
    $('#product-image-container').style.display = 'block'
  }

  // Gallery
  if (data.images && data.images.length > 0) {
    const gallery = $('#image-gallery')
    gallery.style.display = 'flex'
    gallery.innerHTML = ''
    data.images.forEach((url, i) => {
      const img = document.createElement('img')
      img.src = url
      img.className = (url === data.image || i === 0) ? 'selected' : ''
      img.addEventListener('click', () => {
        gallery.querySelectorAll('img').forEach(el => el.classList.remove('selected'))
        img.classList.add('selected')
        currentProductData.image = url
        $('#product-image').src = url
        $('#product-image-container').style.display = 'block'
      })
      gallery.appendChild(img)
    })
  }

  // Check for previously generated affiliate link
  const localData = await chrome.storage.local.get(['generatedAffiliateUrl'])
  if (localData.generatedAffiliateUrl) {
    $('#affiliate-url').value = localData.generatedAffiliateUrl
    $('#btn-convert').textContent = '✅ แปลงแล้ว'
    chrome.storage.local.remove(['generatedAffiliateUrl'])
  }
}

// Convert affiliate link
$('#btn-convert').addEventListener('click', async () => {
  const productUrl = $('#product-url').value
  if (!productUrl) return

  $('#btn-convert').textContent = '⏳ กำลังแปลง...'
  $('#btn-convert').disabled = true
  $('#affiliate-url').value = ''
  $('#affiliate-url').placeholder = 'รอสักครู่...'

  await chrome.storage.local.set({ pendingAffiliateUrl: productUrl })

  const source = currentProductData?.source || 'shopee'
  const portalUrl = source === 'lazada'
    ? 'https://adsense.lazada.co.th/index.htm#!/'
    : 'https://affiliate.shopee.co.th/offer/custom_link'

  const portalTab = await chrome.tabs.create({ url: portalUrl, active: false })

  let attempts = 0
  const poll = setInterval(async () => {
    attempts++
    const stored = await chrome.storage.local.get(['generatedAffiliateUrl'])
    if (stored.generatedAffiliateUrl) {
      clearInterval(poll)
      $('#affiliate-url').value = stored.generatedAffiliateUrl
      $('#btn-convert').textContent = '✅ แปลงแล้ว'
      $('#btn-convert').disabled = false
      chrome.storage.local.remove(['generatedAffiliateUrl'])
      // Auto-close affiliate portal tab + auto save
      try { chrome.tabs.remove(portalTab.id) } catch {}
      $('#btn-save').click()
    }
    if (attempts >= 60) {
      clearInterval(poll)
      $('#btn-convert').textContent = '🔗 แปลง'
      $('#btn-convert').disabled = false
      $('#affiliate-url').placeholder = 'ไม่พบ - ลองวาง manual'
      try { chrome.tabs.remove(portalTab.id) } catch {}
    }
  }, 500)
})

// Listen for affiliate link result (backup)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AFFILIATE_LINK_RESULT') {
    $('#affiliate-url').value = message.affiliateUrl
    $('#btn-convert').textContent = '✅ แปลงแล้ว'
    $('#btn-convert').disabled = false
  }
})

// Save to admin
$('#btn-save').addEventListener('click', async () => {
  const name = $('#product-name').value.trim()
  if (!name) { showResult('กรุณาใส่ชื่อสินค้า', false); return }

  const saveData = {
    name,
    price: $('#product-price').value || null,
    originalPrice: $('#product-original-price').value || null,
    discount: $('#product-discount').value || null,
    url: $('#product-url').value,
    affiliateUrl: $('#affiliate-url').value || null,
    image: currentProductData?.image || null,
    description: $('#product-description').value || null,
    source: currentProductData?.source || 'shopee',
    category: currentProductData?.category || null,
    categoryBreadcrumbs: currentProductData?.categoryBreadcrumbs || null,
    targetSite: currentSiteKey,   // ← ส่ง site ที่ผู้ใช้เลือกไปด้วย
  }

  $('#btn-save').textContent = '⏳ กำลังบันทึก...'
  $('#btn-save').disabled = true

  chrome.runtime.sendMessage(
    { type: 'SAVE_TO_ADMIN', data: saveData },
    async (response) => {
      if (response?.success) {
        const created = response.data.created || 0
        const updated = response.data.updated || 0
        const siteName = response.data._siteName || ''
        const siteTag = siteName ? ` → ${siteName}` : ''
        const msg = updated > 0
          ? `✅ อัปเดต ${updated} รายการ${siteTag}`
          : `✅ บันทึก ${created} รายการ${siteTag}`
        showResult(msg, true)
        $('#btn-save').textContent = '✅ บันทึกแล้ว'

        // Mark done + chain to next product
        await autoCheckAndChainNext()
      } else {
        showResult(`❌ ${response?.error || 'เกิดข้อผิดพลาด'}`, false)
        $('#btn-save').textContent = '💾 บันทึกเข้า Admin'
        $('#btn-save').disabled = false
      }
    }
  )
})

// Auto-check + close tab + open next product search
async function autoCheckAndChainNext() {
  const stored = await chrome.storage.local.get(['activeClipItem'])
  const item = stored.activeClipItem
  if (!item) return

  // Mark current SP or LAZ as checked
  const source = item.source || 'sp'
  const checkedKey = `checked_${item.gapId}_${item.productIndex}_${source}`
  await chrome.storage.local.set({ [checkedKey]: true })

  // Cross-gap: mark same product in ALL other gaps as checked too
  await crossGapAutoCheck(item.productName, source)

  // Check if ALL products × ALL sources are checked
  const allChecked = await checkAllProductsChecked(item.gapId, item.totalProducts)
  if (allChecked) {
    try {
      await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${item.gapId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
        body: JSON.stringify({ status: 'writing' }),
      })
    } catch (err) { console.error('Error updating status:', err) }
  }

  // Find next unchecked product+source
  const nextUrl = await findNextClipUrl(item)

  // Clear active clip item
  await chrome.storage.local.remove(['activeClipItem'])
  $('#clip-for-banner').style.display = 'none'

  // Close current SP/LAZ tab + open next (or go to queue)
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const isSpLaz = currentTab?.url && (currentTab.url.includes('shopee.co.th') || currentTab.url.includes('lazada.co.th'))

  if (nextUrl) {
    // Chain: navigate current tab to next search (faster than close+open)
    if (isSpLaz) {
      await chrome.tabs.update(currentTab.id, { url: nextUrl.url })
      await chrome.storage.local.set({ activeClipItem: nextUrl.clipItem })
    }
  } else {
    // All gaps done — don't close tab, just clear state
    // (tab stays open so user doesn't lose their place)
  }
}

// Cross-gap: when product X is clipped for gap A, auto-mark product X in all other gaps
async function crossGapAutoCheck(productName, source) {
  if (!productName) return
  const pNameLower = productName.toLowerCase().trim()
  try {
    const resp = await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps?status=pending`, {
      headers: { 'x-admin-key': CONFIG.adminKey },
    })
    const data = await resp.json()
    const gaps = data.items || []

    for (const gap of gaps) {
      const products = parseProducts(gap.potential_products)
      for (let i = 0; i < products.length; i++) {
        if (products[i].toLowerCase().trim() === pNameLower) {
          // Same product found in another gap — auto-mark as checked
          const key = `checked_${gap.id}_${i}_${source}`
          await chrome.storage.local.set({ [key]: true })
          // Check if this gap is now fully done
          const allDone = await checkAllProductsChecked(gap.id, products.length)
          if (allDone) {
            try {
              await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${gap.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
                body: JSON.stringify({ status: 'writing' }),
              })
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    console.error('Cross-gap auto-check error:', err)
  }
}

// Find next unchecked product+source — searches ACROSS all pending gaps
async function findNextClipUrl(currentItem) {
  const { gapId, productIndex, source, totalProducts, allProducts, keyword, title, notes } = currentItem

  // 1) Search within current gap first — SP only (LAZ is auto by Claude)
  if (allProducts && totalProducts) {
    const candidates = []
    for (let i = productIndex + 1; i < totalProducts; i++) {
      candidates.push({ idx: i, src: 'sp' })
    }
    for (const c of candidates) {
      const checkKey = `checked_${gapId}_${c.idx}_${c.src}`
      const naKey = `na_${gapId}_${c.idx}_${c.src}`
      const s = await chrome.storage.local.get([checkKey, naKey])
      if (!s[checkKey] && !s[naKey]) {
        const pName = allProducts[c.idx]
        const pRange = extractPriceRange(notes, pName)
        const searchUrl = c.src === 'sp'
          ? `https://shopee.co.th/search?keyword=${encodeURIComponent(pName)}`
          : `https://www.lazada.co.th/catalog/?q=${encodeURIComponent(pName)}`
        return {
          url: searchUrl,
          clipItem: { gapId, keyword, title, productName: pName, productIndex: c.idx, totalProducts, allProducts, source: c.src, priceRange: pRange, notes }
        }
      }
    }
  }

  // 2) Current gap done — fetch next pending gaps from API
  try {
    const resp = await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps?status=pending`, {
      headers: { 'x-admin-key': CONFIG.adminKey },
    })
    const data = await resp.json()
    const gaps = data.items || []

    for (const gap of gaps) {
      if (gap.id === gapId) continue
      const products = parseProducts(gap.potential_products)

      // Bait/no-product gaps — auto-mark as writing and skip
      if (products.length === 0) {
        try {
          await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${gap.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
            body: JSON.stringify({ status: 'writing' }),
          })
        } catch {}
        continue
      }

      // Find first unchecked SP product in this gap (LAZ is auto by Claude)
      for (let i = 0; i < products.length; i++) {
        const checkKey = `checked_${gap.id}_${i}_sp`
        const naKey = `na_${gap.id}_${i}_sp`
        const s = await chrome.storage.local.get([checkKey, naKey])
        if (!s[checkKey] && !s[naKey]) {
          const pName = products[i]
          const pRange = extractPriceRange(gap.notes, pName)
          return {
            url: `https://shopee.co.th/search?keyword=${encodeURIComponent(pName)}`,
            clipItem: {
              gapId: gap.id, keyword: gap.keyword, title: gap.suggested_title,
              productName: pName, productIndex: i, totalProducts: products.length,
              allProducts: products, source: 'sp', priceRange: pRange, notes: gap.notes,
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching next gap:', err)
  }

  return null // truly all done across all gaps
}

async function checkAllProductsChecked(gapId, totalProducts) {
  if (!totalProducts) return true
  const keys = []
  for (let i = 0; i < totalProducts; i++) {
    keys.push(`checked_${gapId}_${i}_sp`)
    keys.push(`na_${gapId}_${i}_sp`)
  }
  const stored = await chrome.storage.local.get(keys)
  // Only check SP — LAZ is auto by Claude
  for (let i = 0; i < totalProducts; i++) {
    const spOk = !!stored[`checked_${gapId}_${i}_sp`] || !!stored[`na_${gapId}_${i}_sp`]
    if (!spOk) return false
  }
  return true
}

function showResult(message, success) {
  const el = $('#save-result')
  el.style.display = 'block'
  el.textContent = message
  el.className = `result ${success ? 'success' : 'error'}`
}

// ================================================================
// TAB 2: Clip Queue
// ================================================================

async function loadClipQueue() {
  const queueList = $('#queue-list')
  const queueLoading = $('#queue-loading')
  const queueEmpty = $('#queue-empty')

  queueLoading.style.display = 'block'
  queueEmpty.style.display = 'none'
  queueList.innerHTML = ''

  try {
    const resp = await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps`, {
      headers: { 'x-admin-key': CONFIG.adminKey },
    })
    const data = await resp.json()
    clipQueueData = data.items || []
  } catch (err) {
    console.error('Error loading clip queue:', err)
    clipQueueData = []
  }

  queueLoading.style.display = 'none'

  // Sort: pending first, then by priority (high > medium > low)
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const statusOrder = { pending: 0, writing: 1, published: 2, skipped: 3 }
  clipQueueData.sort((a, b) => {
    const sd = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0)
    if (sd !== 0) return sd
    return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
  })

  // Count pending
  const pendingCount = clipQueueData.filter(g => g.status === 'pending').length
  $('#queue-count').textContent = pendingCount > 0 ? pendingCount : ''

  if (clipQueueData.length === 0) {
    queueEmpty.style.display = 'block'
    return
  }

  // Auto-mark bait articles (no products) as 'writing' — they don't need clipping
  for (const gap of clipQueueData) {
    if (gap.status === 'pending') {
      const products = parseProducts(gap.potential_products)
      if (products.length === 0) {
        gap.status = 'writing'
        try {
          fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${gap.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
            body: JSON.stringify({ status: 'writing' }),
          })
        } catch {}
      }
    }
  }

  // Re-count pending after auto-marking baits
  const realPending = clipQueueData.filter(g => g.status === 'pending').length
  $('#queue-count').textContent = realPending > 0 ? realPending : ''

  for (const gap of clipQueueData) {
    queueList.appendChild(await renderQueueArticle(gap))
  }
}

async function renderQueueArticle(gap) {
  const products = parseProducts(gap.potential_products)
  const isDone = gap.status === 'published' || gap.status === 'skipped'

  const article = document.createElement('div')
  article.className = `q-article${isDone ? ' done' : ''}`

  // Status label
  const statusLabels = { pending: 'ต้อง Clip', writing: 'Clipped', published: 'วางแล้ว', skipped: 'ข้าม' }
  const statusClass = gap.status

  // Header (clickable to expand)
  const header = document.createElement('div')
  header.className = 'q-article-header'
  header.innerHTML = `
    <span class="q-priority ${gap.priority}"></span>
    <span class="q-article-title" title="${gap.suggested_title || gap.keyword}">${gap.suggested_title || gap.keyword}</span>
    <span class="q-article-status ${statusClass}">${statusLabels[gap.status] || gap.status}</span>
    <span class="q-chevron">▶</span>
  `
  header.addEventListener('click', () => {
    article.classList.toggle('expanded')
  })

  // Products section
  const productsDiv = document.createElement('div')
  productsDiv.className = 'q-products'

  if (products.length === 0) {
    productsDiv.innerHTML = '<div style="font-size:11px;color:#aaa;padding:4px 0">ไม่มีสินค้าแนะนำ</div>'
  } else {
    for (let i = 0; i < products.length; i++) {
      const pName = products[i]
      const pRange = extractPriceRange(gap.notes, pName)
      const spKey = `checked_${gap.id}_${i}_sp`
      const lazKey = `checked_${gap.id}_${i}_laz`

      // Auto-mark LAZ as done — Claude generates Lazada affiliate links via API
      await chrome.storage.local.set({ [lazKey]: true })

      const stored = await chrome.storage.local.get([spKey, lazKey])
      const spDone = !!stored[spKey]
      const lazDone = true // Always done (auto by Claude)

      const spNaKey = `na_${gap.id}_${i}_sp`
      const lazNaKey = `na_${gap.id}_${i}_laz`
      const naStored = await chrome.storage.local.get([spNaKey, lazNaKey])
      const spNa = !!naStored[spNaKey]
      const lazNa = false
      const spComplete = spDone || spNa
      const lazComplete = true
      const allComplete = spComplete && lazComplete

      const row = document.createElement('div')
      row.className = `q-product${allComplete ? ' checked' : ''}`
      row.innerHTML = `
        <span class="q-product-name">${pName}${pRange ? `<span class="q-price-range">${pRange}</span>` : ''}</span>
        <button class="q-btn-sp${spDone ? ' done' : ''}${spNa ? ' na' : ''}" title="${spNa ? 'คลิกเพื่อยกเลิก' : spDone ? 'คลิกเพื่อยกเลิก' : 'ค้นหาใน Shopee'}">${spDone ? '✓ SP' : spNa ? 'SP ✗' : 'SP'}</button>
        <button class="q-btn-na${spDone || spNa ? ' hidden' : ''}" title="ไม่มีใน Shopee">✗</button>
        <button class="q-btn-laz done" title="Lazada — Claude สร้าง link auto">✓ LAZ</button>
      `

      // Mutable state (so undo handlers see updated values)
      let spNaState = spNa
      let spDoneState = spDone

      // Helper: check completion and update gap status
      async function checkRowCompletion() {
        const allChecked = await checkAllProductsChecked(gap.id, products.length)
        if (allChecked) {
          try {
            await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${gap.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
              body: JSON.stringify({ status: 'writing' }),
            })
            // Update DOM status label
            const statusEl = article.querySelector('.q-article-status')
            if (statusEl) {
              statusEl.textContent = 'Clipped ✓'
              statusEl.className = 'q-article-status writing'
            }
          } catch (err) { console.error('Error updating status:', err) }
        }
      }

      const spBtn = row.querySelector('.q-btn-sp')
      const naBtn = row.querySelector('.q-btn-na')

      // ✗ button — mark product as not available on Shopee
      naBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await chrome.storage.local.set({ [spNaKey]: true, [spKey]: true })
        spNaState = true
        spBtn.textContent = 'SP ✗'
        spBtn.className = 'q-btn-sp na'
        spBtn.title = 'คลิกเพื่อยกเลิก'
        naBtn.classList.add('hidden')
        row.classList.add('checked')
        await checkRowCompletion()
      })

      // SP button — click = open search / undo done / undo N/A
      spBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (spNaState) {
          await chrome.storage.local.remove([spNaKey, spKey])
          spNaState = false
          spBtn.textContent = 'SP'
          spBtn.className = 'q-btn-sp'
          spBtn.title = 'ค้นหาใน Shopee'
          naBtn.classList.remove('hidden')
          row.classList.remove('checked')
          return
        }
        if (spDoneState) {
          await chrome.storage.local.remove([spKey])
          spDoneState = false
          spBtn.textContent = 'SP'
          spBtn.className = 'q-btn-sp'
          spBtn.title = 'ค้นหาใน Shopee'
          naBtn.classList.remove('hidden')
          row.classList.remove('checked')
          return
        }
        const searchUrl = `https://shopee.co.th/search?keyword=${encodeURIComponent(pName)}`
        await chrome.storage.local.set({
          activeClipItem: {
            gapId: gap.id, keyword: gap.keyword, title: gap.suggested_title,
            productName: pName, productIndex: i, totalProducts: products.length,
            allProducts: products, source: 'sp', priceRange: pRange, notes: gap.notes,
          }
        })
        chrome.tabs.create({ url: searchUrl })
      })

      // LAZ button — always done (Claude generates Lazada links via API)
      // No click handler needed — it's just a visual indicator

      productsDiv.appendChild(row)
    }
  }

  // Notes
  if (gap.notes) {
    const notesDiv = document.createElement('div')
    notesDiv.className = 'q-notes'
    notesDiv.textContent = gap.notes
    productsDiv.appendChild(notesDiv)
  }

  article.appendChild(header)
  article.appendChild(productsDiv)

  // Auto-expand pending articles
  if (gap.status === 'pending') {
    article.classList.add('expanded')
  }

  // Post-render: if all products already done in localStorage but status still 'pending' → update
  if (gap.status === 'pending' && products.length > 0) {
    checkAllProductsChecked(gap.id, products.length).then(async (allDone) => {
      if (allDone) {
        try {
          await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${gap.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
            body: JSON.stringify({ status: 'writing' }),
          })
        } catch {}
        const statusEl = article.querySelector('.q-article-status')
        if (statusEl) {
          statusEl.textContent = 'Clipped ✓'
          statusEl.className = 'q-article-status writing'
        }
      }
    })
  }

  return article
}

function parseProducts(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  // Split by | (pipe) — standard delimiter for potential_products
  // Comma splitting breaks on prices like "2,000" and brand lists like "Hbada, Sihoo"
  if (raw.includes('|')) {
    return raw.split('|').map(s => s.trim()).filter(Boolean)
  }
  // Split by / — used as "product A / product B" separator
  if (raw.includes(' / ')) {
    return raw.split(' / ').map(s => s.trim()).filter(Boolean)
  }
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Extract price range from notes for a specific product name
 * Notes format: "Product Name: SV:3,600 | 800-1,200฿"
 */
function extractPriceRange(notes, productName) {
  if (!notes || !productName) return null
  // Escape regex special chars in product name
  const escaped = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped + '[^|]*\\|\\s*([\\d,]+-[\\d,]+)฿', 'i')
  const m = notes.match(re)
  if (m) return m[1] + '฿'
  return null
}

// ================================================================
// Init
// ================================================================

const isQueueMode = new URLSearchParams(window.location.search).has('queue')
if (!isQueueMode) init()
loadQueueCount()
chrome.storage.local.get(['openQueueNext'], (stored) => {
  if (isQueueMode || stored.openQueueNext) {
    if (stored.openQueueNext) chrome.storage.local.remove(['openQueueNext'])
    switchToQueue()
  }
})

function switchToQueue() {
  $$('.tab').forEach((t) => t.classList.remove('active'))
  $$('.tab-content').forEach((c) => c.classList.remove('active'))
  $('[data-tab="queue"]').classList.add('active')
  $('#tab-queue').classList.add('active')
  loadClipQueue()
}

// ================================================================
// Queue mode: watch for SP/LAZ product pages + auto-save
// ================================================================
if (isQueueMode) {
  let watchedProductData = null
  let watchedTabId = null

  // Check active tab for product page
  async function checkActiveTab() {
    try {
      // Get all normal browser windows (exclude popup/panel)
      const wins = await chrome.windows.getAll({ windowTypes: ['normal'] })
      if (!wins.length) return
      const focusedWin = wins.find(w => w.focused) || wins[0]

      const tabs = await chrome.tabs.query({ active: true, windowId: focusedWin.id })
      const tab = tabs[0]
      if (!tab?.url) return

      // Skip if same tab already shown
      if (tab.id === watchedTabId && watchedProductData) return

      const isProduct = (tab.url.includes('shopee.co.th') && !tab.url.includes('/search') && !tab.url.includes('affiliate.shopee'))
        || (tab.url.includes('lazada.co.th') && !tab.url.includes('/catalog/'))

      const bar = $('#queue-product-bar')
      if (!isProduct) {
        bar.style.display = 'none'
        watchedProductData = null
        watchedTabId = null
        return
      }

      // Try extract product data
      const data = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PRODUCT_DATA' }).catch(() => null)
      if (!data?.name) {
        bar.style.display = 'none'
        return
      }

      watchedProductData = data
      watchedTabId = tab.id

      // Show product bar
      $('#qp-name').textContent = data.name
      $('#qp-price').textContent = data.price ? `฿${Number(data.price).toLocaleString()}` : ''
      $('#qp-image').src = data.image || ''
      $('#qp-image').style.display = data.image ? '' : 'none'
      bar.style.display = 'flex'
    } catch {}
  }

  // Poll active tab every 1.5s
  setInterval(checkActiveTab, 1500)
  setTimeout(checkActiveTab, 500)

  // Save button in queue product bar
  $('#qp-save').addEventListener('click', async () => {
    if (!watchedProductData) return
    const btn = $('#qp-save')
    btn.textContent = '⏳...'
    btn.disabled = true

    const saveData = {
      name: watchedProductData.name,
      price: watchedProductData.price || null,
      originalPrice: watchedProductData.originalPrice || null,
      discount: watchedProductData.discount || null,
      url: watchedProductData.url,
      affiliateUrl: null,
      image: watchedProductData.image || null,
      description: watchedProductData.description || null,
      source: watchedProductData.source || 'shopee',
      category: watchedProductData.category || null,
      categoryBreadcrumbs: watchedProductData.categoryBreadcrumbs || null,
    }

    // Convert affiliate link first
    const source = watchedProductData.source || 'shopee'
    const portalUrl = source === 'lazada'
      ? 'https://adsense.lazada.co.th/index.htm#!/'
      : 'https://affiliate.shopee.co.th/offer/custom_link'

    await chrome.storage.local.set({ pendingAffiliateUrl: watchedProductData.url })
    const portalTab = await chrome.tabs.create({ url: portalUrl, active: false })

    btn.textContent = '🔗 แปลงลิงค์...'

    // Poll for affiliate URL
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      const stored = await chrome.storage.local.get(['generatedAffiliateUrl'])
      if (stored.generatedAffiliateUrl || attempts >= 60) {
        clearInterval(poll)
        if (stored.generatedAffiliateUrl) {
          saveData.affiliateUrl = stored.generatedAffiliateUrl
          await chrome.storage.local.remove(['generatedAffiliateUrl'])
        }
        try { chrome.tabs.remove(portalTab.id) } catch {}

        // Save to admin
        btn.textContent = '💾 บันทึก...'
        chrome.runtime.sendMessage({ type: 'SAVE_TO_ADMIN', data: saveData }, async (response) => {
          if (response?.success) {
            btn.textContent = '✅'

            // Mark clip item done + chain to next
            const clipStored = await chrome.storage.local.get(['activeClipItem'])
            const item = clipStored.activeClipItem
            if (item) {
              const checkedKey = `checked_${item.gapId}_${item.productIndex}_${item.source}`
              await chrome.storage.local.set({ [checkedKey]: true })

              // Cross-gap: auto-mark same product in other gaps
              await crossGapAutoCheck(item.productName, item.source)

              const allChecked = await checkAllProductsChecked(item.gapId, item.totalProducts)
              if (allChecked) {
                try {
                  await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps/${item.gapId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': CONFIG.adminKey },
                    body: JSON.stringify({ status: 'writing' }),
                  })
                } catch {}
              }

              // Find next + navigate (cross-gap)
              const next = await findNextClipUrl(item)
              await chrome.storage.local.remove(['activeClipItem'])

              try {
                if (next) {
                  await chrome.storage.local.set({ activeClipItem: next.clipItem })
                  await chrome.tabs.update(watchedTabId, { url: next.url })
                }
                // If no next: don't close tab — user stays on current page
              } catch {}
            }

            // Reset bar
            setTimeout(() => {
              $('#queue-product-bar').style.display = 'none'
              btn.textContent = '💾 บันทึก'
              btn.disabled = false
              watchedProductData = null
              watchedTabId = null
              loadClipQueue()
            }, 800)
          } else {
            btn.textContent = '❌ ลองใหม่'
            btn.disabled = false
          }
        })
      }
    }, 500)
  })
}

// Pin queue button — open as separate popup window
$('#btn-pin-queue').addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/popup.html?queue=1'),
    type: 'popup',
    width: 460,
    height: 600,
  })
  window.close()
})

async function loadQueueCount() {
  try {
    const resp = await fetch(`${CONFIG.adminUrl}/api/admin/products/content-gaps?status=pending`, {
      headers: { 'x-admin-key': CONFIG.adminKey },
    })
    const data = await resp.json()
    const count = data.total || 0
    $('#queue-count').textContent = count > 0 ? count : ''
  } catch {}
}

// ================================================================
// TAB 3: Auto Match
// ================================================================

let autoMatchRunning = false

$('#btn-start-automatch').addEventListener('click', async () => {
  if (autoMatchRunning) return

  // Check ว่า Lazada ต้อง login ไหม
  const status = $('#automatch-status')
  status.textContent = 'กำลังตรวจสอบ...'
  status.style.display = 'block'
  status.className = 'automatch-status'

  try {
    const resp = await fetch(`${CONFIG.adminUrl}/api/admin/products?no_lazada=true&limit=1`, {
      headers: { 'X-Admin-Key': CONFIG.adminKey },
    })
    const data = await resp.json()
    const count = (data.items || data.products || []).filter(p => p.shopee_url && !p.lazada_url).length

    if (count === 0) {
      status.textContent = '✅ ทุกสินค้ามี Lazada link แล้ว!'
      status.className = 'automatch-status success'
      return
    }

    status.textContent = `พบสินค้าที่ยังไม่มี Lazada: ${count} รายการ กำลังเริ่ม...`
    status.className = 'automatch-status info'

    // แสดง progress + ซ่อนปุ่ม Start
    $('#automatch-progress').style.display = 'block'
    $('#btn-start-automatch').style.display = 'none'
    $('#btn-stop-automatch').style.display = ''
    autoMatchRunning = true

    // ส่ง message ไป background
    chrome.runtime.sendMessage({ type: 'START_AUTO_MATCH' })

  } catch (err) {
    status.textContent = `❌ Error: ${err.message}`
    status.className = 'automatch-status error'
  }
})

$('#btn-stop-automatch').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_AUTO_MATCH' })
  autoMatchRunning = false
  $('#btn-stop-automatch').style.display = 'none'
  $('#btn-start-automatch').style.display = ''
  $('#automatch-status').textContent = '⏹ หยุดแล้ว'
  $('#automatch-status').className = 'automatch-status'
  $('#automatch-status').style.display = 'block'
})

// รับ progress updates จาก background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'AUTO_MATCH_PROGRESS') return

  const status = $('#automatch-status')

  if (message.status === 'started') {
    $('#am-total').textContent = message.total
    status.textContent = `กำลัง match ${message.total} สินค้า...`
    status.className = 'automatch-status info'
    status.style.display = 'block'
  }

  if (message.status === 'progress') {
    const pct = Math.round((message.current.index / message.total) * 100)
    $('#automatch-bar').style.width = `${pct}%`
    $('#am-matched').textContent = message.matched
    $('#am-failed').textContent = message.failed
    $('#am-total').textContent = message.total
    const icon = message.current.found ? '✅' : '⚠️'
    $('#automatch-current').textContent = `${icon} [${message.current.index}/${message.total}] ${message.current.name.slice(0, 50)}`
  }

  if (message.status === 'done') {
    autoMatchRunning = false
    $('#automatch-bar').style.width = '100%'
    $('#btn-stop-automatch').style.display = 'none'
    $('#btn-start-automatch').style.display = ''
    $('#btn-start-automatch').textContent = '🔄 Match ใหม่'
    status.textContent = `✅ เสร็จแล้ว! ${message.matched}/${message.total} matched`
    status.className = 'automatch-status success'
    status.style.display = 'block'
    $('#automatch-current').textContent = ''
  }

  if (message.status === 'error') {
    autoMatchRunning = false
    $('#btn-stop-automatch').style.display = 'none'
    $('#btn-start-automatch').style.display = ''
    status.textContent = `❌ Error: ${message.error}`
    status.className = 'automatch-status error'
    status.style.display = 'block'
  }
})
