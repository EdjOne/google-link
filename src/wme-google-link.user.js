// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.12.2
// @description         Search Google Places by venue address
// @author              EdjOne
// @match               *://www.waze.com/editor*
// @match               *://www.waze.com/*/editor*
// @match               *://editor.waze.com/*
// @match               *://editor-beta.waze.com/*
// @match               *://beta.waze.com/*/editor*
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_registerMenuCommand
// @run-at              document-start
// ==/UserScript==

(function () {
    console.log('[GL] ===== v1.12.0 loaded =====');

    // --- Enable/Disable toggle ---
    const ENABLED_KEY = 'gl-enabled';
    let enabled = GM_getValue(ENABLED_KEY, true);

    function updateMenu() {
        GM_registerMenuCommand(
            enabled ? '🟢 Google Link: ON' : '🔴 Google Link: OFF',
            () => {
                enabled = !enabled;
                GM_setValue(ENABLED_KEY, enabled);
                updateMenu();
                location.reload();
            }
        );
    }
    updateMenu();

    if (!enabled) { console.log('[GL] Disabled'); return; }

    // --- Settings (localStorage) ---
    const LS = {
        _k: (k) => 'gl_' + k,
        get: (k, def) => { const v = localStorage.getItem(LS._k(k)); return v === null ? def : JSON.parse(v); },
        set: (k, v) => { localStorage.setItem(LS._k(k), JSON.stringify(v)); },
        showDistance: () => LS.get('showDistance', true),
        setShowDistance: (v) => LS.set('showDistance', v),
        showUnlinkedOnly: () => LS.get('showUnlinkedOnly', false),
        setShowUnlinkedOnly: (v) => LS.set('showUnlinkedOnly', v),
        maxRadius: () => LS.get('maxRadius', 5000),
        setMaxRadius: (v) => LS.set('maxRadius', v),
    };

    // Force ALL shadow roots to be open
    function injectPatch() {
        try {
            const s = document.createElement('script');
            s.textContent = '(' + function() {
                var orig = Element.prototype.attachShadow;
                Element.prototype.attachShadow = function(init) {
                    var safe = init || {};
                    var mode = safe.mode === 'closed' ? 'open' : safe.mode;
                    return orig.call(this, Object.assign({}, safe, { mode: mode }));
                };
            } + ')();';
            (document.head || document.documentElement).prepend(s);
            s.remove();
        } catch (e) {}
    }
    if (document.head || document.documentElement) {
        injectPatch();
    } else {
        new MutationObserver(function(mutations, obs) {
            if (document.head || document.documentElement) { obs.disconnect(); injectPatch(); }
        }).observe(document, { childList: true, subtree: true });
    }

    const L = '[GL]';
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let sdk = null, ac = null, ps = null, lastVid = null;
    let tabLabel = null, tabPane = null;

    // Haversine distance in meters
    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = x => x * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    function fmtDist(m) {
        return m < 1000 ? Math.round(m) + ' м' : (m/1000).toFixed(1) + ' км';
    }

    async function go() {
        console.log(L, 'init...');

        for (let i = 0; i < 120; i++) {
            if (uw.W?.map && uw.W?.model && uw.W?.selectionManager && typeof uw.getWmeSdk === 'function') break;
            await new Promise(r => setTimeout(r, 500));
        }
        if (!uw.getWmeSdk) { console.error(L, 'SDK not found'); return; }

        sdk = uw.getWmeSdk({ scriptId: 'gl', scriptName: 'GL' });
        console.log(L, 'SDK ok');

        // --- Register sidebar tab ---
        try {
            const result = await sdk.Sidebar.registerScriptTab();
            tabLabel = result.tabLabel;
            tabPane = result.tabPane;
            tabLabel.innerText = '🔍 GL';
            tabLabel.title = 'Google Link — Search & link Google Places';

            // Settings section
            const showDist = LS.showDistance();
            const showUnlinked = LS.showUnlinkedOnly();
            const radius = LS.maxRadius();

            tabPane.innerHTML = `
                <div style="padding:10px;">
                    <h3 style="margin:0 0 8px 0;">🔍 Google Link</h3>
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
                        <wz-checkbox id="gl-chk-dist" ${showDist ? 'checked' : ''}>📍 Расстояние</wz-checkbox>
                        <wz-checkbox id="gl-chk-unlinked" ${showUnlinked ? 'checked' : ''}>🔗 Только нелinks</wz-checkbox>
                        <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;">
                            Радиус: <input id="gl-radius" type="number" min="100" max="50000" step="100" value="${radius}" style="width:65px;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;" /> м
                        </span>
                    </div>
                    <div style="font-size:12px;color:#888;">Выбери POI на карте для поиска</div>
                </div>
            `;

            // Checkbox: show distance
            const chkDist = tabPane.querySelector('#gl-chk-dist');
            if (chkDist) {
                chkDist.addEventListener('click', () => {
                    const on = chkDist.hasAttribute('checked');
                    on ? chkDist.removeAttribute('checked') : chkDist.setAttribute('checked', '');
                    LS.setShowDistance(!on);
                });
            }

            // Checkbox: unlinked only
            const chkUnlinked = tabPane.querySelector('#gl-chk-unlinked');
            if (chkUnlinked) {
                chkUnlinked.addEventListener('click', () => {
                    const on = chkUnlinked.hasAttribute('checked');
                    on ? chkUnlinked.removeAttribute('checked') : chkUnlinked.setAttribute('checked', '');
                    LS.setShowUnlinkedOnly(!on);
                    // Highlight/unhighlight on map
                    if (LS.showUnlinkedOnly()) highlightUnlinked();
                    else resetHighlights();
                });
            }

            // Input: radius
            const radiusEl = tabPane.querySelector('#gl-radius');
            if (radiusEl) {
                radiusEl.addEventListener('change', () => {
                    const v = Number(radiusEl.value);
                    if (v >= 100 && v <= 50000) LS.setMaxRadius(v);
                });
            }

            console.log(L, 'Sidebar tab registered');
        } catch (e) { console.warn(L, 'Sidebar tab failed:', e); }

        // Google Places
        try {
            const g = uw.google?.maps?.places;
            if (g?.PlacesService) {
                const psDiv = document.createElement('div');
                psDiv.style.display = 'none';
                document.body.appendChild(psDiv);
                ps = new g.PlacesService(psDiv);
                console.log(L, 'PlacesService ok');
            }
        } catch (e) { console.warn(L, 'Google fail:', e); }

        // Listen selection
        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSel }); } catch (_) {}
        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: onSel }); } catch (_) {}
        try { uw.W.selectionManager.events.register('selectionchanged', null, onSel); } catch (_) {}
        setInterval(poll, 1000);

        // Highlight unlinked on map events (zoom, pan)
        if (LS.showUnlinkedOnly()) {
            setTimeout(highlightUnlinked, 2000);
            try { uw.W.map.events.register('zoomend', null, highlightUnlinked); } catch (_) {}
            try { uw.W.map.events.register('moveend', null, highlightUnlinked); } catch (_) {}
        }

        console.log(L, '=== READY ===');
    }

    function getVid() {
        // SDK API — only venue (POI), NOT place/RPP
        try {
            const s = sdk?.Editing?.getSelection?.();
            if (s?.ids?.length === 1) {
                const t = String(s?.objectType || '').toLowerCase();
                if (t === 'venue') {
                    // If "unlinked only" is on, skip POIs that have externalProviderIDs
                    if (LS.showUnlinkedOnly()) {
                        try {
                            const v = sdk.DataModel.Venues.getById({ venueId: String(s.ids[0]) });
                            // SDK uses camelCase 'externalProviderIds', raw model uses 'externalProviderIDs'
                            const ep = v?.attributes?.externalProviderIds || v?.attributes?.externalProviderIDs;
                            console.log(L, 'Unlinked check:', s.ids[0], 'externalProviderIds:', ep?.length || 0, ep);
                            if (ep?.length > 0) return null;
                        } catch (e) { console.warn(L, 'Unlinked check failed:', e); }
                    }
                    return String(s.ids[0]);
                }
            }
        } catch (_) {}
        // Legacy API — only type === 'venue'
        try {
            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (f?.length === 1) {
                const t = f[0]?.model?.type;
                const attrs = f[0]?.model?.attributes;
                if (t === 'venue' && !attrs?.isPlaceholder) {
                    // If "unlinked only" is on, skip POIs that have externalProviderIDs
                    if (LS.showUnlinkedOnly()) {
                        const ep = attrs?.externalProviderIds || attrs?.externalProviderIDs;
                        if (ep?.length > 0) return null;
                    }
                    return String(attrs?.id);
                }
            }
        } catch (_) {}
        return null;
    }

    function onSel() { setTimeout(poll, 200); }
    function poll() {
        const vid = getVid();
        if (vid && vid !== lastVid) {
            lastVid = vid;
            console.log(L, 'Venue:', vid);
            show(vid);
        } else if (!vid && lastVid) {
            lastVid = null;
            const p = document.getElementById('gl-p'); if (p) p.remove();
        }
    }

    function q(vid) {
        try {
            const a = sdk.DataModel.Venues.getAddress({ venueId: vid });
            const r = [];
            const s = a.street?.englishName || a.street?.name; if (s) r.push(s);
            if (a.houseNumber) r.push(a.houseNumber);
            const c = a.city?.englishName || a.city?.name; if (c) r.push(c);
            if (a.country?.name) r.push(a.country.name);
            return r.join(', ');
        } catch (_) { return ''; }
    }
    function nm(vid) { try { return sdk.DataModel.Venues.getById({ venueId: vid })?.name || ''; } catch (_) { return ''; } }
    function ll(vid) { try { const v = sdk.DataModel.Venues.getById({ venueId: vid }); return v?.geometry?.coordinates ? { lat: v.geometry.coordinates[1], lng: v.geometry.coordinates[0] } : null; } catch (_) { return null; } }
    function hn(vid) { try { return sdk.DataModel.Venues.getAddress({ venueId: vid })?.houseNumber || ''; } catch (_) { return ''; } }
    function st(vid) { try { const a = sdk.DataModel.Venues.getAddress({ venueId: vid }); return a?.street?.name || a?.street?.englishName || ''; } catch (_) { return ''; } }

    const STREET_PREFIXES = /^(вул\.|вулиця|ул\.|улица|бульв\.|бульвар|просп\.|проспект|пров\.|провулок|пл\.|площа)\s*/i;
    function normStreet(s) { return (s || '').replace(STREET_PREFIXES, '').trim().toLowerCase(); }

    function extractStreet(formattedAddr) {
        const first = (formattedAddr || '').split(',')[0] || '';
        return first
            .replace(STREET_PREFIXES, '')      // remove prefix: "вул. "
            .replace(/\s+(вулиця|вул\.|улица|ул\.|бульвар|бульв\.|проспект|просп\.|провулок|пров\.|площа|пл\.)$/i, '') // remove suffix
            .trim()
            .toLowerCase();
    }

    function extractHouseNum(formattedAddr) {
        const parts = formattedAddr.split(',').map(s => s.trim());
        for (const part of parts) {
            if (/^\d/.test(part)) return part.toLowerCase();
        }
        return '';
    }

    // Levenshtein distance (for fuzzy street matching)
    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        const m = a.length, n = b.length;
        const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i-1] === b[j-1]
                    ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
        }
        return dp[m][n];
    }

    // Streets match if Levenshtein distance ≤ 2 (handles літавровий/литавровий, пров/провулок)
    function streetMatch(s1, s2) {
        if (!s1 || !s2) return true;
        if (s1 === s2) return true;
        return levenshtein(s1, s2) <= 2;
    }

    // --- Highlight unlinked POIs on map (like PlaceNames PLUS) ---
    function resetHighlights() {
        // Reset label divs
        document.querySelectorAll('.map-marker[data-id]').forEach(div => {
            div.style.color = '';
            div.style.fontWeight = '';
            div.style.textShadow = '';
        });
        // Reset SVG icon strokes
        try {
            const venues = uw.W?.model?.venues;
            if (!venues) return;
            const venueLayer = uw.W?.map?.venueLayer;
            if (!venueLayer) return;
            for (const mark in venues.objects) {
                if (venueLayer.featureMap.has(mark)) {
                    const featGeomId = venueLayer.featureMap.get(mark).geometry.id;
                    const svgIcon = document.getElementById(featGeomId);
                    if (svgIcon) {
                        svgIcon.setAttribute('stroke', 'white');
                        svgIcon.setAttribute('stroke-width', '2');
                    }
                }
            }
        } catch (_) {}
    }

    function highlightUnlinked() {
        resetHighlights();
        try {
            const venues = uw.W?.model?.venues;
            if (!venues) return;
            const venueLayer = uw.W?.map?.venueLayer;
            if (!venueLayer) return;
            for (const mark in venues.objects) {
                const venue = venues.getObjectById(mark);
                if (!venue) continue;
                const ep = venue.attributes?.externalProviderIDs;
                if (ep && ep.length > 0) continue; // skip linked
                const isRH = venue.attributes?.residential;
                if (isRH) continue; // skip residential (like PlaceNames PLUS)

                // Highlight SVG icon
                if (venueLayer.featureMap.has(mark)) {
                    const featGeomId = venueLayer.featureMap.get(mark).geometry.id;
                    const svgIcon = document.getElementById(featGeomId);
                    if (svgIcon) {
                        svgIcon.setAttribute('stroke', '#0ff');
                        svgIcon.setAttribute('stroke-width', '3');
                    }
                }

                // Highlight label div
                const pointDiv = document.querySelector(`.map-marker[data-id="${mark}"]`);
                if (pointDiv) {
                    pointDiv.style.color = '#0ff';
                    pointDiv.style.fontWeight = 'bold';
                    pointDiv.style.textShadow = '0 0 4px #0ff';
                }
            }
        } catch (e) { console.warn(L, 'highlightUnlinked failed:', e); }
    }

    // --- End highlighting ---
    function findLinkBtn() {
        const btn = document.querySelector('wz-button.external-provider-add-new');
        if (btn) return btn;
        function findInShadow(root, depth) {
            if (!root || depth > 8) return null;
            const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const node of all) {
                if (node.tagName === 'WZ-BUTTON' && node.classList?.contains('external-provider-add-new')) return node;
                if (node.shadowRoot) { const f = findInShadow(node.shadowRoot, depth + 1); if (f) return f; }
            }
            return null;
        }
        let found = findInShadow(document, 0);
        if (found) return found;
        function findBtnByText(root, depth) {
            if (!root || depth > 8) return null;
            const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const node of all) {
                if (node.tagName === 'WZ-BUTTON' && node.shadowRoot) {
                    const t = (node.shadowRoot.textContent || '').trim().toLowerCase();
                    if (t.includes('google') && (t.includes('прив') || t.includes('связ'))) return node;
                }
                if (node.shadowRoot) { const f = findBtnByText(node.shadowRoot, depth + 1); if (f) return f; }
            }
            return null;
        }
        return findBtnByText(document, 0);
    }

    function findInput() {
        const form = document.querySelector('.external-provider-edit-form');
        if (form) {
            const ac = form.querySelector('wz-autocomplete');
            if (ac && ac.shadowRoot) {
                const inp = ac.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                if (inp) return inp;
            }
        }
        const allWzAC = document.querySelectorAll('wz-autocomplete');
        for (const ac of allWzAC) {
            if (ac.shadowRoot) {
                const inp = ac.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) return inp;
            }
        }
        const editPanel = document.querySelector('#edit-panel');
        if (editPanel) {
            function findInShadow(root, depth) {
                if (!root || depth > 8) return null;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                let node;
                while (node = walker.nextNode()) {
                    if (node.shadowRoot) {
                        if ((node.tagName || '').toUpperCase() === 'WZ-AUTOCOMPLETE') {
                            const inp = node.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                            if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) return inp;
                        }
                        const deep = findInShadow(node.shadowRoot, depth + 1);
                        if (deep) return deep;
                    }
                }
                return null;
            }
            const si = findInShadow(editPanel, 0);
            if (si) return si;
        }
        let gpac = document.querySelector('.pac-target-input');
        if (gpac) return gpac;
        return null;
    }

    function waitAndFill(addr, d, attempt) {
        if (attempt > 20) {
            d.innerHTML += '<br><small style="color:#f9a825;">⚠️ Поле не появилось. Вставь вручную: ' + addr + '</small>';
            navigator.clipboard.writeText(addr);
            return;
        }
        setTimeout(() => {
            let input = null;
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active !== document.body) {
                input = active;
            }
            if (!input && active && active.shadowRoot) {
                const si = active.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                if (si) input = si;
            }
            if (!input) input = findInput();
            if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) {
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Заполняю...</small>';
                input.focus(); input.click();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                let i = 0;
                const typeChar = () => {
                    if (i < addr.length) {
                        input.value += addr[i];
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: addr[i], bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { key: addr[i], bubbles: true }));
                        i++; setTimeout(typeChar, 30);
                    } else {
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        waitForPac(d, addr, 0);
                    }
                };
                typeChar();
            } else if (active && active.tagName && active.tagName.includes('-') && active !== document.body) {
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Заполняю...</small>';
                active.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, addr);
                setTimeout(() => {
                    const el = document.activeElement;
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    d.innerHTML += '<br><small style="color:#34a853;">✅ Выбрано! Проверь и сохрани.</small>';
                }, 2000);
            } else {
                waitAndFill(addr, d, attempt + 1);
            }
        }, 300);
    }

    function waitForPac(d, addr, attempt) {
        if (attempt > 20) {
            d.innerHTML += '<br><small style="color:#f9a825;">⚠️ Выбери результат вручную.</small>';
            navigator.clipboard.writeText(addr);
            return;
        }
        setTimeout(() => {
            const pac = document.querySelector('.pac-container');
            if (pac && pac.style.display !== 'none') {
                const items = pac.querySelectorAll('.pac-item');
                if (items.length > 0) { items[0].click(); d.innerHTML += '<br><small style="color:#34a853;">✅ Готово!</small>'; return; }
            }
            const ac = document.querySelector('.external-provider-edit-form wz-autocomplete') || document.querySelector('wz-autocomplete');
            if (ac && ac.shadowRoot) {
                const items = ac.shadowRoot.querySelectorAll('wz-list-item, .option, [role="option"], li');
                if (items.length > 0) { items[0].click(); d.innerHTML += '<br><small style="color:#34a853;">✅ Готово!</small>'; return; }
            }
            const lists = document.querySelectorAll('.pac-container, [role="listbox"], .dropdown-menu, wz-list');
            for (const list of lists) {
                const items = list.querySelectorAll('.pac-item, [role="option"], wz-list-item, li');
                if (items.length > 0) { items[0].click(); d.innerHTML += '<br><small style="color:#34a853;">✅ Готово!</small>'; return; }
            }
            waitForPac(d, addr, attempt + 1);
        }, 500);
    }

    function linkPlace(addr, placeId, d) {
        try {
            const expandBtn = document.querySelector('.external-providers-control .panel-title, .external-providers-control summary, .external-providers-control [data-toggle]');
            if (expandBtn) expandBtn.click();
            findBtnWithRetry(addr, d, 0);
        } catch (e) {
            d.innerHTML += '<br><small style="color:#ea4335;">❌ ' + e.message + '</small>';
        }
    }

    function findBtnWithRetry(addr, d, attempt) {
        if (attempt > 10) {
            d.innerHTML += '<br><small style="color:#ea4335;">❌ Кнопка не найдена.</small>';
            return;
        }
        setTimeout(() => {
            const btn = findLinkBtn();
            if (btn) {
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Открываю поиск...</small>';
                btn.click();
                waitAndFill(addr, d, 0);
            } else {
                findBtnWithRetry(addr, d, attempt + 1);
            }
        }, attempt === 0 ? 500 : 300);
    }

    async function show(vid) {
        // Remove old floating panel
        const old = document.getElementById('gl-p'); if (old) old.remove();

        const query = q(vid);
        if (!query) return;

        // Create floating panel
        const p = document.createElement('div');
        p.id = 'gl-p';
        p.style.cssText = 'position:fixed;top:80px;right:20px;width:400px;max-height:520px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10000;font:13px/1.4 Arial;overflow:hidden;display:flex;flex-direction:column;';
        p.innerHTML = `
            <div style="background:#4285f4;color:#fff;padding:8px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
                <span>🔍 Google Link</span>
                <button id="gl-close" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">×</button>
            </div>
            <div style="padding:10px;">
                <div style="font-weight:bold;margin-bottom:2px;">${nm(vid) || 'POI'}</div>
                <div style="color:#888;font-size:11px;margin-bottom:6px;word-break:break-all;">${query}</div>
                <div id="gl-r"><div style="color:#666;">⏳ Поиск...</div></div>
            </div>
        `;
        document.body.appendChild(p);
        document.getElementById('gl-close').addEventListener('click', () => p.remove());

        // Ensure PlacesService
        if (!ps) {
            try {
                const g = uw.google?.maps?.places;
                if (g?.PlacesService) {
                    const psDiv = document.createElement('div');
                    psDiv.style.display = 'none';
                    document.body.appendChild(psDiv);
                    ps = new g.PlacesService(psDiv);
                }
            } catch (_) {}
        }
        if (!ps) { document.getElementById('gl-r').innerHTML = '<div style="color:#ea4335;">Google Places API not ready</div>'; return; }

        const loc = ll(vid);
        const radius = LS.maxRadius();
        const poiHN = hn(vid).toLowerCase();
        const poiStreet = normStreet(st(vid));
        const opts = { query: query };
        if (loc) { try { opts.location = new google.maps.LatLng(loc.lat, loc.lng); opts.radius = radius; } catch (_) {} }

        ps.textSearch(opts, (results, status) => {
            console.log(L, 'Results:', status, results?.length || 0);
            const r = document.getElementById('gl-r');
            if (!r) return;
            if (status !== 'OK' || !results?.length) { r.innerHTML = '<div style="color:#999;">Ничего не найдено</div>'; return; }
            r.innerHTML = '';

            const showDist = LS.showDistance();
            let shown = 0;
            for (const res of results) {
                const gHN = extractHouseNum(res.formatted_address || '');
                const gStreet = extractStreet(res.formatted_address || '');

                // Skip if too far from POI
                if (loc && res.geometry?.location) {
                    try {
                        const dist = haversine(loc.lat, loc.lng, res.geometry.location.lat(), res.geometry.location.lng());
                        if (dist > radius) {
                            console.log(L, 'Skip (too far):', res.name, '—', fmtDist(dist));
                            continue;
                        }
                    } catch (_) {}
                }

                // Skip if POI has house number but Google result doesn't
                if (poiHN && !gHN) {
                    console.log(L, 'Skip (no house number):', res.name);
                    continue;
                }
                // Skip if house number doesn't match
                if (poiHN && gHN && gHN !== poiHN) {
                    console.log(L, 'Skip (number mismatch):', gHN, '≠', poiHN);
                    continue;
                }
                // Skip if POI has street but Google street doesn't match (fuzzy)
                if (poiStreet && gStreet && !streetMatch(poiStreet, gStreet)) {
                    console.log(L, 'Skip (street mismatch):', gStreet, '≠', poiStreet);
                    continue;
                }

                const d = document.createElement('div');
                d.style.cssText = 'padding:6px 8px;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:4px;cursor:pointer;';

                let distHtml = '';
                if (showDist && loc && res.geometry?.location) {
                    try {
                        const rl = res.geometry.location;
                        const dist = haversine(loc.lat, loc.lng, rl.lat(), rl.lng());
                        const color = dist < 50 ? '#34a853' : dist < 300 ? '#f9a825' : '#ea4335';
                        distHtml = `<br><small style="color:${color};">📍 ${fmtDist(dist)}</small>`;
                    } catch (_) {}
                }

                d.innerHTML = `<b>${res.name || ''}</b><br><small style="color:#888;">${res.formatted_address || ''}</small>${distHtml}<br><small style="color:#aaa;word-break:break-all;font-size:10px;">${res.place_id}</small>`;
                d.onmouseenter = () => d.style.background = '#f0f6ff';
                d.onmouseleave = () => d.style.background = '#fff';
                d.onclick = () => {
                    try {
                        const placeId = res.place_id;
                        const addr = res.formatted_address || res.name || '';
                        d.style.background = '#e8f0fe';
                        linkPlace(addr, placeId, d);
                    } catch (e) {
                        d.innerHTML += '<br><small style="color:#ea4335;">❌ ' + e.message + '</small>';
                    }
                };
                r.appendChild(d);
                shown++;
            }
            if (shown === 0) {
                r.innerHTML = '<div style="color:#999;">Нет совпадений' + (poiStreet || poiHN ? ' — ' + (poiStreet ? '«' + poiStreet + '»' : '') + (poiHN ? ', №' + poiHN : '') : '') + '</div>';
            }
        });
    }

    go().catch(e => console.error(L, e));
})();
