// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.8.6
// @description         Search Google Places by venue address
// @author              EdjOne
// @match               *://www.waze.com/editor*
// @match               *://www.waze.com/*/editor*
// @match               *://editor.waze.com/*
// @match               *://editor-beta.waze.com/*
// @match               *://beta.waze.com/*/editor*
// @grant               none
// @run-at              document-start
// ==/UserScript==

(function () {
    console.log('[GL] ===== v1.8.6 loaded =====');

    // Force ALL shadow roots to be open — must run BEFORE any web components
    // At document-start, document.head may not exist yet, so use MutationObserver
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
            console.log('[GL] attachShadow patch injected');
        } catch (e) { console.warn('[GL] patch injection failed:', e); }
    }

    if (document.head || document.documentElement) {
        injectPatch();
    } else {
        // document-start: wait for <head> to appear
        new MutationObserver(function(mutations, obs) {
            if (document.head || document.documentElement) {
                obs.disconnect();
                injectPatch();
            }
        }).observe(document, { childList: true, subtree: true });
    }

    // Badge
    const b = document.createElement('div');
    b.textContent = 'GL v1.8.6';
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

    // Find "+ Прив'язати до Google" / "+ Связать с Google" button
    function findLinkBtn() {
        // 1. Exact selector from WME DOM
        const btn = document.querySelector('wz-button.external-provider-add-new');
        if (btn) { console.log(L, 'Found button: wz-button.external-provider-add-new'); return btn; }

        // 2. Search inside edit-panel shadow DOM
        const editPanel = document.querySelector('#edit-panel');
        if (editPanel) {
            function findInShadow(root, depth) {
                if (!root || depth > 5) return null;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                let node;
                while (node = walker.nextNode()) {
                    if (node.shadowRoot) {
                        const sr = node.shadowRoot;
                        const tag = (node.tagName || '').toUpperCase();
                        if (tag === 'WZ-BUTTON') {
                            const t = (sr.textContent || '').trim();
                            const low = t.toLowerCase();
                            if (low.includes('google') && (low.includes('прив') || low.includes('связ'))) {
                                console.log(L, 'Found button in shadow:', tag, t);
                                return node;
                            }
                        }
                        const deep = findInShadow(sr, depth + 1);
                        if (deep) return deep;
                    }
                }
                return null;
            }
            const wzBtn = findInShadow(editPanel, 0);
            if (wzBtn) return wzBtn;
        }

        // 3. Fallback: text search in edit-panel
        if (editPanel) {
            const all = editPanel.querySelectorAll('*');
            for (const el of all) {
                if (el.tagName === 'SCRIPT') continue;
                const t = (el.textContent || '').trim();
                if (t.length < 80 && t.toLowerCase().includes('google') && (t.toLowerCase().includes('прив') || t.toLowerCase().includes('связ'))) {
                    console.log(L, 'Found button via text:', t.substring(0, 50), el.tagName);
                    return el;
                }
            }
        }

        console.log(L, 'Button not found');
        return null;
    }

    // Find Google autocomplete input — exact WME DOM structure
    function findInput() {
        // 1. Try light DOM first: .external-provider-edit-form → wz-autocomplete
        const form = document.querySelector('.external-provider-edit-form');
        if (form) {
            const ac = form.querySelector('wz-autocomplete');
            if (ac && ac.shadowRoot) {
                const inp = ac.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                if (inp) { console.log(L, 'Found: input in .external-provider-edit-form'); return inp; }
            }
        }

        // 2. Search ALL wz-autocomplete elements (they might be in shadow DOM of wz-list-item)
        const allWzAC = document.querySelectorAll('wz-autocomplete');
        for (const ac of allWzAC) {
            if (ac.shadowRoot) {
                const inp = ac.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) {
                    console.log(L, 'Found: input in wz-autocomplete', ac.className || '');
                    return inp;
                }
            }
        }

        // 3. Deep shadow DOM search: find wz-autocomplete inside any shadow root
        const editPanel = document.querySelector('#edit-panel');
        if (editPanel) {
            function findInShadow(root, depth) {
                if (!root || depth > 8) return null;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                let node;
                while (node = walker.nextNode()) {
                    if (node.shadowRoot) {
                        const sr = node.shadowRoot;
                        const tag = (node.tagName || '').toUpperCase();
                        // Look for wz-autocomplete specifically
                        if (tag === 'WZ-AUTOCOMPLETE') {
                            const inp = sr.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                            if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) {
                                console.log(L, 'Found: input in WZ-AUTOCOMPLETE (depth ' + depth + ')');
                                return inp;
                            }
                        }
                        const deep = findInShadow(sr, depth + 1);
                        if (deep) return deep;
                    }
                }
                return null;
            }
            const si = findInShadow(editPanel, 0);
            if (si) return si;
        }

        // 4. Global .pac-target-input (Google autocomplete creates this)
        let gpac = document.querySelector('.pac-target-input');
        if (gpac) { console.log(L, 'Found: .pac-target-input (global)'); return gpac; }

        console.log(L, 'No input found');
        return null;
    }

    // Async wait-and-fill — type into whatever element has focus after button click
    function waitAndFill(addr, d, attempt) {
        if (attempt > 20) {
            d.innerHTML += '<br><small style="color:#f9a825;">⚠️ Поле не появилось. Вставь вручную: ' + addr + '</small>';
            navigator.clipboard.writeText(addr);
            return;
        }
        setTimeout(() => {
            let input = null;

            // 1. Try focused element
            const active = document.activeElement;
            if (active && active !== document.body && !d.contains(active)) {
                if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
                    input = active;
                    console.log(L, 'Using activeElement:', active.tagName, active.placeholder || '');
                } else if (active.shadowRoot) {
                    // Web component — find input inside its shadow root
                    const si = active.shadowRoot.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="number"])');
                    if (si) {
                        input = si;
                        console.log(L, 'Using activeElement shadow input:', active.tagName);
                    }
                }
            }

            // 2. Try findInput()
            if (!input) input = findInput();

            if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) {
                console.log(L, 'Input found:', input.tagName, 'filling...');
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Заполняю...</small>';
                input.focus();
                input.click();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
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
                if (attempt % 5 === 0) console.log(L, 'Waiting for input... attempt', attempt, 'active:', active?.tagName || 'none');
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

    function linkPlace(addr, placeId, d) {
        try {
            console.log(L, 'linkPlace:', placeId, addr);

            // Step 1: Try to expand "Внешние сервисы" section first
            const expandBtn = document.querySelector('.external-providers-control .panel-title, .external-providers-control summary, .external-providers-control [data-toggle]');
            if (expandBtn) {
                console.log(L, 'Expanding external providers section...');
                expandBtn.click();
            }

            // Step 2: Find and click the button (with retries)
            findBtnWithRetry(addr, d, 0);
        } catch (e) {
            console.error(L, 'linkPlace error:', e);
            d.innerHTML += '<br><small style="color:#ea4335;">❌ ' + e.message + '</small>';
        }
    }

    function findBtnWithRetry(addr, d, attempt) {
        if (attempt > 10) {
            d.innerHTML += '<br><small style="color:#ea4335;">❌ Кнопка не найдена. Открой «Внешние сервисы» вручную.</small>';
            return;
        }
        setTimeout(() => {
            const btn = findLinkBtn();
            if (btn) {
                console.log(L, 'Button found, clicking...');
                d.innerHTML += '<br><small style="color:#4285f4;">⏳ Открываю поиск...</small>';
                btn.click();
                // Wait for autocomplete to appear
                waitAndFill(addr, d, 0);
            } else {
                console.log(L, 'Button not found, retry', attempt);
                findBtnWithRetry(addr, d, attempt + 1);
            }
        }, attempt === 0 ? 500 : 300);
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
                        const placeId = p.place_id;
                        const mainText = p.structured_formatting?.main_text || p.description || '';
                        const secText = p.structured_formatting?.secondary_text || '';
                        const addr = (mainText + ' ' + secText).trim();
                        d.style.background = '#e8f0fe';
                        linkPlace(addr, placeId, d);
                    } catch (e) {
                        console.error(L, 'Click error:', e);
                        d.innerHTML += '<br><small style="color:#ea4335;">❌ ' + e.message + '</small>';
                    }
                };
                r.appendChild(d);
            }
        });
    }

    go().catch(e => { console.error(L, e); b.style.background = '#ea4335'; b.textContent = 'GL ERR'; });
})();
