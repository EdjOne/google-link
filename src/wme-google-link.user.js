// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.7.1
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
    console.log('[GL] ===== v1.6.0 loaded =====');

    // Badge
    const b = document.createElement('div');
    b.textContent = 'GL v1.6.0';
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

    // Find "+ Прив'язати до Google" button — in "Зовнішні сервіси" section
    function findLinkBtn() {
        const panel = document.querySelector('#edit-panel') || document.body;

        // Find "Зовнішні сервіси" section first
        const sections = panel.querySelectorAll('div, section, fieldset');
        let googleSection = null;
        for (const sec of sections) {
            const t = (sec.textContent || '').toLowerCase();
            if (t.includes('зовнішні') && t.includes('сервіс') && t.length < 800) {
                googleSection = sec;
                break;
            }
        }
        if (!googleSection) { console.log(L, 'Section not found for button'); return null; }

        // Find clickable element with "прив" text within this section
        const els = googleSection.querySelectorAll('a, button, span, div, label');
        for (const el of els) {
            const t = (el.textContent || '').trim();
            if (t.length > 60) continue;
            if (t.match(/^\+?\s*прив/i) && t.toLowerCase().includes('google')) {
                console.log(L, 'Button found:', t, el.tagName); return el;
            }
        }

        // XPath within section
        const xp = document.evaluate(
            './/a[contains(text(),"Прив")] | .//button[contains(text(),"Прив")] | .//span[contains(text(),"Прив")]',
            googleSection, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        for (let i = 0; i < xp.snapshotLength; i++) {
            const el = xp.snapshotItem(i);
            if ((el.textContent || '').trim().length < 60) {
                console.log(L, 'XPath button:', el.textContent?.trim()); return el;
            }
        }

        return null;
    }

    // Find Google autocomplete input — ONLY in "Зовнішні сервіси" section
    function findInput() {
        const panel = document.querySelector('#edit-panel') || document.body;

        // Find "Зовнішні сервіси" section
        const sections = panel.querySelectorAll('div, section, fieldset');
        let googleSection = null;
        for (const sec of sections) {
            const t = (sec.textContent || '').toLowerCase();
            if (t.includes('зовнішні') && t.includes('сервіс') && t.length < 800) {
                googleSection = sec;
                break;
            }
        }
        if (!googleSection) { console.log(L, 'Зовнішні сервіси section not found'); return null; }
        console.log(L, 'Found Зовнішні сервіси section');

        // Look for input ONLY within this section
        const inputs = googleSection.querySelectorAll('input');
        for (const i of inputs) {
            const vis = i.offsetParent !== null || i.offsetWidth > 0;
            console.log(L, '  Input in section:', i.type, 'visible:', vis, 'value:', i.value?.substring(0, 20));
            if (vis && i.type !== 'checkbox' && i.type !== 'hidden') return i;
        }

        // Check shadow DOM within this section
        const els = googleSection.querySelectorAll('*');
        for (const el of els) {
            if (el.shadowRoot) {
                const si = el.shadowRoot.querySelector('input:not([type="checkbox"]):not([type="hidden"])');
                if (si) { console.log(L, 'Found shadow input'); return si; }
            }
        }

        // Also check for pac-target-input globally (Google autocomplete attaches to last focused input)
        const pac = document.querySelector('.pac-target-input');
        if (pac) { console.log(L, 'Found pac-target-input'); return pac; }

        console.log(L, 'No input found in Зовнішні сервіси');
        return null;
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
                d.onclick = async () => {
                    const addressText = (p.structured_formatting?.main_text || '') + ' ' + (p.structured_formatting?.secondary_text || p.description || '');
                    const addr = addressText.trim();
                    d.style.background = '#e8f0fe';
                    d.innerHTML += '<br><small style="color:#4285f4;">⏳ Автоматическое заполнение...</small>';

                    // Step 1: Find and click "+ Прив'язати до Google"
                    const btn = findLinkBtn();
                    if (!btn) {
                        d.innerHTML += '<br><small style="color:#ea4335;">❌ Кнопка «Прив\'язати до Google» не найдена. Вставь вручную.</small>';
                        navigator.clipboard.writeText(addr);
                        return;
                    }
                    console.log(L, 'Clicking button:', btn.textContent?.trim());
                    btn.click();

                    // Step 2: Wait for input to appear (check shadow DOM too)
                    let input = null;
                    for (let i = 0; i < 30; i++) {
                        await new Promise(r => setTimeout(r, 300));
                        input = findInput();
                        if (input) break;
                    }

                    if (!input) {
                        d.innerHTML += '<br><small style="color:#ea4335;">❌ Поле поиска не появилось. Вставь вручную.</small>';
                        navigator.clipboard.writeText(addr);
                        return;
                    }

                    console.log(L, 'Input found:', input.tagName, input.className);
                    d.innerHTML += '<br><small style="color:#4285f4;">⏳ Заполняю поле...</small>';

                    // Step 3: Fill input
                    input.focus();
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    for (let i = 0; i < addr.length; i++) {
                        input.value += addr[i];
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 20));
                    }
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    console.log(L, 'Input filled, waiting for suggestions...');

                    // Step 4: Wait for autocomplete dropdown
                    let clicked = false;
                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        const pac = document.querySelector('.pac-container');
                        if (pac && pac.style.display !== 'none') {
                            const items = pac.querySelectorAll('.pac-item');
                            if (items.length > 0) {
                                console.log(L, 'Clicking first suggestion:', items[0].textContent);
                                items[0].click();
                                clicked = true;
                                break;
                            }
                        }
                        // Also check shadow DOMs
                        const allEls = document.querySelectorAll('*');
                        for (const el of allEls) {
                            if (el.shadowRoot) {
                                const pac = el.shadowRoot.querySelector('.pac-container');
                                if (pac) {
                                    const items = pac.querySelectorAll('.pac-item');
                                    if (items.length > 0) {
                                        items[0].click();
                                        clicked = true;
                                        break;
                                    }
                                }
                            }
                        }
                        if (clicked) break;
                    }

                    if (clicked) {
                        d.innerHTML += '<br><small style="color:#34a853;">✅ Готово! Google Place привязан!</small>';
                    } else {
                        d.innerHTML += '<br><small style="color:#f9a825;">⚠️ Автовыбор не сработал. Выбери результат вручную в поле поиска.</small>';
                        navigator.clipboard.writeText(addr);
                    }
                };
                r.appendChild(d);
            }
        });
    }

    go().catch(e => { console.error(L, e); b.style.background = '#ea4335'; b.textContent = 'GL ERR'; });
})();
