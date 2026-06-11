     1|// ==UserScript==
     2|// @name                Google Link (WME)
     3|// @name:uk             Google Link (WME)
     4|// @version             1.20.4\// @description         🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     5|// @description:uk      🔍 Шукає Google Place за адресою POI. Клікни на venue → панель покаже Google результати → "🔗 Link" відкриє Maps. https://github.com/EdjOne/google-link
     6|// @description:en      🔍 Finds Google Place by POI address. Click a venue → panel shows Google results → "🔗 Link" opens Maps. https://github.com/EdjOne/google-link
     7|// @author              EdjOne
     8|// @match               *://www.waze.com/editor*
     9|// @match               *://www.waze.com/*/editor*
    10|// @match               *://editor.waze.com/*
    11|// @match               *://editor-beta.waze.com/*
    12|// @match               *://beta.waze.com/*/editor*
    13|// @require             https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
    14|// @grant               none
    15|// @run-at              document-start
    16|// ==/UserScript==
    17|
    18|(function () {
    19|    console.log('[GL] ===== v1.20.3 loaded =====');
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
    37|        showLine: () => LS.get('showLine', false),
    38|        setShowLine: (v) => LS.set('showLine', v),
    39|    };
    40|
    41|    // Force ALL shadow roots to be open
    42|    function injectPatch() {
    43|        try {
    44|            const s = document.createElement('script');
    45|            s.textContent = '(' + function() {
    46|                var orig = Element.prototype.attachShadow;
    47|                Element.prototype.attachShadow = function(init) {
    48|                    var safe = init || {};
    49|                    var mode = safe.mode === 'closed' ? 'open' : safe.mode;
    50|                    return orig.call(this, Object.assign({}, safe, { mode: mode }));
    51|                };
    52|            } + ')();';
    53|            (document.head || document.documentElement).prepend(s);
    54|            s.remove();
    55|        } catch (e) {}
    56|    }
    57|    if (document.head || document.documentElement) {
    58|        injectPatch();
    59|    } else {
    60|        new MutationObserver(function(mutations, obs) {
    61|            if (document.head || document.documentElement) { obs.disconnect(); injectPatch(); }
    62|        }).observe(document, { childList: true, subtree: true });
    63|    }
    64|
    65|    const L = '[GL]';
    66|    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    67|    let sdk = null, ac = null, ps = null, lastVid = null;
    68|    let tabLabel = null, tabPane = null;
    69|
    70|    // Haversine distance in meters
    71|    function haversine(lat1, lon1, lat2, lon2) {
    72|        const R = 6371000;
    73|        const toRad = x => x * Math.PI / 180;
    74|        const dLat = toRad(lat2 - lat1);
    75|        const dLon = toRad(lon2 - lon1);
    76|        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    77|        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    78|    }
    79|    function fmtDist(m) {
    80|        return m < 1000 ? Math.round(m) + ' м' : (m/1000).toFixed(1) + ' км';
    81|    }
    82|
    83|    // --- Hover line: dashed line from POI to Google result ---
    84|    // --- Hover line: WME SDK vector layer ---
    85|    const GL_LINE_LAYER = 'google-link-hover';
    86|
    87|    function initHoverLayer() {
    88|        try {
    89|            if (!sdk?.Map) return;
    90|            sdk.Map.addLayer({
    91|                layerName: GL_LINE_LAYER,
    92|                styleRules: [
    93|                    {
    94|                        predicate: (props) => props?.styleName === 'glLine',
    95|                        style: {
    96|                            strokeWidth: 3,
    97|                            strokeColor: '#fff',
    98|                            strokeOpacity: 0.85,
    99|                            strokeDashstyle: 'dash',
   100|                            graphicZIndex: 9999,
   101|                        }
   102|                    },
   103|                    {
   104|                        predicate: (props) => props?.styleName === 'glDot',
   105|                        style: {
   106|                            pointRadius: 6,
   107|                            fillColor: '#fff',
   108|                            fillOpacity: 0.9,
   109|                            strokeColor: '#fff',
   110|                            strokeWidth: 2,
   111|                            graphicZIndex: 10000,
   112|                        }
   113|                    }
   114|                ]
   115|            });
   116|            sdk.Map.setLayerVisibility({ layerName: GL_LINE_LAYER, visibility: false });
   117|        } catch (_) {}
   118|    }
   119|
   120|    function drawHoverLine(poiLoc, gLoc) {
   121|        if (!LS.showLine()) return;
   122|        try {
   123|            if (!sdk?.Map) return;
   124|            clearHoverLine();
   125|            sdk.Map.setLayerVisibility({ layerName: GL_LINE_LAYER, visibility: true });
   126|            const from = turf.point([poiLoc.lng, poiLoc.lat]);
   127|            const to = turf.point([gLoc.lng, gLoc.lat]);
   128|            const line = turf.lineString([
   129|                from.geometry.coordinates,
   130|                to.geometry.coordinates
   131|            ], { styleName: 'glLine' }, { id: 'gl_hover_line' });
   132|            const dot = turf.point(to.geometry.coordinates, { styleName: 'glDot' }, { id: 'gl_hover_dot' });
   133|            sdk.Map.addFeatureToLayer({ layerName: GL_LINE_LAYER, feature: line });
   134|            sdk.Map.addFeatureToLayer({ layerName: GL_LINE_LAYER, feature: dot });
   135|        } catch (_) {}
   136|    }
   137|
   138|    function clearHoverLine() {
   139|        try {
   140|            if (sdk?.Map) sdk.Map.removeAllFeaturesFromLayer({ layerName: GL_LINE_LAYER });
   141|        } catch (_) {}
   142|    }
   143|
   144|    async function go() {
   145|        console.log(L, 'init...');
   146|
   147|        for (let i = 0; i < 120; i++) {
   148|            if (uw.W?.map && uw.W?.model && uw.W?.selectionManager && typeof uw.getWmeSdk === 'function') break;
   149|            await new Promise(r => setTimeout(r, 500));
   150|        }
   151|        if (!uw.getWmeSdk) { console.error(L, 'SDK not found'); return; }
   152|
   153|        sdk = uw.getWmeSdk({ scriptId: 'gl', scriptName: 'GL' });
   154|        console.log(L, 'SDK ok');
   155|        initHoverLayer();
   156|
   157|        // --- Register sidebar tab ---
   158|        try {
   159|            const result = await sdk.Sidebar.registerScriptTab();
   160|            tabLabel = result.tabLabel;
   161|            tabPane = result.tabPane;
   162|            tabLabel.innerText = '🔍 GL';
   163|            tabLabel.title = 'Google Link — Search & link Google Places';
   164|
   165|            // Settings section
   166|            const showDist = LS.showDistance();
   167|            const showUnlinked = LS.showUnlinkedOnly();
   168|            const showLine = LS.showLine();
   169|            const radius = LS.maxRadius();
   170|
   171|            tabPane.innerHTML = `
   172|                <div style="padding:10px;">
   173|                    <h3 style="margin:0 0 8px 0;">🔍 Google Link <small style="font-weight:normal;color:#aaa;">v1.20.4</small></h3>
   174|                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
   175|                        <wz-checkbox id="gl-chk-enabled" ${enabled ? 'checked' : ''}>⚡ Увімкнено</wz-checkbox>
   176|                        <wz-checkbox id="gl-chk-dist" ${showDist ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>📍 Відстань</wz-checkbox>
   177|                        <wz-checkbox id="gl-chk-unlinked" ${showUnlinked ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>🔗 Без посилань</wz-checkbox>
   178|                        <wz-checkbox id="gl-chk-line" ${showLine ? 'checked' : ''} ${!enabled ? 'disabled' : ''}>📏 Рулетка</wz-checkbox>
   179|                        <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;">
   180|                            Радіус: <input id="gl-radius" type="number" min="100" max="50000" step="100" value="${radius}" ${!enabled ? 'disabled' : ''} style="width:65px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;" /> м
   181|                        </span>
   182|                    </div>
   183|                    <div style="font-size:12px;color:#888;">${enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено'}</div>
   184|                    <div style="margin-top:12px;padding-top:6px;border-top:1px solid #eee;width:100%;box-sizing:border-box;">
   185|                        <div style="background:#005bbb;color:#fff;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">made in</div>
   186|                        <div style="background:#ffd500;color:#000;padding:8px;font-size:25px;text-align:center;width:100%;box-sizing:border-box;">Ukraine</div>
   187|                    </div>
   188|                </div>
   189|            `;
   190|
   191|            // Checkbox: enable/disable script
   192|            const chkEnabled = tabPane.querySelector('#gl-chk-enabled');
   193|            if (chkEnabled) {
   194|                chkEnabled.addEventListener('click', () => {
   195|                    const on = chkEnabled.hasAttribute('checked');
   196|                    on ? chkEnabled.removeAttribute('checked') : chkEnabled.setAttribute('checked', '');
   197|                    enabled = !on;
   198|                    localStorage.setItem(ENABLED_KEY, String(enabled));
   199|                    // Enable/disable other controls
   200|                    const chkD = tabPane.querySelector('#gl-chk-dist');
   201|                    const chkU = tabPane.querySelector('#gl-chk-unlinked');
   202|                    const chkL = tabPane.querySelector('#gl-chk-line');
   203|                    const rIn = tabPane.querySelector('#gl-radius');
   204|                    const hint = tabPane.querySelector('div[style*="color:#888"]');
   205|                    if (chkD) chkD.disabled = !enabled;
   206|                    if (chkU) chkU.disabled = !enabled;
   207|                    if (chkL) chkL.disabled = !enabled;
   208|                    if (rIn) rIn.disabled = !enabled;
   209|                    if (hint) hint.textContent = enabled ? 'Обери POI на карті для пошуку' : 'Скрипт вимкнено';
   210|                    if (enabled) {
   211|                        console.log(L, 'Enabled');
   212|                        if (LS.showUnlinkedOnly()) highlightUnlinked();
   213|                    } else {
   214|                        console.log(L, 'Disabled');
   215|                        resetHighlights();
   216|                        const p = document.getElementById('gl-p'); if (p) p.remove();
   217|                    }
   218|                });
   219|            }
   220|
   221|            // Checkbox: show distance
   222|            const chkDist = tabPane.querySelector('#gl-chk-dist');
   223|            if (chkDist) {
   224|                chkDist.addEventListener('click', () => {
   225|                    const on = chkDist.hasAttribute('checked');
   226|                    on ? chkDist.removeAttribute('checked') : chkDist.setAttribute('checked', '');
   227|                    LS.setShowDistance(!on);
   228|                });
   229|            }
   230|
   231|            // Checkbox: unlinked only
   232|            const chkUnlinked = tabPane.querySelector('#gl-chk-unlinked');
   233|            if (chkUnlinked) {
   234|                chkUnlinked.addEventListener('click', () => {
   235|                    const on = chkUnlinked.hasAttribute('checked');
   236|                    on ? chkUnlinked.removeAttribute('checked') : chkUnlinked.setAttribute('checked', '');
   237|                    LS.setShowUnlinkedOnly(!on);
   238|                    // Highlight/unhighlight on map
   239|                    if (LS.showUnlinkedOnly()) highlightUnlinked();
   240|                    else resetHighlights();
   241|                });
   242|            }
   243|
   244|
   245|            // Checkbox: show line
   246|            const chkLine = tabPane.querySelector('#gl-chk-line');
   247|            if (chkLine) {
   248|                chkLine.addEventListener('change', (e) => {
   249|                    LS.setShowLine(e.target.checked);
   250|                    console.log(L, 'showLine changed:', e.target.checked);
   251|                    if (!e.target.checked) clearHoverLine();
   252|                });
   253|            }
   254|            // Input: radius
   255|            const radiusEl = tabPane.querySelector('#gl-radius');
   256|            if (radiusEl) {
   257|                radiusEl.addEventListener('change', () => {
   258|                    const v = Number(radiusEl.value);
   259|                    if (v >= 100 && v <= 50000) LS.setMaxRadius(v);
   260|                });
   261|            }
   262|
   263|            console.log(L, 'Sidebar tab registered');
   264|        } catch (e) { console.warn(L, 'Sidebar tab failed:', e); }
   265|
   266|        // Google Places
   267|        try {
   268|            const g = uw.google?.maps?.places;
   269|            if (g?.PlacesService) {
   270|                const psDiv = document.createElement('div');
   271|                psDiv.style.display = 'none';
   272|                document.body.appendChild(psDiv);
   273|                ps = new g.PlacesService(psDiv);
   274|                console.log(L, 'PlacesService ok');
   275|            }
   276|        } catch (e) { console.warn(L, 'Google fail:', e); }
   277|
   278|        // Listen selection
   279|        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSel }); } catch (_) {}
   280|        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: onSel }); } catch (_) {}
   281|        try { uw.W.selectionManager.events.register('selectionchanged', null, onSel); } catch (_) {}
   282|        setInterval(poll, 1000);
   283|
   284|        // Highlight unlinked on map events (zoom, pan, save) — check enabled + checkbox
   285|        function applyHighlightsIfNeeded() {
   286|            if (!enabled) { resetHighlights(); return; }
   287|            if (LS.showUnlinkedOnly()) highlightUnlinked();
   288|            else resetHighlights();
   289|        }
   290|        try { uw.W.map.events.register('zoomend', null, applyHighlightsIfNeeded); } catch (_) {}
   291|        try { uw.W.map.events.register('moveend', null, applyHighlightsIfNeeded); } catch (_) {}
   292|        // Re-highlight after save (DOM redraws POI markers)
   293|        try { uw.W.model.events.register('save', null, () => setTimeout(applyHighlightsIfNeeded, 500)); } catch (_) {}
   294|        try { sdk.Events.on({ eventName: 'wme-after-save', eventHandler: () => setTimeout(applyHighlightsIfNeeded, 500) }); } catch (_) {}
   295|
   296|        console.log(L, '=== READY ===');
   297|    }
   298|
   299|    function getVid() {
   300|        // SDK API — only venue (POI), NOT place/RPP/address point
   301|        try {
   302|            const s = sdk?.Editing?.getSelection?.();
   303|            if (s?.ids?.length === 1) {
   304|                const t = String(s?.objectType || '').toLowerCase();
   305|                console.log(L, 'Selection:', { objectType: s.objectType, id: s.ids[0], type: t });
   306|                if (t === 'venue') {
   307|                    try {
   308|                        const v = sdk.DataModel.Venues.getById({ venueId: String(s.ids[0]) });
   309|                        const a = v?.attributes || {};
   310|                        // Also try legacy model (has more populated attributes)
   311|                        const lv = uw.W?.model?.venues?.getObjectById(s.ids[0]);
   312|                        const la = lv?.attributes || {};
   313|                        // Use legacy attributes if SDK ones are empty
   314|                        const use = (a.categories || a.residential !== undefined) ? a : la;
   315|                        // Skip address points (RPP/AT): residential, placeholder
   316|                        if (use.residential || use.isResidential) return null;
   317|                        if (use.isPlaceholder) return null;
   318|                        // Skip nature + parking
   319|                        if (isSkippedCategory(lv || v)) return null;
   320|                        // If "unlinked only" is on, skip POIs that have externalProviderIDs
   321|                        if (LS.showUnlinkedOnly()) {
   322|                            const ep = a.externalProviderIds || a.externalProviderIDs;
   323|                            if (ep?.length > 0) return null;
   324|                        }
   325|                    } catch (e) { console.warn(L, 'Venue check failed:', e); }
   326|                    return String(s.ids[0]);
   327|                }
   328|            }
   329|        } catch (_) {}
   330|        // Legacy API — only type === 'venue'
   331|        try {
   332|            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
   333|            if (f?.length === 1) {
   334|                const t = f[0]?.model?.type;
   335|                const attrs = f[0]?.model?.attributes;
   336|                if (t === 'venue' && !attrs?.isPlaceholder && !attrs?.residential && !attrs?.isResidential) {
   337|                    // Skip nature + parking
   338|                    if (isSkippedCategory(f[0]?.model)) return null;
   339|                    // If "unlinked only" is on, skip POIs that have externalProviderIDs
   340|                    if (LS.showUnlinkedOnly()) {
   341|                        const ep = attrs?.externalProviderIds || attrs?.externalProviderIDs;
   342|                        if (ep?.length > 0) return null;
   343|                    }
   344|                    return String(attrs?.id);
   345|                }
   346|            }
   347|        } catch (_) {}
   348|        return null;
   349|    }
   350|
   351|    function onSel() { if (enabled) setTimeout(poll, 200); }
   352|    function poll() {
   353|        if (!enabled) return;
   354|        const vid = getVid();
   355|        if (vid && vid !== lastVid) {
   356|            lastVid = vid;
   357|            console.log(L, 'Venue:', vid);
   358|            show(vid);
   359|        } else if (!vid && lastVid) {
   360|            lastVid = null;
   361|            const p = document.getElementById('gl-p'); if (p) p.remove();
   362|        }
   363|    }
   364|
   365|    function q(vid) {
   366|        try {
   367|            const a = sdk.DataModel.Venues.getAddress({ venueId: vid });
   368|            const r = [];
   369|            const s = a.street?.englishName || a.street?.name; if (s) r.push(s);
   370|            // Don't add houseNumber if street name already ends with it (e.g. "вул. X, 142")
   371|            const hn = a.houseNumber;
   372|            if (hn && s && !s.endsWith(hn)) r.push(hn);
   373|            const c = a.city?.englishName || a.city?.name; if (c) r.push(c);
   374|            if (a.country?.name) r.push(a.country.name);
   375|            return r.join(', ');
   376|        } catch (_) { return ''; }
   377|    }
   378|    function nm(vid) { try { return sdk.DataModel.Venues.getById({ venueId: vid })?.name || ''; } catch (_) { return ''; } }
   379|function ll(vid) {
   380|        try {
   381|            const v = sdk.DataModel.Venues.getById({ venueId: vid });
   382|            if (!v?.geometry) return null;
   383|            // Use turf.centroid for proper geometric center (matches E50)
   384|            const c = turf.centroid(v.geometry);
   385|            if (!c?.geometry?.coordinates) return null;
   386|            const lng = c.geometry.coordinates[0], lat = c.geometry.coordinates[1];
   387|            if (isFinite(lat) && isFinite(lng)) return { lat, lng };
   388|        } catch (_) {}
   389|        return null;
   390|    }
   391|    function hn(vid) { try { return sdk.DataModel.Venues.getAddress({ venueId: vid })?.houseNumber || ''; } catch (_) { return ''; } }
   392|    function st(vid) { try { const a = sdk.DataModel.Venues.getAddress({ venueId: vid }); return a?.street?.name || a?.street?.englishName || ''; } catch (_) { return ''; } }
   393|
   394|    // --- Get alternative (old) street names from the segment assigned to this venue ---
   395|    // WME stores alt street IDs in segment.attributes.streetIDs (array of IDs)
   396|    function getAltStreets(vid) {
   397|        const alts = [];
   398|        try {
   399|            const streetId = sdk?.DataModel?.Venues?.getAddress?.({ venueId: vid })?.street?.id;
   400|            if (!streetId) return alts;
   401|            console.log(L, 'Alt streets: streetId =', streetId);
   402|            // Find a segment with this primaryStreetID and read its streetIDs array
   403|            const segs = uw.W?.model?.segments?.objects;
   404|            if (segs) {
   405|                const seg = Object.values(segs).find(s => s?.attributes?.primaryStreetID == streetId);
   406|                if (seg?.attributes?.streetIDs?.length) {
   407|                    const streets = uw.W?.model?.streets?.objects || {};
   408|                    for (const sid of seg.attributes.streetIDs) {
   409|                        const name = streets[String(sid)]?.attributes?.name;
   410|                        if (name && !alts.includes(name)) alts.push(name);
   411|                    }
   412|                }
   413|            }
   414|        } catch (_) {}
   415|        console.log(L, 'Alt streets found:', alts.length, alts);
   416|        return alts;
   417|    }
   418|
   419|    const STREET_PREFIXES = /^(вул\.|вулиця|ул\.|улица|бульв\.|бульвар|просп\.|проспект|пров\.|провулок|пл\.|площа)\s*/i;
   420|    const STREET_SUFFIXES = /\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i;
   421|    // Group aliases for street type comparison (UA+RU)
   422|    const STREET_TYPE_MAP = {
   423|        'вул': 'street', 'вулиця': 'street', 'ул': 'street', 'улица': 'street',
   424|        'пров': 'lane', 'провулок': 'lane',
   425|        'просп': 'avenue', 'проспект': 'avenue',
   426|        'бульв': 'boulevard', 'бульвар': 'boulevard',
   427|        'пл': 'square', 'площа': 'square',
   428|    };
   429|    function extractStreetType(s) {
   430|        const raw = (s || '').trim().toLowerCase();
   431|        const TYPE_RE = /(?:^|[\s,])(?:провулок|пров\.?|вулиця|вул\.?|улица|ул\.?|проспект|просп\.?|бульвар|бульв\.?|площа|пл\.?)(?:[\s,]|$)/i;
   432|        const m = raw.match(TYPE_RE);
   433|        if (!m) return '';
   434|        const kw = m[0].trim().replace(/[\s,]/g, '').replace(/\.$/, '');
   435|        return STREET_TYPE_MAP[kw] || '';
   436|    }
   437|    function normStreet(s) { return (s || '').replace(STREET_PREFIXES, '').replace(STREET_SUFFIXES, '').trim().toLowerCase(); }
   438|
   439|    function extractStreet(formattedAddr) {
   440|        const first = (formattedAddr || '').split(',')[0] || '';
   441|        return first
   442|            .replace(STREET_PREFIXES, '')      // remove prefix: "вул. "
   443|            .replace(/\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i, '') // remove suffix
   444|            .trim()
   445|            .toLowerCase();
   446|    }
   447|
   448|    function extractHouseNum(formattedAddr) {
   449|        const parts = formattedAddr.split(',').map(s => s.trim());
   450|        for (const part of parts) {
   451|            // Match short house numbers: 1-4 digits, optional letter/suffix (e.g. "20", "20А", "12-б", "20/1")
   452|            // Reject long numbers (postal codes), parts with spaces (street names starting with digit)
   453|            if (/^\d{1,4}[\/\-]?\d?[а-яіa-z]?$/i.test(part)) return part.toLowerCase();
   454|        }
   455|        return '';
   456|    }
   457|
   458|    // Levenshtein distance (for fuzzy street matching)
   459|    function levenshtein(a, b) {
   460|        if (a === b) return 0;
   461|        if (!a.length) return b.length;
   462|        if (!b.length) return a.length;
   463|        const m = a.length, n = b.length;
   464|        const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
   465|        for (let i = 0; i <= m; i++) dp[i][0] = i;
   466|        for (let j = 0; j <= n; j++) dp[0][j] = j;
   467|        for (let i = 1; i <= m; i++) {
   468|            for (let j = 1; j <= n; j++) {
   469|                dp[i][j] = a[i-1] === b[j-1]
   470|                    ? dp[i-1][j-1]
   471|                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
   472|            }
   473|        }
   474|        return dp[m][n];
   475|    }
   476|
   477|    // Streets match if Levenshtein distance ≤ 3 (handles відрадний/отрадний, transliteration)
   478|    // typeMismatch: true if both have known types but they differ (e.g. провулок vs вулиця)
   479|    function streetMatch(s1, s2, typeMismatch) {
   480|        if (!s1 || !s2) return true;
   481|        if (s1 === s2) return true;
   482|        if (typeMismatch) return false;
   483|        return levenshtein(s1, s2) <= 3;
   484|    }
   485|
   486|    // --- Highlight unlinked POIs on map (like PlaceNames PLUS) ---
   487|    function resetHighlights() {
   488|        // Reset label divs
   489|        document.querySelectorAll('.map-marker[data-id]').forEach(div => {
   490|            div.style.color = '';
   491|            div.style.fontWeight = '';
   492|            div.style.textShadow = '';
   493|        });
   494|        // Reset SVG icon strokes
   495|        try {
   496|            const venues = uw.W?.model?.venues;
   497|            if (!venues) return;
   498|            const venueLayer = uw.W?.map?.venueLayer;
   499|            if (!venueLayer) return;
   500|            for (const mark in venues.objects) {
   501|