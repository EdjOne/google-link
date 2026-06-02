// ==UserScript==
// @name                Google Link (WME)
// @name:uk             Google Link (WME)
// @version             1.1.0
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

    let sdk = null;
    let googleReady = false;
    let autocompleteService = null;
    let placesService = null;

    // ──────────────────────────────────────────────
    //  Wait for WME + SDK
    // ──────────────────────────────────────────────
    async function waitForReady() {
        const start = Date.now();
        while (true) {
            if (window.getWmeSdk && window.W && window.W.map && window.W.model) break;
            if (Date.now() - start > 60000) throw new Error('WME not ready');
            await new Promise(r => setTimeout(r, 250));
        }
    }

    function initSDK() {
        return window.getWmeSdk({ scriptId: 'google-link', scriptName: SCRIPT_NAME });
    }

    // ──────────────────────────────────────────────
    //  Wait for Google Places API
    // ──────────────────────────────────────────────
    function waitForGoogle() {
        return new Promise((resolve) => {
            const check = () => {
                const g = window.google?.maps?.places;
                if (g?.AutocompleteService && g?.PlacesService) {
                    autocompleteService = new g.AutocompleteService();
                    placesService = new g.PlacesService(document.createElement('div'));
                    googleReady = true;
                    console.log(LOG_PREFIX, 'Google Places API ready');
                    resolve(true);
                    return true;
                }
                return false;
            };
            if (check()) return;

            const interval = setInterval(() => {
                if (check()) clearInterval(interval);
            }, 1000);

            // Timeout after 30s
            setTimeout(() => {
                clearInterval(interval);
                if (!googleReady) {
                    console.warn(LOG_PREFIX, 'Google Places API not available');
                    resolve(false);
                }
            }, 30000);
        });
    }

    // ──────────────────────────────────────────────
    //  Build search query from venue address
    // ──────────────────────────────────────────────
    function buildSearchQuery(venueId) {
        try {
            const address = sdk.DataModel.Venues.getAddress({ venueId });
            const parts = [];

            if (address.street?.name) parts.push(address.street.name);
            if (address.houseNumber) parts.push(address.houseNumber);
            if (address.city?.name) parts.push(address.city.name);
            if (address.state?.name) parts.push(address.state.name);
            if (address.country?.name) parts.push(address.country.name);

            return parts.join(', ');
        } catch (e) {
            console.warn(LOG_PREFIX, 'Failed to build query:', e);
            return null;
        }
    }

    // ──────────────────────────────────────────────
    //  Get venue coordinates
    // ──────────────────────────────────────────────
    function getVenueLatLng(venueId) {
        try {
            const venue = sdk.DataModel.Venues.getById({ venueId });
            if (!venue?.geometry?.coordinates) return null;
            return { lat: venue.geometry.coordinates[1], lng: venue.geometry.coordinates[0] };
        } catch (e) {
            return null;
        }
    }

    // ──────────────────────────────────────────────
    //  Search Google Places
    // ──────────────────────────────────────────────
    function searchGooglePlaces(query, location) {
        return new Promise((resolve) => {
            if (!autocompleteService) {
                resolve([]);
                return;
            }

            const request = {
                input: query,
                types: ['establishment'],
            };

            if (location) {
                request.location = new google.maps.LatLng(location.lat, location.lng);
                request.radius = 5000; // 5km radius
            }

            autocompleteService.getPlacePredictions(request, (predictions, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
                    console.log(LOG_PREFIX, 'Search returned:', status);
                    resolve([]);
                    return;
                }
                resolve(predictions);
            });
        });
    }

    // ──────────────────────────────────────────────
    //  Get place details
    // ──────────────────────────────────────────────
    function getPlaceDetails(placeId) {
        return new Promise((resolve) => {
            if (!placesService) {
                resolve(null);
                return;
            }

            placesService.getDetails({ placeId }, (place, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
                    resolve(null);
                    return;
                }
                resolve(place);
            });
        });
    }

    // ──────────────────────────────────────────────
    //  Check if venue already has Google Place linked
    // ──────────────────────────────────────────────
    function getLinkedGoogleIds(venueId) {
        try {
            const venue = sdk.DataModel.Venues.getById({ venueId });
            if (!venue) return [];

            const ids = venue.externalProviderIds ||
                        venue.externalProviderIDs ||
                        venue.googleProviderLinks || [];

            if (!Array.isArray(ids)) return [];

            return ids.map(id => typeof id === 'string' ? id : id?.placeId || id?.id || '').filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    // ──────────────────────────────────────────────
    //  Create floating panel UI
    // ──────────────────────────────────────────────
    function createPanel() {
        if (document.getElementById('gl-panel')) return document.getElementById('gl-panel');

        const panel = document.createElement('div');
        panel.id = 'gl-panel';
        panel.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            width: 360px;
            max-height: 500px;
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 13px;
            overflow: hidden;
            display: none;
        `;

        panel.innerHTML = `
            <div id="gl-header" style="
                background: #4285f4;
                color: white;
                padding: 10px 14px;
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: bold;
                font-size: 14px;
            ">
                <span>🔍 Google Link</span>
                <button id="gl-close" style="
                    background: none;
                    border: none;
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0 4px;
                ">×</button>
            </div>
            <div id="gl-body" style="padding: 12px; overflow-y: auto; max-height: 440px;">
                <div id="gl-status" style="color: #666; margin-bottom: 8px;">Select a POI to search</div>
                <div id="gl-query-box" style="margin-bottom: 10px;">
                    <input id="gl-query" type="text" placeholder="Search query..." style="
                        width: 100%;
                        padding: 6px 8px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-size: 13px;
                        box-sizing: border-box;
                    " />
                    <button id="gl-search" style="
                        margin-top: 6px;
                        padding: 6px 14px;
                        background: #4285f4;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                    ">Search Google</button>
                </div>
                <div id="gl-results"></div>
            </div>
        `;

        document.body.appendChild(panel);

        // Drag functionality
        let isDragging = false, startX, startY, startLeft, startTop;
        const header = panel.querySelector('#gl-header');

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'gl-close') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => { isDragging = false; });

        // Close button
        panel.querySelector('#gl-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        // Search button
        panel.querySelector('#gl-search').addEventListener('click', () => {
            const query = panel.querySelector('#gl-query').value;
            if (query) doSearch(query);
        });

        // Enter key in search box
        panel.querySelector('#gl-query').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value;
                if (query) doSearch(query);
            }
        });

        return panel;
    }

    // ──────────────────────────────────────────────
    //  Show panel with venue data
    // ──────────────────────────────────────────────
    function showForVenue(venueId) {
        const panel = createPanel();
        const query = buildSearchQuery(venueId);
        const linkedIds = getLinkedGoogleIds(venueId);
        const location = getVenueLatLng(venueId);

        const statusEl = panel.querySelector('#gl-status');
        if (linkedIds.length > 0) {
            statusEl.innerHTML = `✅ Already linked: ${linkedIds.length} Google Place(s)`;
            statusEl.style.color = '#34a853';
        } else {
            statusEl.innerHTML = '⚠️ No Google Place linked';
            statusEl.style.color = '#ea4335';
        }

        const queryInput = panel.querySelector('#gl-query');
        queryInput.value = query || '';

        const resultsEl = panel.querySelector('#gl-results');
        resultsEl.innerHTML = '';

        panel.style.display = 'block';

        // Auto-search if we have a query
        if (query) {
            doSearch(query, location);
        }
    }

    // ──────────────────────────────────────────────
    //  Perform search and display results
    // ──────────────────────────────────────────────
    async function doSearch(query, location) {
        const resultsEl = document.querySelector('#gl-results');
        if (!resultsEl) return;

        resultsEl.innerHTML = '<div style="color: #666; padding: 8px;">Searching...</div>';

        const predictions = await searchGooglePlaces(query, location);

        if (predictions.length === 0) {
            resultsEl.innerHTML = '<div style="color: #999; padding: 8px;">No results found</div>';
            return;
        }

        resultsEl.innerHTML = '';

        for (const pred of predictions) {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 8px 10px;
                border: 1px solid #e0e0e0;
                border-radius: 4px;
                margin-bottom: 6px;
                cursor: pointer;
                transition: background 0.15s;
            `;
            item.innerHTML = `
                <div style="font-weight: 500; color: #333;">${pred.structured_formatting?.main_text || pred.description}</div>
                <div style="font-size: 11px; color: #888; margin-top: 2px;">${pred.structured_formatting?.secondary_text || ''}</div>
                <div style="font-size: 10px; color: #aaa; margin-top: 2px;">Place ID: ${pred.place_id}</div>
            `;

            item.addEventListener('mouseenter', () => { item.style.background = '#f0f6ff'; });
            item.addEventListener('mouseleave', () => { item.style.background = '#fff'; });

            item.addEventListener('click', async () => {
                item.style.background = '#e8f0fe';
                item.innerHTML += '<div style="color: #4285f4; font-size: 11px; margin-top: 4px;">Loading details...</div>';

                const details = await getPlaceDetails(pred.place_id);
                if (details) {
                    showPlaceDetails(pred.place_id, details, item);
                }
            });

            resultsEl.appendChild(item);
        }
    }

    // ──────────────────────────────────────────────
    //  Show place details with "Link" button
    // ──────────────────────────────────────────────
    function showPlaceDetails(placeId, details, container) {
        const detailsDiv = document.createElement('div');
        detailsDiv.style.cssText = 'padding: 8px; background: #f8f9fa; border-radius: 4px; margin-top: 6px;';

        const name = details.name || 'Unknown';
        const address = details.formatted_address || details.vicinity || 'No address';
        const phone = details.formatted_phone_number || '';
        const website = details.website || '';

        let html = `
            <div style="font-weight: bold; margin-bottom: 4px;">${name}</div>
            <div style="font-size: 11px; color: #555;">📍 ${address}</div>
        `;
        if (phone) html += `<div style="font-size: 11px; color: #555;">📞 ${phone}</div>`;
        if (website) html += `<div style="font-size: 11px; color: #555;">🌐 <a href="${website}" target="_blank" style="color: #4285f4;">${website}</a></div>`;

        if (details.rating) {
            html += `<div style="font-size: 11px; color: #555;">⭐ ${details.rating}</div>`;
        }

        detailsDiv.innerHTML = html;

        // Link button
        const linkBtn = document.createElement('button');
        linkBtn.textContent = '🔗 Link this Google Place';
        linkBtn.style.cssText = `
            margin-top: 8px;
            padding: 6px 12px;
            background: #34a853;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
        `;

        linkBtn.addEventListener('click', () => {
            // Open Google Maps with this place for manual verification
            const url = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
            window.open(url, '_blank');

            linkBtn.textContent = '✅ Opened in Google Maps';
            linkBtn.style.background = '#999';
            linkBtn.disabled = true;
        });

        detailsDiv.appendChild(linkBtn);
        container.appendChild(detailsDiv);
    }

    // ──────────────────────────────────────────────
    //  Monitor venue selection
    // ──────────────────────────────────────────────
    function monitorSelection() {
        let currentVenueId = null;

        // Listen for selection changes via SDK
        sdk.Events.on({
            eventName: 'wme-selection-changed',
            eventHandler: (data) => {
                const selectedItems = data.selectedItems || [];
                const venueItem = selectedItems.find(item => item.objectType === 'venue');

                if (venueItem) {
                    currentVenueId = venueItem.id;
                    console.log(LOG_PREFIX, 'Venue selected:', currentVenueId);

                    // Delay to let the panel render
                    setTimeout(() => showForVenue(currentVenueId), 300);
                } else {
                    currentVenueId = null;
                    // Hide panel when nothing selected
                    const panel = document.getElementById('gl-panel');
                    if (panel) panel.style.display = 'none';
                }
            }
        });

        // Also listen via W.selectionManager (legacy, more reliable)
        if (window.W?.selectionManager?.events) {
            window.W.selectionManager.events.register('selectionchanged', null, () => {
                setTimeout(() => {
                    const sel = window.W.selectionManager.selectedItems;
                    if (sel && sel.length > 0 && sel[0].model?.attributes?.type === 'venue') {
                        currentVenueId = String(sel[0].model.attributes.id);
                        showForVenue(currentVenueId);
                    }
                }, 300);
            });
        }
    }

    // ──────────────────────────────────────────────
    //  Main
    // ──────────────────────────────────────────────
    async function main() {
        console.log(LOG_PREFIX, 'Initializing...');

        await waitForReady();
        await new Promise(r => setTimeout(r, 500));

        sdk = initSDK();
        console.log(LOG_PREFIX, 'SDK initialized');

        await sdk.Events.once({ eventName: 'wme-ready' });
        console.log(LOG_PREFIX, 'WME ready');

        // Start Google Places API in background
        waitForGoogle();

        // Start monitoring
        monitorSelection();
        console.log(LOG_PREFIX, 'Monitoring venue selections...');
    }

    main().catch(err => console.error(LOG_PREFIX, 'Init failed:', err));
})();
