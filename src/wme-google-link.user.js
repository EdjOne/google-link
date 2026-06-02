// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.0.0
// @description         Auto-search and link Google POI by venue address in WME
// @description:uk      Автопошук та прив'язка Google POI за адресою POI у WME
// @author              EdjOne
// @match               https://www.waze.com/editor/*
// @match               https://www.waze.com/*/editor/*
// @match               https://editor.waze.com/*
// @match               https://editor-beta.waze.com/*
// @match               https://beta.waze.com/*/editor/*
// @grant               none
// @run-at              document-end
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'Google Link';
    const LOG_PREFIX = '[GL]';

    // ──────────────────────────────────────────────
    //  Wait for WME SDK to be ready
    // ──────────────────────────────────────────────
    function waitForWME() {
        return new Promise((resolve) => {
            if (window.getWmeSdk) {
                return resolve();
            }
            const observer = new MutationObserver(() => {
                if (window.getWmeSdk) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // ──────────────────────────────────────────────
    //  Initialize SDK
    // ──────────────────────────────────────────────
    function initSDK() {
        return window.getWmeSdk({
            scriptId: 'google-link',
            scriptName: SCRIPT_NAME
        });
    }

    // ──────────────────────────────────────────────
    //  Build search query from venue address
    // ──────────────────────────────────────────────
    function buildSearchQuery(sdk, venueId) {
        try {
            const address = sdk.DataModel.Venues.getAddress({ venueId });
            const parts = [];

            // Street name
            if (address.street && address.street.name) {
                parts.push(address.street.name);
            }

            // House number
            if (address.houseNumber) {
                parts.push(address.houseNumber);
            }

            // City name
            if (address.city && address.city.name) {
                parts.push(address.city.name);
            }

            // State/region
            if (address.state && address.state.name) {
                parts.push(address.state.name);
            }

            // Country
            if (address.country && address.country.name) {
                parts.push(address.country.name);
            }

            return parts.join(', ');
        } catch (e) {
            console.warn(LOG_PREFIX, 'Failed to build search query:', e);
            return null;
        }
    }

    // ──────────────────────────────────────────────
    //  Find the Google POIs section in venue editor
    // ──────────────────────────────────────────────
    function findGoogleSection(panel) {
        if (!panel) return null;

        // Look for form-groups that contain Google-related text
        const formGroups = panel.querySelectorAll('.form-group');
        for (const fg of formGroups) {
            const label = fg.querySelector('label, .control-label, h4, h5, strong, span');
            if (label && /google/i.test(label.textContent)) {
                return fg;
            }
        }

        // Fallback: search for any element containing "google" text
        const allElements = panel.querySelectorAll('*');
        for (const el of allElements) {
            if (el.children.length === 0 && /linked.*google|google.*poi/i.test(el.textContent)) {
                return el.closest('.form-group') || el.parentElement;
            }
        }

        return null;
    }

    // ──────────────────────────────────────────────
    //  Find search input in Google POIs section
    // ──────────────────────────────────────────────
    function findSearchInput(googleSection) {
        if (!googleSection) return null;

        // Look for input fields (text, search)
        const inputs = googleSection.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
        for (const input of inputs) {
            // Skip hidden inputs
            if (input.offsetParent !== null) {
                return input;
            }
        }

        // Look for select2 containers (WME often uses select2 for search)
        const select2 = googleSection.querySelector('.select2-container input, .select2-search input');
        if (select2) return select2;

        // Look for any input in the broader panel area
        const panel = googleSection.closest('.panel, .tab-content, #sidepanel, .edit-panel');
        if (panel) {
            const panelInputs = panel.querySelectorAll('input[type="text"], input[type="search"]');
            for (const input of panelInputs) {
                if (input.offsetParent !== null && /search|google|find/i.test(input.placeholder || '')) {
                    return input;
                }
            }
        }

        return null;
    }

    // ──────────────────────────────────────────────
    //  Add auto-search button to venue editor panel
    // ──────────────────────────────────────────────
    function addAutoSearchButton(panel, sdk, venueId) {
        // Don't add if already exists
        if (panel.querySelector('#gl-auto-search-btn')) return;

        const venue = sdk.DataModel.Venues.getById({ venueId });
        if (!venue) return;

        const query = buildSearchQuery(sdk, venueId);
        if (!query) return;

        // Create button
        const btn = document.createElement('button');
        btn.id = 'gl-auto-search-btn';
        btn.className = 'btn btn-default btn-sm';
        btn.style.cssText = 'margin: 5px 0; padding: 4px 10px; font-size: 12px; ' +
            'background: #4285f4; color: white; border: none; border-radius: 3px; ' +
            'cursor: pointer; display: flex; align-items: center; gap: 5px;';
        btn.innerHTML = '🔍 <span>Google Link</span>';
        btn.title = `Search on Google: "${query}"`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Try to find and fill the search input
            const googleSection = findGoogleSection(panel);
            const searchInput = findSearchInput(googleSection);

            if (searchInput) {
                // Fill the input and trigger events
                searchInput.value = query;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                console.log(LOG_PREFIX, 'Auto-filled search input with:', query);
            } else {
                // Fallback: open Google Maps search in new tab
                const encodedQuery = encodeURIComponent(query);
                const venueLat = venue.geometry.coordinates[1];
                const venueLng = venue.geometry.coordinates[0];
                const url = `https://www.google.com/maps/search/${encodedQuery}/@${venueLat},${venueLng},17z`;
                window.open(url, '_blank');
                console.log(LOG_PREFIX, 'Opened Google Maps search:', url);
            }
        });

        // Find the right place to insert the button
        const googleSection = findGoogleSection(panel);
        if (googleSection) {
            googleSection.insertBefore(btn, googleSection.firstChild);
        } else {
            // Insert at the top of the panel
            panel.insertBefore(btn, panel.firstChild);
        }
    }

    // ──────────────────────────────────────────────
    //  Monitor venue editor panel
    // ──────────────────────────────────────────────
    function monitorPanel(sdk) {
        let currentVenueId = null;

        // Listen for selection changes
        sdk.Events.on({
            eventName: 'wme-selection-changed',
            eventHandler: (data) => {
                const selectedItems = data.selectedItems || [];
                const venueItem = selectedItems.find(item => item.objectType === 'venue');

                if (venueItem) {
                    currentVenueId = venueItem.id;
                    console.log(LOG_PREFIX, 'Venue selected:', currentVenueId);
                } else {
                    currentVenueId = null;
                }
            }
        });

        // Listen for feature editor opened
        sdk.Events.on({
            eventName: 'wme-feature-editor-opened',
            eventHandler: () => {
                if (!currentVenueId) return;

                // Small delay to let the panel render
                setTimeout(() => {
                    const panel = document.querySelector(
                        '#sidepanel, .edit-panel, .panel-content, [class*="venue-editor"]'
                    );
                    if (panel) {
                        addAutoSearchButton(panel, sdk, currentVenueId);
                    }
                }, 500);
            }
        });

        // Also use MutationObserver as a fallback
        const observer = new MutationObserver(() => {
            if (!currentVenueId) return;

            const panel = document.querySelector(
                '#sidepanel, .edit-panel, .panel-content, [class*="venue-editor"]'
            );
            if (panel && !panel.querySelector('#gl-auto-search-btn')) {
                addAutoSearchButton(panel, sdk, currentVenueId);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // ──────────────────────────────────────────────
    //  Main initialization
    // ──────────────────────────────────────────────
    async function main() {
        console.log(LOG_PREFIX, 'Initializing...');

        await waitForWME();

        // Wait a bit more for SDK to be fully ready
        await new Promise(r => setTimeout(r, 1000));

        const sdk = initSDK();
        console.log(LOG_PREFIX, 'SDK initialized');

        // Wait for wme-ready
        await sdk.Events.once({ eventName: 'wme-ready' });
        console.log(LOG_PREFIX, 'WME ready, monitoring for venue selections...');

        monitorPanel(sdk);
    }

    main().catch(err => console.error(LOG_PREFIX, 'Init failed:', err));
})();
