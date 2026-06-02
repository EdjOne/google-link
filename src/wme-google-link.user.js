// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.5.0
// @description         Search Google Places by venue address + copy Place ID
// @description:uk      Пошук Google Places за адресою + копіювання Place ID
// @author              EdjOne
// @match               https://www.waze.com/editor*
// @match               https://www.waze.com/*/editor*
// @match               https://editor.waze.com/*
// @match               https://editor-beta.waze.com/*
// @match               https://beta.waze.com/*/editor*
// @grant               none
// @run-at              document-idle
// ==/UserScript==

(function () {
    'use strict';

    console.log('[GL] ===== Script v1.5.0 loaded =====');

    // Show version badge on page
    const badge = document.createElement('div');
    badge.textContent = 'GL v1.5.0';
    badge.style.cssText = 'position:fixed;bottom:5px;right:5px;background:#4285f4;color:#fff;padding:2px 6px;border-radius:3px;font:10px Arial;z-index:99999;opacity:0.7;';
    document.body.appendChild(badge);

    const LOG = '[GL]';
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let sdk = null, _lastVid = null, autoComp = null;

    // ── Wait for WME ────────────────────────────
    async function waitWme() {
        console.log(LOG, 'Waiting for WME...');
        const t = Date.now();
        while (!(uw.W?.map && uw.W?.model && uw.W?.selectionManager)) {
            if (Date.now() - t > 60000) throw new Error('WME timeout');
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(LOG, 'WME globals OK');
        if (uw.SDK_INITIALIZED?.then) await uw.SDK_INITIALIZED;
        while (typeof uw.getWmeSdk !== 'function') {
            if (Date.now() - t > 60000) throw new Error('SDK timeout');
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(LOG, 'SDK ready');
    }

    // ── Get venue ID ────────────────────────────
    function getVid() {
        try {
            const s = sdk?.Editing?.getSelection?.();
            const t = String(s?.objectType || '').toLowerCase();
            if (s?.ids?.length === 1 && (t === 'venue' || t.endsWith('venue')))
                return String(s.ids[0]);
        } catch (_) {}
        try {
            const f = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (f?.length === 1 && f[0]?.model?.type === 'venue')
                return String(f[0].model.attributes?.id);
        } catch (_) {}
        return null;
    }

    // ── Build query ─────────────────────────────
    function buildQ(vid) {
        try {
            const a = sdk.DataModel.Venues.getAddress({ venueId: vid });
            const p = [];
            const s = a.street?.englishName || a.street?.name;
            if (s) p.push(s);
            if (a.houseNumber) p.push(a.houseNumber);
            const c = a.city?.englishName || a.city?.name;
            if (c) p.push(c);
            if (a.country?.name) p.push(a.country.name);
            return p.join(', ');
        } catch (_) { return ''; }
    }

    function getLL(vid) {
        try {
            const v = sdk.DataModel.Venues.getById({ venueId: vid });
            return v?.geometry?.coordinates ? { lat: v.geometry.coordinates[1], lng: v.geometry.coordinates[0] } : null;
        } catch (_) { return null; }
    }

    function isLinked(vid) {
        try {
            const v = sdk.DataModel.Venues.getById({ venueId: vid });
            const ids = v?.externalProviderIds || v?.externalProviderIDs || [];
            return Array.isArray(ids) && ids.length > 0;
        } catch (_) { return false; }
    }

    function getVName(vid) {
        try { return sdk.DataModel.Venues.getById({ venueId: vid })?.name || ''; } catch (_) { return ''; }
    }

    // ── Google search ───────────────────────────
    function initGoogle() {
        try {
            const g = uw.google?.maps?.places;
            if (!g?.AutocompleteService) { console.warn(LOG, 'No AutocompleteService'); return false; }
            autoComp = new g.AutocompleteService();
            console.log(LOG, 'Google AutocompleteService ready');
            return true;
        } catch (e) { console.warn(LOG, 'Google init failed:', e); return false; }
    }

    function gSearch(q, loc) {
        return new Promise(resolve => {
            if (!autoComp) { resolve([]); return; }
            const req = { input: q };
            if (loc) {
                try { req.location = new google.maps.LatLng(loc.lat, loc.lng); req.radius = 5000; } catch (_) {}
            }
            autoComp.getPlacePredictions(req, (p, st) => {
                console.log(LOG, 'Search:', st, p?.length || 0);
                resolve(st === 'OK' ? (p || []) : []);
            });
        });
    }

    // ── Panel ───────────────────────────────────
    function mkPanel() {
        let p = document.getElementById('gl-panel');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'gl-panel';
        p.style.cssText = 'position:fixed;top:80px;right:20px;width:380px;max-height:520px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10000;font:13px/1.4 Arial;overflow:hidden;display:none;';
        p.innerHTML = `<div id="gh" style="background:#4285f4;color:#fff;padding:10px 14px;cursor:move;display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:14px;"><span>🔍 Google Link</span><button id="gx" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">×</button></div><div style="padding:12px;overflow-y:auto;max-height:450px;"><div id="gs" style="color:#666;margin-bottom:8px;">Select a POI</div><div style="margin-bottom:10px;display:flex;gap:6px;"><input id="gq" type="text" placeholder="Search query..." style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" /><button id="gS" style="padding:6px 12px;background:#4285f4;color:#fff;border:none;border-radius:4px;cursor:pointer;">🔍</button></div><div id="gR"></div></div>`;
        document.body.appendChild(p);

        // Drag
        let d = false, sx, sy, sl, st;
        p.querySelector('#gh').onmousedown = e => { if (e.target.id === 'gx') return; d = true; sx = e.clientX; sy = e.clientY; const r = p.getBoundingClientRect(); sl = r.left; st = r.top; e.preventDefault(); };
        document.onmousemove = e => { if (!d) return; p.style.left = (sl + e.clientX - sx) + 'px'; p.style.top = (st + e.clientY - sy) + 'px'; p.style.right = 'auto'; };
        document.onmouseup = () => d = false;
        p.querySelector('#gx').onclick = () => { p.style.display = 'none'; };
        p.querySelector('#gS').onclick = () => doSearch();
        p.querySelector('#gq').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
        return p;
    }

    async function doSearch() {
        const p = mkPanel();
        const q = p.querySelector('#gq').value;
        if (!q) return;
        const r = p.querySelector('#gR');
        r.innerHTML = '<div style="color:#666">Searching...</div>';

        if (!autoComp && !initGoogle()) {
            r.innerHTML = '<div style="color:#ea4335">Google API not ready</div>';
            return;
        }

        const loc = _lastVid ? getLL(_lastVid) : null;
        const preds = await gSearch(q, loc);
        if (!preds.length) { r.innerHTML = '<div style="color:#999">No results</div>'; return; }

        r.innerHTML = '';
        for (const pr of preds) {
            const nm = pr.structured_formatting?.main_text || pr.description;
            const sub = pr.structured_formatting?.secondary_text || '';
            const pid = pr.place_id;
            const el = document.createElement('div');
            el.style.cssText = 'padding:8px 10px;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:6px;cursor:pointer;';
            el.innerHTML = `<div style="font-weight:500;color:#333;">${nm}</div><div style="font-size:11px;color:#888;">${sub}</div><div style="font-size:10px;color:#aaa;word-break:break-all;">${pid}</div><div style="margin-top:4px;display:flex;gap:4px;"><button class="gcp" data-p="${pid}" style="padding:3px 8px;background:#34a853;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">📋 Copy ID</button><button class="gmp" data-p="${pid}" style="padding:3px 8px;background:#4285f4;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">🗺 Maps</button></div>`;
            el.onmouseenter = () => el.style.background = '#f0f6ff';
            el.onmouseleave = () => el.style.background = '#fff';
            el.querySelector('.gcp').onclick = e => { e.stopPropagation(); navigator.clipboard.writeText(pid).then(() => { e.target.textContent = '✅ Copied!'; setTimeout(() => e.target.textContent = '📋 Copy ID', 2000); }); };
            el.querySelector('.gmp').onclick = e => { e.stopPropagation(); window.open(`https://www.google.com/maps/place/?q=place_id:${pid}`, '_blank'); };
            r.appendChild(el);
        }
    }

    function showPanel(vid) {
        const p = mkPanel();
        const q = buildQ(vid);
        const linked = isLinked(vid);
        const nm = getVName(vid);
        p.querySelector('#gs').innerHTML = `<b>${nm || 'POI'}</b><br>${linked ? '<span style="color:#34a853">✅ Linked</span>' : '<span style="color:#ea4335">⚠️ Not linked</span>'}`;
        p.querySelector('#gq').value = q || '';
        p.querySelector('#gR').innerHTML = '';
        p.style.display = 'block';
        if (q) doSearch();
    }

    // ── Monitor ─────────────────────────────────
    function check() {
        const vid = getVid();
        if (vid && vid !== _lastVid) { _lastVid = vid; showPanel(vid); }
        else if (!vid && _lastVid) { _lastVid = null; const p = document.getElementById('gl-panel'); if (p) p.style.display = 'none'; }
    }

    function wire() {
        try { sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: () => setTimeout(check, 150) }); } catch (_) {}
        try { sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: () => setTimeout(check, 400) }); } catch (_) {}
        try { uw.W.selectionManager.events.register('selectionchanged', null, () => setTimeout(check, 150)); } catch (_) {}
        setInterval(check, 1000);
        console.log(LOG, '=== READY ===');
        badge.textContent = 'GL v1.5.0 ✓';
        badge.style.background = '#34a853';
    }

    // ── Main ────────────────────────────────────
    async function main() {
        console.log(LOG, 'Starting...');
        await waitWme();
        sdk = uw.getWmeSdk({ scriptId: 'google-link', scriptName: 'Google Link' });
        console.log(LOG, 'SDK init OK');
        initGoogle();
        wire();
    }

    main().catch(e => { console.error(LOG, 'FAILED:', e); badge.textContent = 'GL ERR'; badge.style.background = '#ea4335'; });
})();
