     1|// ==UserScript==
     2|// @name                Google Link (WME)
     3|// @name:uk             Google Link (WME)
     4|// @version             1.17.0
     5|// @description         🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     6|// @description:uk      🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     7|// @description:en      🔍 Finds Google Place by POI address. Click a venue → panel shows Google results → "🔗 Link" opens Maps. https://github.com/EdjOne/google-link
     8|// @author              EdjOne
     9|// @match               *://www.waze.com/editor*
    10|// @match               *://www.waze.com/*/editor*
    11|// @match               *://editor.waze.com/*
    12|// @match               *://editor-beta.waze.com/*
    13|// @match               *://beta.waze.com/*/editor*
    14|// @grant               none
    15|// @run-at              document-start
    16|// ==/UserScript==
    17|
    18|(function () {
    19|    console.log('[GL] ===== v1.17.0 loaded =====');
    20|
    21|    // --- Enable/Disable toggle (localStorage) ---
    22|    const ENABLED_KEY = 'gl_enabled';
    23|    let enabled = localStorage.getItem(ENABLED_KEY) !== 'false';
    24|    // NOTE: no early return — sidebar tab must always render so user can re-enable
    25|
    26|    // --- Settings (localStorage) ---
    27|    const LS = {
    28|        _k: (k) => 'gl_' + k,
    29|        get: (k, def) => { const v = localStorage.getItem(LS._k(k)); return v === null ? def : JSON.parse(v); },
    30|        set: (k, v) => { localStorage.setItem(LS._k(k), JSON.stringify(v)); },
    31|        showDistance: () => LS.get('showDistance', true),
    32|        setShowDistance: (v) => LS.set('showDistance', v),
    33|        showUnlinkedOnly: () => LS.get('showUnlinkedOnly', false),
    34|        setShowUnlinkedOnly: (v) => LS.set('showUnlinkedOnly', v),
    35|        maxRadius: () => LS.get('maxRadius', 5000),
    36|        setMaxRadius: (v) => LS.set('maxRadius', v),
    37|    };
    38|
    39|    // Force ALL shadow roots to be open
    40|    function injectPatch() {
    41|        try {
    42|            const s = document.createElement('script');
    43|            s.textContent = '(' + function() {
    44|                var orig = Element.prototype.attachShadow;
    45|                Element.prototype.attachShadow = function(init) {
    46|                    var safe = init || {};
    47|                    var mode = safe.mode === 'closed' ? 'open' : safe.mode;
    48|                    return orig.call(this, Object.assign({}, safe, { mode: mode }));
    49|                };
    50|            } + ')();';
    51|            (document.head || document.documentElement).prepend(s);
    52|            s.remove();
    53|        } catch (e) {}
    54|    }
    55|    if (document.head || document.documentElement) {
    56|        injectPatch();
    57|    } else {
    58|        new MutationObserver(function(mutations, obs) {
    59|            if (document.head || document.documentElement) { obs.disconnect(); injectPatch(); }
    60|        }).observe(document, { childList: true, subtree: true });
    61|    }
    62|
    63|    const L = '[GL]';
    64|    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    65|    let sdk = null, ac = null, ps = null, lastVid = null;
    66|    let tabLabel = null, tabPane = null;
    67|
    68|    // Haversine distance in meters
    69|    function haversine(lat1, lon1, lat2, lon2) {
    70|        const R = 6371000;
    71|        const toRad = x => x * Math.PI / 180;
    72|        const dLat = toRad(lat2 - lat1);
    73|        const dLon = toRad(lon2 - lon1);
    74|        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    75|        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    76|    }
    77|    function fmtDist(m) {
    78|        return m < 1000 ? Math.round(m) + ' м' : (m/1000).toFixed(1) + ' км';
    79|    }
    80|
    81|    async function go() {
    82|        console.log(L, 'init...');
    83|
    84|        for (let i = 0; i < 120; i++) {
    85|            if (uw.W?.map && uw.W?.model && uw.W?.selectionManager && typeof uw.getWmeSdk === 'function') break;
    86|            await new Promise(r => setTimeout(r, 500));
    87|        }
    88|        if (!uw.getWmeSdk) { console.error(L, 'SDK not found'); return; }
    89|
    90|        sdk = uw.getWmeSdk({ scriptId: 'gl', scriptName: 'GL' });
    91|        console.log(L, 'SDK ok');
    92|
    93|        // --- Register sidebar tab ---
    94|        try {
    95|            const result = await sdk.Sidebar.registerScriptTab();
    96|            tabLabel = result.tabLabel;
    97|            tabPane = result.tabPane;
    98|            tabLabel.innerText = '🔍 GL';
    99|            tabLabel.title = 'Google Link — Search & link Google Places';
   100|
   101|            // Settings section
   102|            const showDist = LS.showDistance();
   103|            const showUnlinked = LS.showUnlinkedOnly();
   104|            const radius = LS.maxRadius();
   105|
   106|            tabPane.innerHTML = `
   107|                <div style="padding:10px;">
   108|                    <h3 style="margin:0 0 8px 0;">🔍 Google Link <small style="font-weight:normal;color:#aaa;">v1.16.0</small></h3>
   109|                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
   110|                        <wz-checkbox id="gl-chk-enabled" ${enabled ? 'checked' : ''}>⚡ Увімкнено</wz-checkbox>
   111|                        <wz-checkbox id="gl-chk-dist" ${showDist ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>📍 Відстань</wz-checkbox>
   112|                        <wz-checkbox id="gl-chk-unlinked" ${showUnlinked ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>🔗 Тільки без посилань</wz-checkbox>
   113|                        <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;">
   114|                            Радіус: <input id="gl-radius" type="number" min="100" max="50000" step="100" value="${radius}" ${!enabled ? 'disabled' : ''} style="width:65px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;" /> м
   115|                        </span>
   116|                    </div>
   117|                    <div style="font-size:12px;color:#888;">${enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено'}</div>
   118|                </div>
   119|            `;
   120|
   121|            // Checkbox: enable/disable script
   122|            const chkEnabled = tabPane.querySelector('#gl-chk-enabled');
   123|            if (chkEnabled) {
   124|                chkEnabled.addEventListener('click', () => {
   125|                    const on = chkEnabled.hasAttribute('checked');
   126|                    on ? chkEnabled.removeAttribute('checked') : chkEnabled.setAttribute('checked', '');
   127|                    enabled = !on;
   128|                    localStorage.setItem(ENABLED_KEY, String(enabled));
   129|                    // Enable/disable other controls
   130|                    const chkD = tabPane.querySelector('#gl-chk-dist');
   131|                    const chkU = tabPane.querySelector('#gl-chk-unlinked');
   132|                    const rIn = tabPane.querySelector('#gl-radius');
   133|                    const hint = tabPane.querySelector('div[style*="color:#888"]');
   134|                    if (chkD) chkD.disabled = !enabled;
   135|                    if (chkU) chkU.disabled = !enabled;
   136|                    if (rIn) rIn.disabled = !enabled;
   137|                    if (hint) hint.textContent = enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено';
   138|                    if (enabled) {
   139|                        console.log(L, 'Enabled');
   140|                        if (LS.showUnlinkedOnly()) highlightUnlinked();
   141|                    } else {
   142|                        console.log(L, 'Disabled');
   143|                        resetHighlights();
   144|                        const p = document.getElementById('gl-p'); if (p) p.remove();
   145|                    }
   146|                });
   147|            }
   148|
   149|            // Checkbox: show distance
   150|            const chkDist = tabPane.querySelector('#gl-chk-dist');
   151|            if (chkDist) {
   152|                chkDist.addEventListener('click', () => {
   153|                    const on = chkDist.hasAttribute('checked');
   154|                    on ? chkDist.removeAttribute('checked') : chkDist.setAttribute('checked', '');
   155|                    LS.setShowDistance(!on);
   156|                });
   157|            }
   158|
   159|            // Checkbox: unlinked only
   160|            const chkUnlinked = tabPane.querySelector('#gl-chk-unlinked');
   161|            if (chkUnlinked) {
   162|                chkUnlinked.addEventListener('click', () => {
   163|                    const on = chkUnlinked.hasAttribute('checked');
   164|                    on ? chkUnlinked.removeAttribute('checked') : chkUnlinked.setAttribute('checked', '');
   165|                    LS.setShowUnlinkedOnly(!on);
   166|                    // Highlight/unhighlight on map
   167|                    if (LS.showUnlinkedOnly()) highlightUnlinked();
   168|                    else resetHighlights();
   169|                });
   170|            }
   171|
   172|            // Input: radius
   173|            const radiusEl = tabPane.querySelector('#gl-radius');
   174|            if (radiusEl) {
   175|                radiusEl.addEventListener('change', () => {
   176|                    const v = Number(radiusEl.value);
   177|                    if (v >= 100 && v <= 50000) LS.setMaxRadius(v);
   178|                });
   179|            }
   180|
   181|            console.log(L, 'Sidebar tab registered');
   182|        } catch (e) { console.warn(L, 'Sidebar tab failed:', e); }
   183|
   184|        // Google Places
   185|        try {
   186|            const g = uw.google?.maps?.places;
   187|            if (g?.PlacesService) {
   188|                const psDiv = document.createElement('div');
   189|                psDiv.style.display = 'none';
   190|                document.body.appendChild(psDiv);
   191|                ps = new g.PlacesService(psDiv);
   192|                console.log(L, 'PlacesService ok');
   193|            }
   194|        } catch (e) { console.warn(L, 'Google fail:', e); }
   195|
   196|        // Listen selection
   197|        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSel }); } catch (_) {}
   198|        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: onSel }); } catch (_) {}
   199|        try { uw.W.selectionManager.events.register('selectionchanged', null, onSel); } catch (_) {}
   200|        setInterval(poll, 1000);
   201|
   202|        // Highlight unlinked on map events (zoom, pan, save) — always register, check checkbox at call time
   203|        function applyHighlightsIfNeeded() {
   204|            if (!enabled) return;
   205|            if (LS.showUnlinkedOnly()) highlightUnlinked();
   206|            else resetHighlights();
   207|        }
   208|        setTimeout(highlightUnlinked, 2000);
   209|        try { uw.W.map.events.register('zoomend', null, applyHighlightsIfNeeded); } catch (_) {}
   210|        try { uw.W.map.events.register('moveend', null, applyHighlightsIfNeeded); } catch (_) {}
   211|        // Re-highlight after save (DOM redraws POI markers)
   212|        try { uw.W.model.events.register('save', null, () => setTimeout(applyHighlightsIfNeeded, 500)); } catch (_) {}
   213|        try { sdk.Events.on({ eventName: 'wme-after-save', eventHandler: () => setTimeout(applyHighlightsIfNeeded, 500) }); } catch (_) {}
   214|
   215|        console.log(L, '=== READY ===');
   216|    }
   217|
   218|    function getVid() {
   219|        // SDK API — only venue (POI), NOT place/RPP/address point
   220|        try {
   221|            const s = sdk?.Editing?.getSelection?.();
   222|            if (s?.ids?.length === 1) {
   223|                const t = String(s?.objectType || '').toLowerCase();
   224|                console.log(L, 'Selection:', { objectType: s.objectType, id: s.ids[0], type: t });
   225|                if (t === 'venue') {
   226|                    try {
   227|                        const v = sdk.DataModel.Venues.getById({ venueId: String(s.ids[0]) });
   228|                        const a = v?.attributes || {};
   229|                        // Also try legacy model (has more populated attributes)
   230|                        const lv = uw.W?.model?.venues?.getObjectById(s.ids[0]);
   231|                        const la = lv?.attributes || {};
   232|                        // Use legacy attributes if SDK ones are empty
   233|                        const use = (a.categories || a.residential !== undefined) ? a : la;
   234|                        // Skip address points (RPP/AT): residential, placeholder
   235|                        if (use.residential || use.isResidential) return null;
   236|                        if (use.isPlaceholder) return null;
   237|                        // Skip nature + parking
   238|                        if (isSkippedCategory(lv || v)) return null;
   239|                        // If "unlinked only" is on, skip POIs that have externalProviderIDs
   240|                        if (LS.showUnlinkedOnly()) {
   241|                            const ep = a.externalProviderIds || a.externalProviderIDs;
   242|                            if (ep?.length > 0) return null;
   243|                        }
   244|                    } catch (e) { console.warn(L, 'Venue check failed:', e); }
   245|                    return String(s.ids[0]);
   246|                }
   247|            }
   248|        } catch (_) {}
   249|        // Legacy API — only type === 'venue'
   250|        try {
   251|            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
   252|            if (f?.length === 1) {
   253|                const t = f[0]?.model?.type;
   254|                const attrs = f[0]?.model?.attributes;
   255|                if (t === 'venue' && !attrs?.isPlaceholder && !attrs?.residential && !attrs?.isResidential) {
   256|                    // Skip nature + parking
   257|                    if (isSkippedCategory(f[0]?.model)) return null;
   258|                    // If "unlinked only" is on, skip POIs that have externalProviderIDs
   259|                    if (LS.showUnlinkedOnly()) {
   260|                        const ep = attrs?.externalProviderIds || attrs?.externalProviderIDs;
   261|                        if (ep?.length > 0) return null;
   262|                    }
   263|                    return String(attrs?.id);
   264|                }
   265|            }
   266|        } catch (_) {}
   267|        return null;
   268|    }
   269|
   270|    function onSel() { if (enabled) setTimeout(poll, 200); }
   271|    function poll() {
   272|        if (!enabled) return;
   273|        const vid = getVid();
   274|        if (vid && vid !== lastVid) {
   275|            lastVid = vid;
   276|            console.log(L, 'Venue:', vid);
   277|            show(vid);
   278|        } else if (!vid && lastVid) {
   279|            lastVid = null;
   280|            const p = document.getElementById('gl-p'); if (p) p.remove();
   281|        }
   282|    }
   283|
   284|    function q(vid) {
   285|        try {
   286|            const a = sdk.DataModel.Venues.getAddress({ venueId: vid });
   287|            const r = [];
   288|            const s = a.street?.englishName || a.street?.name; if (s) r.push(s);
   289|            if (a.houseNumber) r.push(a.houseNumber);
   290|            const c = a.city?.englishName || a.city?.name; if (c) r.push(c);
   291|            if (a.country?.name) r.push(a.country.name);
   292|            return r.join(', ');
   293|        } catch (_) { return ''; }
   294|    }
   295|    function nm(vid) { try { return sdk.DataModel.Venues.getById({ venueId: vid })?.name || ''; } catch (_) { return ''; } }
   296|function ll(vid) {
   297|        try {
   298|            const v = sdk.DataModel.Venues.getById({ venueId: vid });
   299|            const g = v?.geometry;
   300|            if (!g) return null;
   301|            const c = g.coordinates;
   302|            // Point: [lng, lat]
   303|            if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number') {
   304|                const lat = +c[1], lng = +c[0];
   305|                if (isFinite(lat) && isFinite(lng)) return { lat, lng };
   306|            }
   307|            // Polygon: [[[lng, lat], ...]] — take centroid of first ring
   308|            if (Array.isArray(c) && Array.isArray(c[0]) && Array.isArray(c[0][0])) {
   309|                const ring = c[0];
   310|                let slat = 0, slng = 0;
   311|                for (const pt of ring) { slat += pt[1]; slng += pt[0]; }
   312|                const lat = slat / ring.length, lng = slng / ring.length;
   313|                if (isFinite(lat) && isFinite(lng)) return { lat, lng };
   314|            }
   315|        } catch (_) {}
   316|        return null;
   317|    }
   318|    function hn(vid) { try { return sdk.DataModel.Venues.getAddress({ venueId: vid })?.houseNumber || ''; } catch (_) { return ''; } }
   319|    function st(vid) { try { const a = sdk.DataModel.Venues.getAddress({ venueId: vid }); return a?.street?.name || a?.street?.englishName || ''; } catch (_) { return ''; } }
   320|
   321|    // --- Get alternative (old) street names from the segment assigned to this venue ---
   322|    // WME stores alt street IDs in segment.attributes.streetIDs (array of IDs)
   323|    function getAltStreets(vid) {
   324|        const alts = [];
   325|        try {
   326|            const streetId = sdk?.DataModel?.Venues?.getAddress?.({ venueId: vid })?.street?.id;
   327|            if (!streetId) return alts;
   328|            console.log(L, 'Alt streets: streetId =', streetId);
   329|            // Find a segment with this primaryStreetID and read its streetIDs array
   330|            const segs = uw.W?.model?.segments?.objects;
   331|            if (segs) {
   332|                const seg = Object.values(segs).find(s => s?.attributes?.primaryStreetID == streetId);
   333|                if (seg?.attributes?.streetIDs?.length) {
   334|                    const streets = uw.W?.model?.streets?.objects || {};
   335|                    for (const sid of seg.attributes.streetIDs) {
   336|                        const name = streets[String(sid)]?.attributes?.name;
   337|                        if (name && !alts.includes(name)) alts.push(name);
   338|                    }
   339|                }
   340|            }
   341|        } catch (_) {}
   342|        console.log(L, 'Alt streets found:', alts.length, alts);
   343|        return alts;
   344|    }
   345|
   346|    const STREET_PREFIXES = /^(вул\.|вулиця|ул\.|улица|бульв\.|бульвар|просп\.|проспект|пров\.|провулок|пл\.|площа)\s*/i;
   347|    const STREET_SUFFIXES = /\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i;
   348|    // Group aliases for street type comparison (UA+RU)
   349|    const STREET_TYPE_MAP = {
   350|        'вул': 'street', 'вулиця': 'street', 'ул': 'street', 'улица': 'street',
   351|        'пров': 'lane', 'провулок': 'lane',
   352|        'просп': 'avenue', 'проспект': 'avenue',
   353|        'бульв': 'boulevard', 'бульвар': 'boulevard',
   354|        'пл': 'square', 'площа': 'square',
   355|    };
   356|    function extractStreetType(s) {
   357|        const raw = (s || '').trim().toLowerCase();
   358|        const TYPE_RE = /(?:^|[\s,])(?:провулок|пров\.?|вулиця|вул\.?|улица|ул\.?|проспект|просп\.?|бульвар|бульв\.?|площа|пл\.?)(?:[\s,]|$)/i;
   359|        const m = raw.match(TYPE_RE);
   360|        if (!m) return '';
   361|        const kw = m[0].trim().replace(/[\s,]/g, '').replace(/\.$/, '');
   362|        return STREET_TYPE_MAP[kw] || '';
   363|    }
   364|    function normStreet(s) { return (s || '').replace(STREET_PREFIXES, '').replace(STREET_SUFFIXES, '').trim().toLowerCase(); }
   365|
   366|    function extractStreet(formattedAddr) {
   367|        const first = (formattedAddr || '').split(',')[0] || '';
   368|        return first
   369|            .replace(STREET_PREFIXES, '')      // remove prefix: "вул. "
   370|            .replace(/\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i, '') // remove suffix
   371|            .trim()
   372|            .toLowerCase();
   373|    }
   374|
   375|    function extractHouseNum(formattedAddr) {
   376|        const parts = formattedAddr.split(',').map(s => s.trim());
   377|        for (const part of parts) {
   378|            // Match short house numbers: 1-4 digits, optional letter/suffix (e.g. "20", "20А", "12-б", "20/1")
   379|            // Reject long numbers (postal codes), parts with spaces (street names starting with digit)
   380|            if (/^\d{1,4}[\/\-]?\d?[а-яіa-z]?$/i.test(part)) return part.toLowerCase();
   381|        }
   382|        return '';
   383|    }
   384|
   385|    // Levenshtein distance (for fuzzy street matching)
   386|    function levenshtein(a, b) {
   387|        if (a === b) return 0;
   388|        if (!a.length) return b.length;
   389|        if (!b.length) return a.length;
   390|        const m = a.length, n = b.length;
   391|        const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
   392|        for (let i = 0; i <= m; i++) dp[i][0] = i;
   393|        for (let j = 0; j <= n; j++) dp[0][j] = j;
   394|        for (let i = 1; i <= m; i++) {
   395|            for (let j = 1; j <= n; j++) {
   396|                dp[i][j] = a[i-1] === b[j-1]
   397|                    ? dp[i-1][j-1]
   398|                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
   399|            }
   400|        }
   401|        return dp[m][n];
   402|    }
   403|
   404|    // Streets match if Levenshtein distance ≤ 3 (handles відрадний/отрадний, transliteration)
   405|    // typeMismatch: true if both have known types but they differ (e.g. провулок vs вулиця)
   406|    function streetMatch(s1, s2, typeMismatch) {
   407|        if (!s1 || !s2) return true;
   408|        if (s1 === s2) return true;
   409|        if (typeMismatch) return false;
   410|        return levenshtein(s1, s2) <= 3;
   411|    }
   412|
   413|    // --- Highlight unlinked POIs on map (like PlaceNames PLUS) ---
   414|    function resetHighlights() {
   415|        // Reset label divs
   416|        document.querySelectorAll('.map-marker[data-id]').forEach(div => {
   417|            div.style.color = '';
   418|            div.style.fontWeight = '';
   419|            div.style.textShadow = '';
   420|        });
   421|        // Reset SVG icon strokes
   422|        try {
   423|            const venues = uw.W?.model?.venues;
   424|            if (!venues) return;
   425|            const venueLayer = uw.W?.map?.venueLayer;
   426|            if (!venueLayer) return;
   427|            for (const mark in venues.objects) {
   428|                if (venueLayer.featureMap.has(mark)) {
   429|                    const featGeomId = venueLayer.featureMap.get(mark).geometry.id;
   430|                    const svgIcon = document.getElementById(featGeomId);
   431|                    if (svgIcon) {
   432|                        svgIcon.setAttribute('stroke', 'white');
   433|                        svgIcon.setAttribute('stroke-width', '2');
   434|                    }
   435|                }
   436|            }
   437|        } catch (_) {}
   438|    }
   439|
   440|    // --- Check if venue should be skipped based on category ---
   441|    function isSkippedCategory(venue) {
   442|        const cats = venue?.attributes?.categories;
   443|        if (!Array.isArray(cats)) return false;
   444|        const SKIP = ['NATURAL_FEATURES', 'PARKING_LOT'];
   445|        return cats.some(c => SKIP.includes(c.name));
   446|    }
   447|
   448|    function highlightUnlinked() {
   449|        resetHighlights();
   450|        try {
   451|            const venues = uw.W?.model?.venues;
   452|            if (!venues) return;
   453|            const venueLayer = uw.W?.map?.venueLayer;
   454|            if (!venueLayer) return;
   455|            for (const mark in venues.objects) {
   456|                const venue = venues.getObjectById(mark);
   457|                if (!venue) continue;
   458|                const ep = venue.attributes?.externalProviderIDs;
   459|                if (ep && ep.length > 0) continue; // skip linked
   460|                const isRH = venue.attributes?.residential || venue.attributes?.isResidential;
   461|                if (isRH) continue; // skip residential (like PlaceNames PLUS)
   462|                if (isSkippedCategory(venue)) continue; // skip nature + parking
   463|
   464|                // Highlight SVG icon
   465|                if (venueLayer.featureMap.has(mark)) {
   466|                    const featGeomId = venueLayer.featureMap.get(mark).geometry.id;
   467|                    const svgIcon = document.getElementById(featGeomId);
   468|                    if (svgIcon) {
   469|                        svgIcon.setAttribute('stroke', '#0ff');
   470|                        svgIcon.setAttribute('stroke-width', '3');
   471|                    }
   472|                }
   473|
   474|                // Highlight label div
   475|                const pointDiv = document.querySelector(`.map-marker[data-id="${mark}"]`);
   476|                if (pointDiv) {
   477|                    pointDiv.style.color = '#0ff';
   478|                    pointDiv.style.fontWeight = 'bold';
   479|                    pointDiv.style.textShadow = '0 0 4px #0ff';
   480|                }
   481|            }
   482|        } catch (e) { console.warn(L, 'highlightUnlinked failed:', e); }
   483|    }
   484|
   485|    // --- Remove highlight from a specific venue after linking ---
   486|    function unhighlightVenue(vid) {
   487|        try {
   488|            const venueLayer = uw.W?.map?.venueLayer;
   489|            if (venueLayer && venueLayer.featureMap.has(vid)) {
   490|                const featGeomId = venueLayer.featureMap.get(vid).geometry.id;
   491|                const svgIcon = document.getElementById(featGeomId);
   492|                if (svgIcon) {
   493|                    svgIcon.setAttribute('stroke', 'white');
   494|                    svgIcon.setAttribute('stroke-width', '2');
   495|                }
   496|            }
   497|            const pointDiv = document.querySelector('.map-marker[data-id="' + vid + '"]');
   498|            if (pointDiv) {
   499|                pointDiv.style.color = '';
   500|                pointDiv.style.fontWeight = '';
   501|