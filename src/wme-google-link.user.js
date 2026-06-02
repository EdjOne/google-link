// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.2.2
// @description         Auto-search and link Google POI by venue address in WME
// @description:uk      Автопошук та прив'язка Google POI за адресою POI у WME
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
    let googleReady = false;
    let autocompleteService = null;
    let placesService = null;
    let panelVisible = false;

    // ──────────────────────────────────────────────
    //  Wait for WME globals
    // ──────────────────────────────────────────────
    async function waitForWme() {
        const start = Date.now();
        while (true) {
            if (uw.W && uw.W.map && uw.W.model && uw.W.selectionManager && uw.OpenLayers) break;
            if (Date.now() - start > 60000) throw new Error('WME globals not ready');
            await new Promise(r => setTimeout(r, 250));
        }
    }

    async function waitForSdk() {
        await waitForWme();
        if (uw.SDK_INITIALIZED && typeof uw.SDK_INITIALIZED.then === 'function') {
            await uw.SDK_INITIALIZED;
        }
        const start = Date.now();
        while (true) {
            if (typeof uw.getWmeSdk === 'function') break;
            if (Date.now() - start > 60000) throw new Error('SDK not available');
            await new Promise(r => setTimeout(r, 250));
        }
    }

    function initSDK() {
        return uw.getWmeSdk({ scriptId: 'google-link', scriptName: 'Google Link' });
    }

    // ──────────────────────────────────────────────
    //  Get selected venue ID (multiple fallbacks)
    // ──────────────────────────────────────────────
    function getSelectedVenueId() {
        // Method 1: SDK Editing.getSelection()
        try {
            const selection = sdk?.Editing?.getSelection?.();
            const objectType = String(selection?.objectType || '').toLowerCase();
            const ids = Array.isArray(selection?.ids) ? selection.ids : [];
            if (ids.length === 1 && (objectType === 'venue' || objectType.endsWith('venue'))) {
                return String(ids[0]);
            }
        } catch (_) {}

        // Method 2: W.selectionManager.getSelectedFeatures()
        try {
            const features = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (!Array.isArray(features) || features.length !== 1) return null;

            const feature = features[0];
            if (feature?.model?.type === 'venue') {
                const attrs = feature.model.attributes || feature.model;
                if (attrs?.id != null) return String(attrs.id);
            }
            if (feature?.WW?.getType?.() === 'venue') {
                const obj = feature.WW.getObjectModel?.();
                if (obj?.attributes?.id != null) return String(obj.attributes.id);
            }
        } catch (_) {}

        // Method 3: W.selectionManager.selectedItems (legacy)
        try {
            const items = uw.W?.selectionManager?.selectedItems;
            if (items && items.length > 0) {
                const item = items[0];
                if (item.model?.attributes?.type === 'venue') {
                    return String(item.model.attributes.id);
                }
            }
        } catch (_) {}

        return null;
    }

    // ──────────────────────────────────────────────
    //  Wait for Google Places API
    // ──────────────────────────────────────────────
    function waitForGoogle() {
        const check = () => {
            const g = uw.google?.maps?.places;
            if (g?.AutocompleteService && g?.PlacesService) {
                autocompleteService = new g.AutocompleteService();
                placesService = new g.PlacesService(document.createElement('div'));
                googleReady = true;
                console.log(LOG_PREFIX, 'Google Places API ready');
                return true;
            }
            return false;
        };
        if (check()) return;

        const interval = setInterval(() => {
            if (check()) clearInterval(interval);
        }, 1000);

        setTimeout(() => clearInterval(interval), 30000);
    }

    // ──────────────────────────────────────────────
    //  Build search query from venue address
    // ──────────────────────────────────────────────
    function buildSearchQuery(venueId) {
        try {
            const address = sdk.DataModel.Venues.getAddress({ venueId });
            const parts = [];

            // Street name (try English if available for better Google results)
            if (address.street?.englishName) {
                parts.push(address.street.englishName);
            } else if (address.street?.name) {
                parts.push(address.street.name);
            }

            // House number
            if (address.houseNumber) parts.push(address.houseNumber);

            // City — critical for Google search
            if (address.city?.name) parts.push(address.city.name);

            // State/region
            if (address.state?.name) parts.push(address.state.name);

            // Country
            if (address.country?.name) parts.push(address.country.name);

            return parts.join(', ');
        } catch (e) {
            console.warn(LOG_PREFIX, 'buildSearchQuery failed:', e);
            return null;
        }
    }

    function getVenueLatLng(venueId) {
        try {
            const venue = sdk.DataModel.Venues.getById({ venueId });
            if (!venue?.geometry?.coordinates) return null;
            return { lat: venue.geometry.coordinates[1], lng: venue.geometry.coordinates[0] };
        } catch (_) { return null; }
    }

    function getVenueName(venueId) {
        try {
            const venue = sdk.DataModel.Venues.getById({ venueId });
            return venue?.name || '';
        } catch (_) { return ''; }
    }

    // ──────────────────────────────────────────────
    //  Search Google Places
    // ──────────────────────────────────────────────
    function searchGoogle(query, location) {
        return new Promise((resolve) => {
            if (!autocompleteService) { resolve([]); return; }

            const request = { input: query, types: ['establishment'] };
            if (location) {
                request.location = new google.maps.LatLng(location.lat, location.lng);
                request.radius = 5000;
            }

            autocompleteService.getPlacePredictions(request, (predictions, status) => {
                if (status !== 'OK' || !predictions) { resolve([]); return; }
                resolve(predictions);
            });
        });
    }

    function getPlaceDetails(placeId) {
        return new Promise((resolve) => {
            if (!placesService) { resolve(null); return; }
            placesService.getDetails({ placeId }, (place, status) => {
                if (status !== 'OK' || !place) { resolve(null); return; }
                resolve(place);
            });
        });
    }

    // ──────────────────────────────────────────────
    //  Check linked Google IDs
    // ──────────────────────────────────────────────
    function getLinkedGoogleIds(venueId) {
        try {
            const venue = sdk.DataModel.Venues.getById({ venueId });
            if (!venue) return [];
            const ids = venue.externalProviderIds || venue.externalProviderIDs || [];
            if (!Array.isArray(ids)) return [];
            return ids.map(id => typeof id === 'string' ? id : id?.placeId || id?.id || '').filter(Boolean);
        } catch (_) { return []; }
    }

    // ──────────────────────────────────────────────
    //  PANEL UI
    // ──────────────────────────────────────────────
    function ensurePanel() {
        let panel = document.getElementById('gl-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'gl-panel';
        panel.style.cssText = `
            position: fixed; top: 80px; right: 20px; width: 360px;
            max-height: 500px; background: #fff; border: 1px solid #ccc;
            border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000; font-family: Arial, sans-serif; font-size: 13px;
            overflow: hidden; display: none;
        `;

        panel.innerHTML = `
            <div id="gl-hdr" style="background:#4285f4;color:#fff;padding:10px 14px;
                cursor:move;display:flex;justify-content:space-between;align-items:center;
                font-weight:bold;font-size:14px;">
                <span>🔍 Google Link</span>
                <button id="gl-close" style="background:none;border:none;color:#fff;
                    font-size:18px;cursor:pointer;padding:0 4px;">×</button>
            </div>
            <div style="padding:12px;overflow-y:auto;max-height:440px;">
                <div id="gl-status" style="color:#666;margin-bottom:8px;">Select a POI</div>
                <div style="margin-bottom:10px;">
                    <input id="gl-q" type="text" placeholder="Search query..." style="
                        width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;
                        font-size:13px;box-sizing:border-box;" />
                    <button id="gl-search" style="margin-top:6px;padding:6px 14px;
                        background:#4285f4;color:#fff;border:none;border-radius:4px;
                        cursor:pointer;font-size:13px;">Search Google</button>
                </div>
                <div id="gl-results"></div>
            </div>
        `;

        document.body.appendChild(panel);

        // Drag
        let dragging = false, sx, sy, sl, st;
        panel.querySelector('#gl-hdr').addEventListener('mousedown', e => {
            if (e.target.id === 'gl-close') return;
            dragging = true; sx = e.clientX; sy = e.clientY;
            const r = panel.getBoundingClientRect(); sl = r.left; st = r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (sl + e.clientX - sx) + 'px';
            panel.style.top = (st + e.clientY - sy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => dragging = false);

        // Close
        panel.querySelector('#gl-close').addEventListener('click', () => {
            panel.style.display = 'none'; panelVisible = false;
        });

        // Search
        const doSearch = async () => {
            const q = panel.querySelector('#gl-q').value;
            if (!q) return;
            const res = panel.querySelector('#gl-results');
            res.innerHTML = '<div style="color:#666;padding:8px;">Searching...</div>';
            const loc = getCurrentVenueLocation();
            const preds = await searchGoogle(q, loc);
            if (!preds.length) { res.innerHTML = '<div style="color:#999;padding:8px;">No results</div>'; return; }
            res.innerHTML = '';
            for (const p of preds) {
                const item = document.createElement('div');
                item.style.cssText = 'padding:8px 10px;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:6px;cursor:pointer;';
                item.innerHTML = `<div style="font-weight:500;color:#333;">${p.structured_formatting?.main_text || p.description}</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;">${p.structured_formatting?.secondary_text || ''}</div>
                    <div style="font-size:10px;color:#aaa;margin-top:2px;">${p.place_id}</div>`;
                item.onmouseenter = () => item.style.background = '#f0f6ff';
                item.onmouseleave = () => item.style.background = '#fff';
                item.onclick = async () => {
                    item.style.background = '#e8f0fe';
                    item.innerHTML += '<div style="color:#4285f4;font-size:11px;margin-top:4px;">Loading...</div>';
                    const det = await getPlaceDetails(p.place_id);
                    if (det) {
                        const d = document.createElement('div');
                        d.style.cssText = 'padding:8px;background:#f8f9fa;border-radius:4px;margin-top:6px;';
                        d.innerHTML = `<div style="font-weight:bold;">${det.name||''}</div>
                            <div style="font-size:11px;color:#555;">📍 ${det.formatted_address||det.vicinity||''}</div>
                            ${det.formatted_phone_number?`<div style="font-size:11px;">📞 ${det.formatted_phone_number}</div>`:''}
                            ${det.rating?`<div style="font-size:11px;">⭐ ${det.rating}</div>`:''}`;
                        const btn = document.createElement('button');
                        btn.textContent = '🔗 Open in Google Maps';
                        btn.style.cssText = 'margin-top:6px;padding:5px 10px;background:#34a853;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
                        btn.onclick = () => window.open(`https://www.google.com/maps/place/?q=place_id:${p.place_id}`, '_blank');
                        d.appendChild(btn);
                        item.appendChild(d);
                    }
                };
                res.appendChild(item);
            }
        };

        panel.querySelector('#gl-search').onclick = doSearch;
        panel.querySelector('#gl-q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

        return panel;
    }

    // Track current venue for search location
    let _currentVenueId = null;
    function getCurrentVenueLocation() {
        if (!_currentVenueId) return null;
        return getVenueLatLng(_currentVenueId);
    }

    function showPanel(venueId) {
        _currentVenueId = venueId;
        const panel = ensurePanel();
        const query = buildSearchQuery(venueId);
        const linked = getLinkedGoogleIds(venueId);
        const name = getVenueName(venueId);

        const status = panel.querySelector('#gl-status');
        status.innerHTML = `<b>${name || 'POI'}</b><br>` +
            (linked.length
                ? `<span style="color:#34a853;">✅ ${linked.length} Google Place(s) linked</span>`
                : `<span style="color:#ea4335;">⚠️ No Google Place linked</span>`);

        panel.querySelector('#gl-q').value = query || '';
        panel.querySelector('#gl-results').innerHTML = '';
        panel.style.display = 'block';
        panelVisible = true;

        // Auto-search
        if (query) {
            panel.querySelector('#gl-search').click();
        }
    }

    // ──────────────────────────────────────────────
    //  MONITOR SELECTION
    // ──────────────────────────────────────────────
    let _lastVenueId = null;

    function checkSelection() {
        const vid = getSelectedVenueId();
        if (vid && vid !== _lastVenueId) {
            _lastVenueId = vid;
            showPanel(vid);
        } else if (!vid && _lastVenueId) {
            _lastVenueId = null;
            const p = document.getElementById('gl-panel');
            if (p) p.style.display = 'none';
            panelVisible = false;
        }
    }

    function wireEvents() {
        // SDK events (non-blocking, .then() only)
        try {
            sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: () => setTimeout(checkSelection, 150) });
            sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: () => setTimeout(checkSelection, 300) });
        } catch (e) { console.warn(LOG_PREFIX, 'SDK events failed:', e); }

        // Legacy fallback
        try {
            uw.W.selectionManager.events.register('selectionchanged', null, () => setTimeout(checkSelection, 150));
        } catch (_) {}

        // Polling safety net (every 1s)
        setInterval(checkSelection, 1000);

        console.log(LOG_PREFIX, 'Events wired, monitoring...');
    }

    // ──────────────────────────────────────────────
    //  MAIN — NO AWAIT on wme-ready!
    // ──────────────────────────────────────────────
    async function main() {
        console.log(LOG_PREFIX, 'Starting...');

        await waitForSdk();
        console.log(LOG_PREFIX, 'WME globals ready');

        sdk = initSDK();
        console.log(LOG_PREFIX, 'SDK initialized');

        // Do NOT await wme-ready — it may have already fired!
        // Just listen for it non-blocking (same as WME Place Helper)
        sdk.Events.once({ eventName: 'wme-ready' }).then(() => {
            console.log(LOG_PREFIX, 'wme-ready fired');
        }).catch(() => {});

        waitForGoogle();
        wireEvents();
    }

    main().catch(err => console.error(LOG_PREFIX, err));
})();
