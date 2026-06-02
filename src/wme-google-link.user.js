// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.6.0
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

    async function show(vid) {
        const old = document.getElementById('gl-p'); if (old) old.remove();
        const query = q(vid); if (!query) return;

        const p = document.createElement('div');
        p.id = 'gl-p';
        p.style.cssText = 'position:fixed;top:80px;right:20px;width:380px;max-height:500px;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:10000;font:13px/1.4 Arial;overflow:hidden;';
        p.innerHTML = `<div style="background:#4285f4;color:#fff;padding:8px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;"><span>🔍 ${nm(vid) || 'POI'}</span><button onclick="this.closest('#gl-p').remove()" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">×</button></div><div style="padding:10px;"><input id="gl-i" type="text" value="${query}" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;" /><div id="gl-r"><div style="color:#666;">Searching...</div></div></div>`;
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
                    navigator.clipboard.writeText(p.place_id);
                    d.style.background = '#e6f4ea';
                    d.innerHTML += '<br><small style="color:#34a853;">✅ Place ID copied!</small>';
                };
                r.appendChild(d);
            }
        });
    }

    go().catch(e => { console.error(L, e); b.style.background = '#ea4335'; b.textContent = 'GL ERR'; });
})();
