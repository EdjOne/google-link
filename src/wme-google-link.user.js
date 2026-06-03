// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.7.8
// @description         Search Google Places by venue address
// @author              EdjOne
// @match               *://www.waze.com/editor*
// @match               *://www.waze.com/*/editor*
// @match               *://editor.waze.com/*
// @match               *://editor-beta.waze.com/*
// @match               *://beta.waze.com/*/editor*
// @grant               none
// @run-at              document-idle
// ==/UserScript==

(function () {
    console.log('[GL] ===== v1.7.8 loaded =====');

    // Badge
    const b = document.createElement('div');
    b.textContent = 'GL v1.7.8';
    b.style.cssText = 'position:fixed;bottom:5px;right:5px;background:#4285f4;color:#fff;padding:3px 8px;border-radius:4px;font:bold 12px Arial;z-index:99999;';
    document.body.appendChild(b);

    const L = '[GL]';
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let sdk = null, ac = null, lastVid = null;

    async function go() {
        console.log(L, 'init...');

        // Wait WME
        for (let i = 0; i < 120; i++) {
            if (uw.W?.map && uw.W?.model && uw.W?.selectionManager && typeof uw.getWmeSdk === 'function') break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (!uw.getWmeSdk) { console.error(L, 'SDK not found'); b.style.background = '#ea4335'; return; }

        sdk = uw.getWmeSdk({ scriptId: 'gl', scriptName: 'GL' });
        console.log(L, 'SDK ok');

        // Google
        try {
            const g = uw.google?.maps?.places;
            if (g?.AutocompleteService) {
                ac = new g.AutocompleteService();
                console.log(L, 'Google ok');
            }
        } catch (e) { console.warn(L, 'Google fail:', e); }

        // Listen selection
        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: onSel }); } catch (_) {}
        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: onSel }); } catch (_) {}
        try { uw.W.selectionManager.events.register('selectionchanged', null, onSel); } catch (_) {}
        setInterval(poll, 1000);

        b.style.background = '#34a853';
        b.textContent = 'GL ✓';
        console.log(L, '=== READY ===');
    }

    function getVid() {
        try {
            const s = sdk?.Editing?.getSelection?.();
            const t = String(s?.objectType || '').toLowerCase();
            if (s?.ids?.length === 1 && (t === 'venue' || t.endsWith('venue'))) return String(s.ids[0]);
        } catch (_) {}
        try {
            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (f?.length === 1 && f[0]?.model?.type === 'venue') return String(f[0].model.attributes?.id);
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

    // Find "+ Прив'язати до Google" button — search everywhere
    function findLinkBtn() {
        const panel = document.querySelector('#edit-panel') || document.body;

        // 1. XPath: find ANY element containing "Прив" and "Google"
        const xp = document.evaluate(
            '//*[contains(text(),"Прив") and contains(text(),"Google")]',
            panel, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        console.log(L, 'XPath results:', xp.snapshotLength);
        for (let i = 0; i < xp.snapshotLength; i++) {
            const el = xp.snapshotItem(i);
            const t = (el.textContent || '').trim();
            console.log(L, '  XPath:', t.substring(0, 50), '| tag:', el.tagName, '| len:', t.length);
            if (t.length < 80) { return el; }
        }

        // 2. Walk ALL elements, check direct text
        const all = panel.querySelectorAll('*');
        for (const el of all) {
            const own = Array.from(el.childNodes)
                .filter(n => n.nodeType === 3)
                .map(n => n.textContent.trim()).join(' ');
            if (own.length < 60 && own.match(/прив/i) && own.match(/google/i)) {
                console.log(L, 'Direct text:', own, el.tagName); return el;
            }
        }

        // 3. Full text match on short elements
        for (const el of all) {
            const t = (el.textContent || '').trim();
            if (t.length > 80) continue;
            const low = t.toLowerCase();
            if (low.includes('прив') && low.includes('google')) {
                console.log(L, 'Full text match:', t.substring(0, 50), el.tagName); return el;
            }
        }

        // 4. Debug: dump all text that contains "Google"
        console.log(L, '--- Elements with "Google" text ---');
        for (const el of all) {
            const t = (el.textContent || '').trim();
            if (t.length < 100 && t.toLowerCase().includes('google')) {
                console.log(L, '  >', t.substring(0, 60), '|', el.tagName, '| children:', el.children.length);
            }
        }

        return null;
    }

    // Find Google autocomplete input — edit panel first, then global fallback
    function findInput() {
        const editPanel = document.querySelector('#edit-panel');

        // Helper: deeply search for <input> in all shadow roots (unlimited nesting)
        function findInShadow(root, depth) {
            if (!root || depth > 5) return null;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
            let node;
            while (node = walker.nextNode()) {
                if (node.shadowRoot) {
                    // Check this shadow root
                    const inp = node.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                    if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) {
                        console.log(L, 'Found in shadow (depth ' + depth + '):', node.tagName, inp);
                        return inp;
                    }
                    // Recurse deeper
                    const deep = findInShadow(node.shadowRoot, depth + 1);
                    if (deep) return deep;
                }
            }
            return null;
        }

        if (editPanel) {
            // 1. Direct .pac-target-input in edit-panel
            let inp = editPanel.querySelector('.pac-target-input');
            if (inp) { console.log(L, 'Found: .pac-target-input in edit-panel'); return inp; }

            // 2. Direct visible <input> in edit-panel
            const panelInputs = editPanel.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]):not([type="number"])');
            for (const i of panelInputs) {
                const vis = (i.offsetParent !== null || i.offsetWidth > 0);
                const inOurPanel = i.closest('#gl-p');
                if (vis && !inOurPanel) {
                    console.log(L, 'Found direct input in edit-panel:', i.type, 'ph:', (i.placeholder || '').substring(0, 30));
                    return i;
                }
            }

            // 3. Deep shadow DOM search in edit-panel
            console.log(L, 'Searching shadow DOM in edit-panel...');
            const si = findInShadow(editPanel, 0);
            if (si) return si;

            // 4. Also try #left-panel
            const leftPanel = document.querySelector('#left-panel');
            if (leftPanel) {
                const li = findInShadow(leftPanel, 0);
                if (li) { console.log(L, 'Found in left-panel shadow'); return li; }
            }
        }

        // 5. Global .pac-target-input
        let inp = document.querySelector('.pac-target-input');
        if (inp) { console.log(L, 'Found: .pac-target-input (global)'); return inp; }

        // 6. Any visible input
        const allInputs = document.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"]):not([type="number"])');
        for (const i of allInputs) {
            const vis = (i.offsetParent !== null || i.offsetWidth > 0);
            const inOurPanel = i.closest('#gl-p');
            if (vis && !inOurPanel) {
                console.log(L, 'Fallback input:', i.type, 'ph:', (i.placeholder || '').substring(0, 30));
                return i;
            }
        }

        console.log(L, 'No input found anywhere');
        return null;
    }

    // Async wait-and-fill (non-blocking, called from sync onclick)
    function waitAndFill(addr, d, attempt) {
        if (attempt > 30) {
            d.innerHTML += '<br><small style="color:#f9a825;">⚠️ Input не появился. Вставь вручную.</small>';
            navigator.clipboard.writeText(addr);
            return;
        }
        setTimeout(() => {
            const input = findInput();
            if (input) {
                console.log(L, 'Input found:', input.tagName, 'filling char-by-char...');
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Заполняю...</small>';
                input.focus();
                input.click();
                // Clear first
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                // Type char by char to trigger Google autocomplete
                let i = 0;
                const typeChar = () => {
                    if (i < addr.length) {
                        input.value += addr[i];
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: addr[i], bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { key: addr[i], bubbles: true }));
                        i++;
                        setTimeout(typeChar, 30);
                    } else {
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log(L, 'Filled, waiting for pac-container...');
                        waitForPac(d, addr, 0);
                    }
                };
                typeChar();
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
                if (items.length > 0) {
                    console.log(L, 'Clicking suggestion:', items[0].textContent);
                    items[0].click();
                    d.innerHTML += '<br><small style="color:#34a853;">✅ Готово!</small>';
                    return;
                }
            }
            waitForPac(d, addr, attempt + 1);
        }, 500);
    }

    async function show(vid) {
        const old = document.getElementById('gl-p'); if (old) old.remove();
        const query = q(vid); if (!query) return;

        const p = document.createElement('div');
        p.id = 'gl-p';
        p.style.cssText = 'position:fixed;top:80px;right:20px;width:400px;max-height:520px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10000;font:13px/1.4 Arial;overflow:hidden;';
        p.innerHTML = `<div style="background:#4285f4;color:#fff;padding:8px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;"><span>🔍 Google Link</span><button onclick="this.closest('#gl-p').remove()" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">×</button></div><div style="padding:10px;"><div style="font-weight:bold;margin-bottom:6px;">${nm(vid) || 'POI'}</div><input id="gl-i" type="text" value="${query}" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;" /><div id="gl-r"><div style="color:#666;">Searching...</div></div><div id="gl-hint" style="margin-top:8px;padding:8px;background:#f8f9fa;border-radius:4px;font-size:12px;color:#555;display:none;"></div></div>`;
        document.body.appendChild(p);

        // Search
        if (!ac) {
            try { const g = uw.google?.maps?.places; if (g?.AutocompleteService) ac = new g.AutocompleteService(); } catch (_) {}
        }
        if (!ac) { document.getElementById('gl-r').innerHTML = '<div style="color:#ea4335;">Google API not ready</div>'; return; }

        const loc = ll(vid);
        const req = { input: query };
        if (loc) { try { req.location = new google.maps.LatLng(loc.lat, loc.lng); req.radius = 5000; } catch (_) {} }

        ac.getPlacePredictions(req, (preds, st) => {
            console.log(L, 'Results:', st, preds?.length || 0);
            const r = document.getElementById('gl-r');
            if (!r) return;
            if (st !== 'OK' || !preds?.length) { r.innerHTML = '<div style="color:#999;">No results</div>'; return; }
            r.innerHTML = '';
            for (const p of preds) {
                const d = document.createElement('div');
                d.style.cssText = 'padding:6px 8px;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:4px;cursor:pointer;';
                d.innerHTML = `<b>${p.structured_formatting?.main_text || p.description}</b><br><small style="color:#888;">${p.structured_formatting?.secondary_text || ''}</small><br><small style="color:#aaa;word-break:break-all;">${p.place_id}</small>`;
                d.onmouseenter = () => d.style.background = '#f0f6ff';
                d.onmouseleave = () => d.style.background = '#fff';
                d.onclick = () => {
                    try {
                        const addressText = (p.structured_formatting?.main_text || '') + ' ' + (p.structured_formatting?.secondary_text || p.description || '');
                        const addr = addressText.trim();
                        d.style.background = '#e8f0fe';
                        d.innerHTML += '<br><small style="color:#4285f4;">⏳ Автопоиск...</small>';

                        // Step 1: Find and click button
                        const btn = findLinkBtn();
                        if (!btn) {
                            d.innerHTML += '<br><small style="color:#ea4335;">❌ Кнопка не найдена. Вставь: ' + addr + '</small>';
                            navigator.clipboard.writeText(addr);
                            return;
                        }
                        console.log(L, 'Clicking:', btn.textContent?.trim());
                        btn.click();

                        // Step 2: Wait for input (async wait, non-blocking)
                        waitAndFill(addr, d, 0);
                    } catch (e) {
                        console.error(L, 'Click error:', e);
                        d.innerHTML += '<br><small style="color:#ea4335;">❌ Ошибка: ' + e.message + '</small>';
                    }
                };
                r.appendChild(d);
            }
        });
    }

    go().catch(e => { console.error(L, e); b.style.background = '#ea4335'; b.textContent = 'GL ERR'; });
})();
