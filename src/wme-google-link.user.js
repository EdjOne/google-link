     1|// ==UserScript==
     2|// @name                Google Link (WME)
     3|// @name:uk             Google Link (WME)
     4|// @version             1.20.3
     5|// @description         🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     6|// @description:uk      🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     7|// @description:en      🔍 Finds Google Place by POI address. Click a venue → panel shows Google results → "🔗 Link" opens Maps. https://github.com/EdjOne/google-link
     8|// @author              EdjOne
     9|// @match               *://www.waze.com/editor*
    10|// @match               *://www.waze.com/*/editor*
    11|// @match               *://editor.waze.com/*
    12|// @match               *://editor-beta.waze.com/*
    13|// @match               *://beta.waze.com/*/editor*
    14|// @require             https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
    15|// @grant               none
    16|// @run-at              document-start
    17|// ==/UserScript==
    18|
    19|(function () {
    20|    console.log('[GL] ===== v1.20.3 loaded =====');
    21|
    22|    // --- Enable/Disable toggle (localStorage) ---
    23|    const ENABLED_KEY = 'gl_enabled';
    24|    let enabled = localStorage.getItem(ENABLED_KEY) !== 'false';
    25|    // NOTE: no early return — sidebar tab must always render so user can re-enable
    26|
    27|    // --- Settings (localStorage) ---
    28|    const LS = {
    29|        _k: (k) => 'gl_' + k,
    30|        get: (k, def) => { const v = localStorage.getItem(LS._k(k)); return v === null ? def : JSON.parse(v); },
    31|        set: (k, v) => { localStorage.setItem(LS._k(k), JSON.stringify(v)); },
    32|        showDistance: () => LS.get('showDistance', true),
    33|        setShowDistance: (v) => LS.set('showDistance', v),
    34|        showUnlinkedOnly: () => LS.get('showUnlinkedOnly', false),
    35|        setShowUnlinkedOnly: (v) => LS.set('showUnlinkedOnly', v),
    36|        maxRadius: () => LS.get('maxRadius', 5000),
    37|        setMaxRadius: (v) => LS.set('maxRadius', v),
    38|        showLine: () => LS.get('showLine', false),
    39|        setShowLine: (v) => LS.set('showLine', v),
    40|    };
    41|
    42|    // Force ALL shadow roots to be open
    43|    function injectPatch() {
    44|        try {
    45|            const s = document.createElement('script');
    46|            s.textContent = '(' + function() {
    47|                var orig = Element.prototype.attachShadow;
    48|                Element.prototype.attachShadow = function(init) {
    49|                    var safe = init || {};
    50|                    var mode = safe.mode === 'closed' ? 'open' : safe.mode;
    51|                    return orig.call(this, Object.assign({}, safe, { mode: mode }));
    52|                };
    53|            } + ')();';
    54|            (document.head || document.documentElement).prepend(s);
    55|            s.remove();
    56|        } catch (e) {}
    57|    }
    58|    if (document.head || document.documentElement) {
    59|        injectPatch();
    60|    } else {
    61|        new MutationObserver(function(mutations, obs) {
    62|            if (document.head || document.documentElement) { obs.disconnect(); injectPatch(); }
    63|        }).observe(document, { childList: true, subtree: true });
    64|    }
    65|
    66|    const L = '[GL]';
    67|    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    68|    let sdk = null, ac = null, ps = null, lastVid = null;
    69|    let tabLabel = null, tabPane = null;
    70|
    71|    // Haversine distance in meters
    72|    function haversine(lat1, lon1, lat2, lon2) {
    73|        const R = 6371000;
    74|        const toRad = x => x * Math.PI / 180;
    75|        const dLat = toRad(lat2 - lat1);
    76|        const dLon = toRad(lon2 - lon1);
    77|        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    78|        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    79|    }
    80|    function fmtDist(m) {
    81|        return m < 1000 ? Math.round(m) + ' м' : (m/1000).toFixed(1) + ' км';
    82|    }
    83|
    84|    // --- Hover line: dashed line from POI to Google result ---
    85|    // --- Hover line: WME SDK vector layer ---
    86|    const GL_LINE_LAYER = 'google-link-hover';
    87|
    88|    function initHoverLayer() {
    89|        try {
    90|            if (!sdk?.Map) return;
    91|            sdk.Map.addLayer({
    92|                layerName: GL_LINE_LAYER,
    93|                styleRules: [
    94|                    {
    95|                        predicate: (props) => props?.styleName === 'glLine',
    96|                        style: {
    97|                            strokeWidth: 3,
    98|                            strokeColor: '#fff',
    99|                            strokeOpacity: 0.85,
   100|                            strokeDashstyle: 'dash',
   101|                            graphicZIndex: 9999,
   102|                        }
   103|                    },
   104|                    {
   105|                        predicate: (props) => props?.styleName === 'glDot',
   106|                        style: {
   107|                            pointRadius: 6,
   108|                            fillColor: '#fff',
   109|                            fillOpacity: 0.9,
   110|                            strokeColor: '#fff',
   111|                            strokeWidth: 2,
   112|                            graphicZIndex: 10000,
   113|                        }
   114|                    }
   115|                ]
   116|            });
   117|            sdk.Map.setLayerVisibility({ layerName: GL_LINE_LAYER, visibility: false });
   118|        } catch (_) {}
   119|    }
   120|
   121|    function drawHoverLine(poiLoc, gLoc) {
   122|        if (!LS.showLine()) return;
   123|        try {
   124|            if (!sdk?.Map) return;
   125|            clearHoverLine();
   126|            sdk.Map.setLayerVisibility({ layerName: GL_LINE_LAYER, visibility: true });
   127|            const from = turf.point([poiLoc.lng, poiLoc.lat]);
   128|            const to = turf.point([gLoc.lng, gLoc.lat]);
   129|            const line = turf.lineString([
   130|                from.geometry.coordinates,
   131|                to.geometry.coordinates
   132|            ], { styleName: 'glLine' }, { id: 'gl_hover_line' });
   133|            const dot = turf.point(to.geometry.coordinates, { styleName: 'glDot' }, { id: 'gl_hover_dot' });
   134|            sdk.Map.addFeatureToLayer({ layerName: GL_LINE_LAYER, feature: line });
   135|            sdk.Map.addFeatureToLayer({ layerName: GL_LINE_LAYER, feature: dot });
   136|        } catch (_) {}
   137|    }
   138|
   139|    function clearHoverLine() {
   140|        try {
   141|            if (sdk?.Map) sdk.Map.removeAllFeaturesFromLayer({ layerName: GL_LINE_LAYER });
   142|        } catch (_) {}
   143|    }
   144|
   145|    async function go() {
   146|        console.log(L, 'init...');
   147|
   148|        for (let i = 0; i < 120; i++) {
   149|            if (uw.W?.map && uw.W?.model && uw.W?.selectionManager && typeof uw.getWmeSdk === 'function') break;
   150|            await new Promise(r => setTimeout(r, 500));
   151|        }
   152|        if (!uw.getWmeSdk) { console.error(L, 'SDK not found'); return; }
   153|
   154|        sdk = uw.getWmeSdk({ scriptId: 'gl', scriptName: 'GL' });
   155|        console.log(L, 'SDK ok');
   156|        initHoverLayer();
   157|
   158|        // --- Register sidebar tab ---
   159|        try {
   160|            const result = await sdk.Sidebar.registerScriptTab();
   161|            tabLabel = result.tabLabel;
   162|            tabPane = result.tabPane;
   163|            tabLabel.innerText = '🔍 GL';
   164|            tabLabel.title = 'Google Link — Search & link Google Places';
   165|
   166|            // Settings section
   167|            const showDist = LS.showDistance();
   168|            const showUnlinked = LS.showUnlinkedOnly();
   169|            const showLine = LS.showLine();
   170|            const radius = LS.maxRadius();
   171|
   172|            tabPane.innerHTML = `
   173|                <div style="padding:10px;">
   174|                    <h3 style="margin:0 0 8px 0;">🔍 Google Link <small style="font-weight:normal;color:#aaa;">v1.20.3</small></h3>
   175|                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
   176|                        <wz-checkbox id="gl-chk-enabled" ${enabled ? 'checked' : ''}>⚡ Увімкнено</wz-checkbox>
   177|                        <wz-checkbox id="gl-chk-dist" ${showDist ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>📍 Відстань</wz-checkbox>
   178|                        <wz-checkbox id="gl-chk-unlinked" ${showUnlinked ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>🔗 Без посилань</wz-checkbox>
   179|                        <wz-checkbox id="gl-chk-line" ${showLine ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>📏 Рулетка</wz-checkbox>
   180|                        <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;">
   181|                            Радіус: <input id="gl-radius" type="number" min="100" max="50000" step="100" value="${radius}" ${!enabled ? 'disabled' : ''} style="width:65px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;" /> м
   182|                        </span>
   183|                    </div>
   184|                    <div style="font-size:12px;color:#888;">${enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено'}</div>
   185|                    <div style="margin-top:12px;padding-top:6px;border-top:1px solid #eee;width:100%;box-sizing:border-box;">
   186|                        <div style="background:#005bbb;color:#fff;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">made in</div>
   187|                        <div style="background:#ffd500;color:#000;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">Ukraine</div>
   188|                    </div>
   189|                </div>
   190|            `;
   191|
   192|            // Checkbox: enable/disable script
   193|            const chkEnabled = tabPane.querySelector('#gl-chk-enabled');
   194|            if (chkEnabled) {
   195|                chkEnabled.addEventListener('click', () => {
   196|                    const on = chkEnabled.hasAttribute('checked');
   197|                    on ? chkEnabled.removeAttribute('checked') : chkEnabled.setAttribute('checked', '');
   198|                    enabled = !on;
   199|                    localStorage.setItem(ENABLED_KEY, String(enabled));
   200|                    // Enable/disable other controls
   201|                    const chkD = tabPane.querySelector('#gl-chk-dist');
   202|                    const chkU = tabPane.querySelector('#gl-chk-unlinked');
   203|                    const chkL = tabPane.querySelector('#gl-chk-line');
   204|                    const rIn = tabPane.querySelector('#gl-radius');
   205|                    const hint = tabPane.querySelector('div[style*="color:#888"]');
   206|                    if (chkD) chkD.disabled = !enabled;
   207|                    if (chkU) chkU.disabled = !enabled;
   208|                    if (chkL) chkL.disabled = !enabled;
   209|                    if (rIn) rIn.disabled = !enabled;
   210|                    if (hint) hint.textContent = enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено';
   211|                    if (enabled) {
   212|                        console.log(L, 'Enabled');
   213|                        if (LS.showUnlinkedOnly()) highlightUnlinked();
   214|                    } else {
   215|                        console.log(L, 'Disabled');
   216|                        resetHighlights();
   217|                        const p = document.getElementById('gl-p'); if (p) p.remove();
   218|                    }
   219|                });
   220|            }
   221|
   222|            // Checkbox: show distance
   223|            const chkDist = tabPane.querySelector('#gl-chk-dist');
   224|            if (chkDist) {
   225|                chkDist.addEventListener('click', () => {
   226|                    const on = chkDist.hasAttribute('checked');
   227|                    on ? chkDist.removeAttribute('checked') : chkDist.setAttribute('checked', '');
   228|                    LS.setShowDistance(!on);
   229|                });
   230|            }
   231|
   232|            // Checkbox: unlinked only
   233|            const chkUnlinked = tabPane.querySelector('#gl-chk-unlinked');
   234|            if (chkUnlinked) {
   235|                chkUnlinked.addEventListener('click', () => {
   236|                    const on = chkUnlinked.hasAttribute('checked');
   237|                    on ? chkUnlinked.removeAttribute('checked') : chkUnlinked.setAttribute('checked', '');
   238|                    LS.setShowUnlinkedOnly(!on);
   239|                    // Highlight/unhighlight on map
   240|                    if (LS.showUnlinkedOnly()) highlightUnlinked();
   241|                    else resetHighlights();
   242|                });
   243|            }
   244|
   245|
   246|            // Checkbox: show line
   247|            const chkLine = tabPane.querySelector('#gl-chk-line');
   248|            if (chkLine) {
   249|                chkLine.addEventListener('change', (e) => {
   250|                    LS.setShowLine(e.target.checked);
   251|                    console.log(L, 'showLine changed:', e.target.checked);
   252|                    if (!e.target.checked) clearHoverLine();
   253|                });
   254|            }
   255|            // Input: radius
   256|            const radiusEl = tabPane.querySelector('#gl-radius');
   257|            if (radiusEl) {
   258|                radiusEl.addEventListener('change', () => {
   259|                    const v = Number(radiusEl.value);
   260|                    if (v >= 100 && v <= 50000) LS.setMaxRadius(v);
   261|                });
   262|            }
   263|
   264|            console.log(L, 'Sidebar tab registered');
   265|        } catch (e) { console.warn(L, 'Sidebar tab failed:', e); }
   266|
   267|        // Google Places
   268|        try {
   269|            const g = uw.google?.maps?.places;
   270|            if (g?.PlacesService) {
   271|                const psDiv = document.createElement('div');
   272|                psDiv.style.display = 'none';
   273|                document.body.appendChild(psDiv);
   274|                ps = new g.PlacesService(psDiv);
   275|                console.log(L, 'PlacesService ok');
   276|            }
   277|        } catch (e) { console.warn(L, 'Google fail:', e); }
   278|
   279|        // Listen selection
   280|        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSel }); } catch (_) {}
   281|        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: onSel }); } catch (_) {}
   282|        try { uw.W.selectionManager.events.register('selectionchanged', null, onSel); } catch (_) {}
   283|        setInterval(poll, 1000);
   284|
   285|        // Highlight unlinked on map events (zoom, pan, save) — always register, check checkbox at call time
   286|        function applyHighlightsIfNeeded() {
   287|            if (!enabled) return;
   288|            if (LS.showUnlinkedOnly()) highlightUnlinked();
   289|            else resetHighlights();
   290|        }
   291|        setTimeout(highlightUnlinked, 2000);
   292|        try { uw.W.map.events.register('zoomend', null, applyHighlightsIfNeeded); } catch (_) {}
   293|        try { uw.W.map.events.register('moveend', null, applyHighlightsIfNeeded); } catch (_) {}
   294|        // Re-highlight after save (DOM redraws POI markers)
   295|        try { uw.W.model.events.register('save', null, () => setTimeout(applyHighlightsIfNeeded, 500)); } catch (_) {}
   296|        try { sdk.Events.on({ eventName: 'wme-after-save', eventHandler: () => setTimeout(applyHighlightsIfNeeded, 500) }); } catch (_) {}
   297|
   298|        console.log(L, '=== READY ===');
   299|    }
   300|
   301|    function getVid() {
   302|        // SDK API — only venue (POI), NOT place/RPP/address point
   303|        try {
   304|            const s = sdk?.Editing?.getSelection?.();
   305|            if (s?.ids?.length === 1) {
   306|                const t = String(s?.objectType || '').toLowerCase();
   307|                console.log(L, 'Selection:', { objectType: s.objectType, id: s.ids[0], type: t });
   308|                if (t === 'venue') {
   309|                    try {
   310|                        const v = sdk.DataModel.Venues.getById({ venueId: String(s.ids[0]) });
   311|                        const a = v?.attributes || {};
   312|                        // Also try legacy model (has more populated attributes)
   313|                        const lv = uw.W?.model?.venues?.getObjectById(s.ids[0]);
   314|                        const la = lv?.attributes || {};
   315|                        // Use legacy attributes if SDK ones are empty
   316|                        const use = (a.categories || a.residential !== undefined) ? a : la;
   317|                        // Skip address points (RPP/AT): residential, placeholder
   318|                        if (use.residential || use.isResidential) return null;
   319|                        if (use.isPlaceholder) return null;
   320|                        // Skip nature + parking
   321|                        if (isSkippedCategory(lv || v)) return null;
   322|                        // If "unlinked only" is on, skip POIs that have externalProviderIDs
   323|                        if (LS.showUnlinkedOnly()) {
   324|                            const ep = a.externalProviderIds || a.externalProviderIDs;
   325|                            if (ep?.length > 0) return null;
   326|                        }
   327|                    } catch (e) { console.warn(L, 'Venue check failed:', e); }
   328|                    return String(s.ids[0]);
   329|                }
   330|            }
   331|        } catch (_) {}
   332|        // Legacy API — only type === 'venue'
   333|        try {
   334|            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
   335|            if (f?.length === 1) {
   336|                const t = f[0]?.model?.type;
   337|                const attrs = f[0]?.model?.attributes;
   338|                if (t === 'venue' && !attrs?.isPlaceholder && !attrs?.residential && !attrs?.isResidential) {
   339|                    // Skip nature + parking
   340|                    if (isSkippedCategory(f[0]?.model)) return null;
   341|                    // If "unlinked only" is on, skip POIs that have externalProviderIDs
   342|                    if (LS.showUnlinkedOnly()) {
   343|                        const ep = attrs?.externalProviderIds || attrs?.externalProviderIDs;
   344|                        if (ep?.length > 0) return null;
   345|                    }
   346|                    return String(attrs?.id);
   347|                }
   348|            }
   349|        } catch (_) {}
   350|        return null;
   351|    }
   352|
   353|    function onSel() { if (enabled) setTimeout(poll, 200); }
   354|    function poll() {
   355|        if (!enabled) return;
   356|        const vid = getVid();
   357|        if (vid && vid !== lastVid) {
   358|            lastVid = vid;
   359|            console.log(L, 'Venue:', vid);
   360|            show(vid);
   361|        } else if (!vid && lastVid) {
   362|            lastVid = null;
   363|            const p = document.getElementById('gl-p'); if (p) p.remove();
   364|        }
   365|    }
   366|
   367|    function q(vid) {
   368|        try {
   369|            const a = sdk.DataModel.Venues.getAddress({ venueId: vid });
   370|            const r = [];
   371|            const s = a.street?.englishName || a.street?.name; if (s) r.push(s);
   372|            // Don't add houseNumber if street name already ends with it (e.g. "вул. X, 142")
   373|            const hn = a.houseNumber;
   374|            if (hn && s && !s.endsWith(hn)) r.push(hn);
   375|            const c = a.city?.englishName || a.city?.name; if (c) r.push(c);
   376|            if (a.country?.name) r.push(a.country.name);
   377|            return r.join(', ');
   378|        } catch (_) { return ''; }
   379|    }
   380|    function nm(vid) { try { return sdk.DataModel.Venues.getById({ venueId: vid })?.name || ''; } catch (_) { return ''; } }
   381|function ll(vid) {
   382|        try {
   383|            const v = sdk.DataModel.Venues.getById({ venueId: vid });
   384|            if (!v?.geometry) return null;
   385|            // Use turf.centroid for proper geometric center (matches E50)
   386|            const c = turf.centroid(v.geometry);
   387|            if (!c?.geometry?.coordinates) return null;
   388|            const lng = c.geometry.coordinates[0], lat = c.geometry.coordinates[1];
   389|            if (isFinite(lat) && isFinite(lng)) return { lat, lng };
   390|        } catch (_) {}
   391|        return null;
   392|    }
   393|    function hn(vid) { try { return sdk.DataModel.Venues.getAddress({ venueId: vid })?.houseNumber || ''; } catch (_) { return ''; } }
   394|    function st(vid) { try { const a = sdk.DataModel.Venues.getAddress({ venueId: vid }); return a?.street?.name || a?.street?.englishName || ''; } catch (_) { return ''; } }
   395|
   396|    // --- Get alternative (old) street names from the segment assigned to this venue ---
   397|    // WME stores alt street IDs in segment.attributes.streetIDs (array of IDs)
   398|    function getAltStreets(vid) {
   399|        const alts = [];
   400|        try {
   401|            const streetId = sdk?.DataModel?.Venues?.getAddress?.({ venueId: vid })?.street?.id;
   402|            if (!streetId) return alts;
   403|            console.log(L, 'Alt streets: streetId =', streetId);
   404|            // Find a segment with this primaryStreetID and read its streetIDs array
   405|            const segs = uw.W?.model?.segments?.objects;
   406|            if (segs) {
   407|                const seg = Object.values(segs).find(s => s?.attributes?.primaryStreetID == streetId);
   408|                if (seg?.attributes?.streetIDs?.length) {
   409|                    const streets = uw.W?.model?.streets?.objects || {};
   410|                    for (const sid of seg.attributes.streetIDs) {
   411|                        const name = streets[String(sid)]?.attributes?.name;
   412|                        if (name && !alts.includes(name)) alts.push(name);
   413|                    }
   414|                }
   415|            }
   416|        } catch (_) {}
   417|        console.log(L, 'Alt streets found:', alts.length, alts);
   418|        return alts;
   419|    }
   420|
   421|    const STREET_PREFIXES = /^(вул\.|вулиця|ул\.|улица|бульв\.|бульвар|просп\.|проспект|пров\.|провулок|пл\.|площа)\s*/i;
   422|    const STREET_SUFFIXES = /\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i;
   423|    // Group aliases for street type comparison (UA+RU)
   424|    const STREET_TYPE_MAP = {
   425|        'вул': 'street', 'вулиця': 'street', 'ул': 'street', 'улица': 'street',
   426|        'пров': 'lane', 'провулок': 'lane',
   427|        'просп': 'avenue', 'проспект': 'avenue',
   428|        'бульв': 'boulevard', 'бульвар': 'boulevard',
   429|        'пл': 'square', 'площа': 'square',
   430|    };
   431|    function extractStreetType(s) {
   432|        const raw = (s || '').trim().toLowerCase();
   433|        const TYPE_RE = /(?:^|[\s,])(?:провулок|пров\.?|вулиця|вул\.?|улица|ул\.?|проспект|просп\.?|бульвар|бульв\.?|площа|пл\.?)(?:[\s,]|$)/i;
   434|        const m = raw.match(TYPE_RE);
   435|        if (!m) return '';
   436|        const kw = m[0].trim().replace(/[\s,]/g, '').replace(/\.$/, '');
   437|        return STREET_TYPE_MAP[kw] || '';
   438|    }
   439|    function normStreet(s) { return (s || '').replace(STREET_PREFIXES, '').replace(STREET_SUFFIXES, '').trim().toLowerCase(); }
   440|
   441|    function extractStreet(formattedAddr) {
   442|        const first = (formattedAddr || '').split(',')[0] || '';
   443|        return first
   444|            .replace(STREET_PREFIXES, '')      // remove prefix: "вул. "
   445|            .replace(/\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i, '') // remove suffix
   446|            .trim()
   447|            .toLowerCase();
   448|    }
   449|
   450|    function extractHouseNum(formattedAddr) {
   451|        const parts = formattedAddr.split(',').map(s => s.trim());
   452|        for (const part of parts) {
   453|            // Match short house numbers: 1-4 digits, optional letter/suffix (e.g. "20", "20А", "12-б", "20/1")
   454|            // Reject long numbers (postal codes), parts with spaces (street names starting with digit)
   455|            if (/^\d{1,4}[\/\-]?\d?[а-яіa-z]?$/i.test(part)) return part.toLowerCase();
   456|        }
   457|        return '';
   458|    }
   459|
   460|    // Levenshtein distance (for fuzzy street matching)
   461|    function levenshtein(a, b) {
   462|        if (a === b) return 0;
   463|        if (!a.length) return b.length;
   464|        if (!b.length) return a.length;
   465|        const m = a.length, n = b.length;
   466|        const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
   467|        for (let i = 0; i <= m; i++) dp[i][0] = i;
   468|        for (let j = 0; j <= n; j++) dp[0][j] = j;
   469|        for (let i = 1; i <= m; i++) {
   470|            for (let j = 1; j <= n; j++) {
   471|                dp[i][j] = a[i-1] === b[j-1]
   472|                    ? dp[i-1][j-1]
   473|                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
   474|            }
   475|        }
   476|        return dp[m][n];
   477|    }
   478|
   479|    // Streets match if Levenshtein distance ≤ 3 (handles відрадний/отрадний, transliteration)
   480|    // typeMismatch: true if both have known types but they differ (e.g. провулок vs вулиця)
   481|    function streetMatch(s1, s2, typeMismatch) {
   482|        if (!s1 || !s2) return true;
   483|        if (s1 === s2) return true;
   484|        if (typeMismatch) return false;
   485|        return levenshtein(s1, s2) <= 3;
   486|    }
   487|
   488|    // --- Highlight unlinked POIs on map (like PlaceNames PLUS) ---
   489|    function resetHighlights() {
   490|        // Reset label divs
   491|        document.querySelectorAll('.map-marker[data-id]').forEach(div => {
   492|            div.style.color = '';
   493|            div.style.fontWeight = '';
   494|            div.style.textShadow = '';
   495|        });
   496|        // Reset SVG icon strokes
   497|        try {
   498|            const venues = uw.W?.model?.venues;
   499|            if (!venues) return;
   500|            const venueLayer = uw.W?.map?.venueLayer;
   501|