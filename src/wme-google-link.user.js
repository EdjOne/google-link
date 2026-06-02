// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.4.0
// @description         Search Google Places by venue address + copy Place ID
// @description:uk      Пошук Google Places за адресою + копіювання Place ID
// @author              EdjOne
// @match               https://www.waze.com/editor*
// @match               https://www.waze.com/*/editor*
// @match               https://editor.waze.com/*
// @match               https://editor-beta.waze.com/*
// @match               https://beta.waze.com/*/editor*
// @grant               none
// @run-at              document-end
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[GL]';
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    let sdk = null;
    let _lastVenueId = null;
    let autocompleteService = null;

    // ── Wait for WME + SDK ──────────────────────
    async function waitForSdk() {
        const start = Date.now();
        while (!(uw.W?.map && uw.W?.model && uw.W?.selectionManager)) {
            if (Date.now() - start > 60000) throw new Error('WME not ready');
            await new Promise(r => setTimeout(r, 250));
        }
        if (uw.SDK_INITIALIZED?.then) await uw.SDK_INITIALIZED;
        while (typeof uw.getWmeSdk !== 'function') {
            if (Date.now() - start > 60000) throw new Error('SDK not ready');
            await new Promise(r => setTimeout(r, 250));
        }
    }

    function initSDK() {
        return uw.getWmeSdk({ scriptId: 'google-link', scriptName: 'Google Link' });
    }

    // ── Get selected venue ID ───────────────────
    function getSelectedVenueId() {
        try {
            const sel = sdk?.Editing?.getSelection?.();
            const t = String(sel?.objectType || '').toLowerCase();
            if (sel?.ids?.length === 1 && (t === 'venue' || t.endsWith('venue')))
                return String(sel.ids[0]);
        } catch (_) {}
        try {
            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (f?.length === 1 && f[0]?.model?.type === 'venue')
                return String(f[0].model.attributes?.id);
        } catch (_) {}
        return null;
    }

    // ── Build query from venue address ──────────
    function buildQuery(venueId) {
        try {
            const a = sdk.DataModel.Venues.getAddress({ venueId });
            const p = [];
            const street = a.street?.englishName || a.street?.name;
            if (street) p.push(street);
            if (a.houseNumber) p.push(a.houseNumber);
            const city = a.city?.englishName || a.city?.name;
            if (city) p.push(city);
            if (a.country?.name) p.push(a.country.name);
            const q = p.join(', ');
            console.log(LOG_PREFIX, 'Query:', q);
            return q;
        } catch (e) { return null; }
    }

    function getVenueLatLng(venueId) {
        try {
            const v = sdk.DataModel.Venues.getById({ venueId });
            return v?.geometry?.coordinates
                ? { lat: v.geometry.coordinates[1], lng: v.geometry.coordinates[0] }
                : null;
        } catch (_) { return null; }
    }

    // ── Google Places search ────────────────────
    function initGoogle() {
        const g = uw.google?.maps?.places || window.google?.maps?.places;
        if (!g?.AutocompleteService) return false;
        autocompleteService = new g.AutocompleteService();
        return true;
    }

    function searchGoogle(query, location) {
        return new Promise(resolve => {
            if (!autocompleteService) { resolve([]); return; }
            const req = { input: query };
            if (location) {
                const L = uw.google?.maps?.LatLng;
                if (L) { req.location = new L(location.lat, location.lng); req.radius = 5000; }
            }
            autocompleteService.getPlacePredictions(req, (preds, status) => {
                console.log(LOG_PREFIX, 'Google:', status, preds?.length || 0, 'results');
                resolve(status === 'OK' ? (preds || []) : []);
            });
        });
    }

    // ── Check if venue already linked ───────────
    function isAlreadyLinked(venueId) {
        try {
            const v = sdk.DataModel.Venues.getById({ venueId });
            const ids = v?.externalProviderIds || v?.externalProviderIDs || [];
            return Array.isArray(ids) && ids.length > 0;
        } catch (_) { return false; }
    }

    // ── Panel UI ────────────────────────────────
    function ensurePanel() {
        let p = document.getElementById('gl-panel');
        if (p) return p;

        p = document.createElement('div');
        p.id = 'gl-panel';
        p.style.cssText = `
            position:fixed;top:80px;right:20px;width:380px;max-height:520px;
            background:#fff;border:1px solid #ccc;border-radius:8px;
            box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;
            font:13px/1.4 Arial,sans-serif;overflow:hidden;display:none;
        `;
        p.innerHTML = `
            <div id="gl-hdr" style="background:#4285f4;color:#fff;padding:10px 14px;
                cursor:move;display:flex;justify-content:space-between;align-items:center;
                font-weight:bold;font-size:14px;">
                <span>🔍 Google Link</span>
                <button id="gl-x" style="background:none;border:none;color:#fff;
                    font-size:18px;cursor:pointer;padding:0 4px;">×</button>
            </div>
            <div style="padding:12px;overflow-y:auto;max-height:450px;">
                <div id="gl-st" style="color:#666;margin-bottom:8px;">Select a POI</div>
                <div style="margin-bottom:10px;display:flex;gap:6px;">
                    <input id="gl-q" type="text" placeholder="Search query..." style="
                        flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:4px;
                        font-size:13px;box-sizing:border-box;" />
                    <button id="gl-s" style="padding:6px 12px;background:#4285f4;color:#fff;
                        border:none;border-radius:4px;cursor:pointer;font-size:13px;">🔍</button>
                </div>
                <div id="gl-r"></div>
            </div>
        `;
        document.body.appendChild(p);

        // Drag
        let drag = false, sx, sy, sl, st;
        p.querySelector('#gl-hdr').onmousedown = e => {
            if (e.target.id === 'gl-x') return;
            drag = true; sx = e.clientX; sy = e.clientY;
            const r = p.getBoundingClientRect(); sl = r.left; st = r.top;
            e.preventDefault();
        };
        document.onmousemove = e => {
            if (!drag) return;
            p.style.left = (sl + e.clientX - sx) + 'px';
            p.style.top = (st + e.clientY - sy) + 'px';
            p.style.right = 'auto';
        };
        document.onmouseup = () => drag = false;

        p.querySelector('#gl-x').onclick = () => { p.style.display = 'none'; };
        p.querySelector('#gl-s').onclick = () => doSearch();
        p.querySelector('#gl-q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };

        return p;
    }

    async function doSearch() {
        const panel = ensurePanel();
        const q = panel.querySelector('#gl-q').value;
        if (!q) return;
        const res = panel.querySelector('#gl-r');
        res.innerHTML = '<div style="color:#666;padding:4px;">Searching...</div>';

        if (!autocompleteService && !initGoogle()) {
            res.innerHTML = '<div style="color:#ea4335;padding:4px;">Google API not loaded yet. Wait and retry.</div>';
            return;
        }

        const loc = _lastVenueId ? getVenueLatLng(_lastVenueId) : null;
        const preds = await searchGoogle(q, loc);

        if (!preds.length) {
            res.innerHTML = '<div style="color:#999;padding:4px;">No results</div>';
            return;
        }

        res.innerHTML = '';
        for (const p of preds) {
            const name = p.structured_formatting?.main_text || p.description;
            const sub = p.structured_formatting?.secondary_text || '';
            const pid = p.place_id;

            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 10px;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:6px;cursor:pointer;transition:background .15s;';
            item.innerHTML = `
                <div style="font-weight:500;color:#333;">${name}</div>
                <div style="font-size:11px;color:#888;">${sub}</div>
                <div style="font-size:10px;color:#aaa;word-break:break-all;">${pid}</div>
                <div style="margin-top:4px;display:flex;gap:4px;">
                    <button class="gl-copy" data-pid="${pid}" style="
                        padding:3px 8px;background:#34a853;color:#fff;border:none;
                        border-radius:3px;cursor:pointer;font-size:11px;">📋 Copy Place ID</button>
                    <button class="gl-gmap" data-pid="${pid}" style="
                        padding:3px 8px;background:#4285f4;color:#fff;border:none;
                        border-radius:3px;cursor:pointer;font-size:11px;">🗺 Open Maps</button>
                </div>
            `;

            item.onmouseenter = () => item.style.background = '#f0f6ff';
            item.onmouseleave = () => item.style.background = '#fff';

            // Copy Place ID
            item.querySelector('.gl-copy').onclick = e => {
                e.stopPropagation();
                navigator.clipboard.writeText(pid).then(() => {
                    e.target.textContent = '✅ Copied!';
                    e.target.style.background = '#999';
                    setTimeout(() => { e.target.textContent = '📋 Copy Place ID'; e.target.style.background = '#34a853'; }, 2000);
                });
            };

            // Open in Google Maps
            item.querySelector('.gl-gmap').onclick = e => {
                e.stopPropagation();
                window.open(`https://www.google.com/maps/place/?q=place_id:${pid}`, '_blank');
            };

            res.appendChild(item);
        }
    }

    // ── Show panel for venue ────────────────────
    function showForVenue(venueId) {
        const panel = ensurePanel();
        const q = buildQuery(venueId);
        const linked = isAlreadyLinked(venueId);
        const name = (() => { try { return sdk.DataModel.Venues.getById({ venueId })?.name || ''; } catch(_) { return ''; }})();

        const st = panel.querySelector('#gl-st');
        st.innerHTML = `<b>${name || 'POI'}</b><br>` +
            (linked
                ? `<span style="color:#34a853;">✅ Google Place(s) linked</span>`
                : `<span style="color:#ea4335;">⚠️ No Google Place</span>`);

        panel.querySelector('#gl-q').value = q || '';
        panel.querySelector('#gl-r').innerHTML = '';
        panel.style.display = 'block';

        if (q) doSearch();
    }

    // ── Monitor selection ───────────────────────
    function checkSelection() {
        const vid = getSelectedVenueId();
        if (vid && vid !== _lastVenueId) {
            _lastVenueId = vid;
            showForVenue(vid);
        } else if (!vid && _lastVenueId) {
            _lastVenueId = null;
            const p = document.getElementById('gl-panel');
            if (p) p.style.display = 'none';
        }
    }

    function wireEvents() {
        try {
            sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: () => setTimeout(checkSelection, 150) });
            sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: () => setTimeout(checkSelection, 400) });
        } catch (_) {}
        try { uw.W.selectionManager.events.register('selectionchanged', null, () => setTimeout(checkSelection, 150)); } catch (_) {}
        setInterval(checkSelection, 1000);
        console.log(LOG_PREFIX, 'Ready');
    }

    // ── Main ────────────────────────────────────
    async function main() {
        console.log(LOG_PREFIX, 'Starting...');
        await waitForSdk();
        sdk = initSDK();
        initGoogle();
        wireEvents();
    }

    main().catch(err => console.error(LOG_PREFIX, err));
})();
