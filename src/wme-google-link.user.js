// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.3.0
// @description         Auto-fill native WME Google linking by venue address
// @description:uk      Автозаповнення нативного прив'язування Google за адресою POI
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

    // ──────────────────────────────────────────────
    //  Wait for WME + SDK
    // ──────────────────────────────────────────────
    async function waitForWme() {
        const start = Date.now();
        while (true) {
            if (uw.W && uw.W.map && uw.W.model && uw.W.selectionManager) break;
            if (Date.now() - start > 60000) throw new Error('WME not ready');
            await new Promise(r => setTimeout(r, 250));
        }
    }

    async function waitForSdk() {
        await waitForWme();
        if (uw.SDK_INITIALIZED && typeof uw.SDK_INITIALIZED.then === 'function') await uw.SDK_INITIALIZED;
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
    //  Get selected venue ID (3 fallback methods)
    // ──────────────────────────────────────────────
    function getSelectedVenueId() {
        try {
            const sel = sdk?.Editing?.getSelection?.();
            const t = String(sel?.objectType || '').toLowerCase();
            const ids = Array.isArray(sel?.ids) ? sel.ids : [];
            if (ids.length === 1 && (t === 'venue' || t.endsWith('venue'))) return String(ids[0]);
        } catch (_) {}
        try {
            const feats = uw.W?.selectionManager?.getSelectedFeatures?.();
            if (Array.isArray(feats) && feats.length === 1) {
                if (feats[0]?.model?.type === 'venue') return String(feats[0].model.attributes?.id);
                if (feats[0]?.WW?.getType?.() === 'venue') return String(feats[0].WW.getObjectModel?.()?.attributes?.id);
            }
        } catch (_) {}
        try {
            const items = uw.W?.selectionManager?.selectedItems;
            if (items?.length > 0 && items[0].model?.attributes?.type === 'venue')
                return String(items[0].model.attributes.id);
        } catch (_) {}
        return null;
    }

    // ──────────────────────────────────────────────
    //  Build search query from venue address
    // ──────────────────────────────────────────────
    function buildSearchQuery(venueId) {
        try {
            const addr = sdk.DataModel.Venues.getAddress({ venueId });
            const parts = [];
            const street = addr.street?.englishName || addr.street?.name || '';
            if (street) parts.push(street);
            if (addr.houseNumber) parts.push(addr.houseNumber);
            const city = addr.city?.englishName || addr.city?.name || '';
            if (city) parts.push(city);
            if (addr.country?.name) parts.push(addr.country.name);
            const q = parts.join(', ');
            console.log(LOG_PREFIX, 'Query:', q);
            return q;
        } catch (e) {
            console.warn(LOG_PREFIX, 'buildQuery failed:', e);
            return null;
        }
    }

    function getVenueLatLng(venueId) {
        try {
            const v = sdk.DataModel.Venues.getById({ venueId });
            if (!v?.geometry?.coordinates) return null;
            return { lat: v.geometry.coordinates[1], lng: v.geometry.coordinates[0] };
        } catch (_) { return null; }
    }

    // ──────────────────────────────────────────────
    //  Find the "+ Прив'язати до Google" link
    // ──────────────────────────────────────────────
    function findGoogleLinkButton() {
        // Search all links and buttons in the edit panel
        const panel = document.querySelector('#edit-panel') || document.body;
        const allEls = panel.querySelectorAll('a, button, span, div, label');

        for (const el of allEls) {
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('прив') && text.includes('google')) return el;
            if (text.includes('link') && text.includes('google')) return el;
            if (text.includes('прив\'язати')) return el;
        }

        // Fallback: search entire document
        const all = document.querySelectorAll('a, button');
        for (const el of all) {
            const text = (el.textContent || '').trim().toLowerCase();
            if (text.includes('прив') && text.includes('google')) return el;
        }

        return null;
    }

    // ──────────────────────────────────────────────
    //  Find the Google autocomplete input (appears after clicking link)
    // ──────────────────────────────────────────────
    function findGoogleAutocompleteInput() {
        // Google Places autocomplete uses class "pac-target-input"
        let input = document.querySelector('.pac-target-input');
        if (input) return input;

        // Or look for input with google-related attributes
        input = document.querySelector('input[data-google], input[placeholder*="Google"], input[placeholder*="place"]');
        if (input) return input;

        // Look for any new input in the edit panel that appeared recently
        const panel = document.querySelector('#edit-panel') || document.body;
        const inputs = panel.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of inputs) {
            const ph = (inp.placeholder || '').toLowerCase();
            if (ph.includes('google') || ph.includes('search') || ph.includes('place') || ph.includes('address')) {
                return inp;
            }
        }

        return null;
    }

    // ──────────────────────────────────────────────
    //  Fill input and trigger search
    // ──────────────────────────────────────────────
    function fillAndSearch(input, query) {
        if (!input) return false;

        // Focus
        input.focus();
        input.click();

        // Clear and set value
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Type character by character to trigger autocomplete
        let i = 0;
        const typeChar = () => {
            if (i < query.length) {
                input.value += query[i];
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: query[i], bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: query[i], bubbles: true }));
                i++;
                setTimeout(typeChar, 30);
            } else {
                // Final events
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                console.log(LOG_PREFIX, 'Filled input, triggered search:', query);
            }
        };
        typeChar();
        return true;
    }

    // ──────────────────────────────────────────────
    //  Auto-select first Google result
    // ──────────────────────────────────────────────
    function autoSelectFirstResult(attempt = 0) {
        if (attempt > 20) {
            console.log(LOG_PREFIX, 'No autocomplete results found after waiting');
            return;
        }

        // Look for pac-container (Google autocomplete dropdown)
        const pac = document.querySelector('.pac-container');
        if (!pac || pac.style.display === 'none' || pac.children.length === 0) {
            setTimeout(() => autoSelectFirstResult(attempt + 1), 500);
            return;
        }

        // Find first clickable result
        const items = pac.querySelectorAll('.pac-item');
        if (items.length === 0) {
            setTimeout(() => autoSelectFirstResult(attempt + 1), 500);
            return;
        }

        console.log(LOG_PREFIX, 'Found', items.length, 'autocomplete results, clicking first');
        items[0].click();
    }

    // ──────────────────────────────────────────────
    //  Main flow: click native link + auto-fill
    // ──────────────────────────────────────────────
    async function autoLinkGoogle(venueId) {
        const query = buildSearchQuery(venueId);
        if (!query) return;

        // Step 1: Find and click "+ Прив'язати до Google"
        const btn = findGoogleLinkButton();
        if (!btn) {
            console.log(LOG_PREFIX, 'Google link button not found yet, will retry...');
            return;
        }

        console.log(LOG_PREFIX, 'Found Google link button:', btn.textContent.trim());
        btn.click();

        // Step 2: Wait for autocomplete input to appear
        let input = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 300));
            input = findGoogleAutocompleteInput();
            if (input) break;
        }

        if (!input) {
            console.log(LOG_PREFIX, 'Autocomplete input not found after click');
            return;
        }

        console.log(LOG_PREFIX, 'Found autocomplete input');

        // Step 3: Fill and search
        fillAndSearch(input, query);

        // Step 4: Auto-select first result
        setTimeout(() => autoSelectFirstResult(0), 1000);
    }

    // ──────────────────────────────────────────────
    //  Check selection + auto-link
    // ──────────────────────────────────────────────
    function checkSelection() {
        const vid = getSelectedVenueId();
        if (vid && vid !== _lastVenueId) {
            _lastVenueId = vid;
            console.log(LOG_PREFIX, 'Venue selected:', vid);

            // Check if already linked
            try {
                const venue = sdk.DataModel.Venues.getById({ venueId: vid });
                const linked = venue?.externalProviderIds || venue?.externalProviderIDs || [];
                if (Array.isArray(linked) && linked.length > 0) {
                    console.log(LOG_PREFIX, 'Already linked:', linked.length, 'places');
                    return;
                }
            } catch (_) {}

            // Auto-link after a short delay (let panel render)
            setTimeout(() => autoLinkGoogle(vid), 500);
        } else if (!vid && _lastVenueId) {
            _lastVenueId = null;
        }
    }

    // ──────────────────────────────────────────────
    //  Wire events + polling
    // ──────────────────────────────────────────────
    function wireEvents() {
        try {
            sdk.Events.on({ eventName: 'wme-selection-changed', eventHandler: () => setTimeout(checkSelection, 150) });
            sdk.Events.on({ eventName: 'wme-feature-editor-opened', eventHandler: () => setTimeout(checkSelection, 400) });
        } catch (e) { console.warn(LOG_PREFIX, 'SDK events error:', e); }

        try {
            uw.W.selectionManager.events.register('selectionchanged', null, () => setTimeout(checkSelection, 150));
        } catch (_) {}

        // Polling safety net
        setInterval(checkSelection, 1000);

        console.log(LOG_PREFIX, 'Events wired');
    }

    // ──────────────────────────────────────────────
    //  MAIN
    // ──────────────────────────────────────────────
    async function main() {
        console.log(LOG_PREFIX, 'Starting...');
        await waitForSdk();
        console.log(LOG_PREFIX, 'WME ready');

        sdk = initSDK();
        console.log(LOG_PREFIX, 'SDK initialized');

        uw.SDK_INITIALIZED?.then?.(() => {}).catch?.(() => {});

        wireEvents();
        console.log(LOG_PREFIX, 'Monitoring...');
    }

    main().catch(err => console.error(LOG_PREFIX, err));
})();
