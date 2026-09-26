// ===== DEBUG OVERLAY (?debug) =====
// Shows what the browser supports, for devices without developer tools (e.g. a TV browser).
// Loaded before the other scripts and written in old-style JavaScript (no arrow functions,
// template literals, let/const) so it still runs, and shows the error, if script.js cannot run.

(function () {
    if (!/[?&]debug(=|&|$)/.test(window.location.search)) {
        return;
    }

    var errors = [];
    var cachedFiles = '?';
    var serviceWorkerState = '?';
    var loadedAt = new Date();
    var panel = null;

    window.addEventListener('error', function (event) {
        if (event.message) {
            errors.push(event.message + (event.filename ? ' (' + event.filename.split('/').pop() + ':' + event.lineno + ')' : ''));
        }
        else if (event.target && (event.target.src || event.target.href)) {
            errors.push('Failed to load ' + (event.target.src || event.target.href).split('/').pop());
        }
    }, true);

    window.addEventListener('unhandledrejection', function (event) {
        errors.push('Unhandled promise: ' + (event.reason && event.reason.message ? event.reason.message : event.reason));
    });

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function formatDateTime(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function getTimeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
        }
        catch (e) {
            return 'unknown';
        }
    }

    function getUtcOffset() {
        var offset = -new Date().getTimezoneOffset();
        var sign = offset >= 0 ? '+' : '-';
        offset = Math.abs(offset);
        return 'UTC' + sign + pad(Math.floor(offset / 60)) + ':' + pad(offset % 60);
    }

    function getBrowserVersion() {
        var match = navigator.userAgent.match(/(Chrome|Firefox|Version)\/(\d+)/);
        return match ? match[1].replace('Version', 'Safari') + ' ' + match[2] : 'unknown';
    }

    function refreshAsyncInfo() {
        if (!('serviceWorker' in navigator)) {
            serviceWorkerState = 'not supported';
        }
        else if (!window.isSecureContext) {
            serviceWorkerState = 'unavailable (needs https)';
        }
        else {
            navigator.serviceWorker.getRegistration().then(function (registration) {
                var worker = registration && (registration.active || registration.waiting || registration.installing);
                serviceWorkerState = worker ? worker.state : 'not registered';
                if (navigator.serviceWorker.controller) {
                    serviceWorkerState += ', controls page';
                }
            }).catch(function (e) {
                serviceWorkerState = 'error: ' + e.message;
            });
        }

        if (!window.caches) {
            cachedFiles = 'not supported';
            return;
        }
        caches.keys().then(function (names) {
            return Promise.all(names.map(function (name) {
                return caches.open(name).then(function (cache) {
                    return cache.keys();
                });
            }));
        }).then(function (lists) {
            var count = 0;
            for (var i = 0; i < lists.length; i++) {
                count += lists[i].length;
            }
            cachedFiles = count + ' files';
        }).catch(function (e) {
            cachedFiles = 'error: ' + e.message;
        });
    }

    function row(label, value, isProblem) {
        return '<div><span style="color:#9ab">' + label + ':</span> ' +
            '<span style="color:' + (isProblem ? '#ff8080' : '#fff') + '">' + value + '</span></div>';
    }

    function render() {
        if (!panel) {
            panel = document.createElement('div');
            panel.setAttribute('style', 'position:fixed;left:0.5rem;bottom:0.5rem;z-index:9999;max-width:95%;' +
                'padding:0.6rem 0.8rem;background:rgba(0,0,0,0.85);color:#fff;border-radius:6px;' +
                'font:14px/1.45 monospace;word-break:break-all;pointer-events:none');
            document.body.appendChild(panel);
        }

        var timeZone = getTimeZone();
        var scriptRunning = typeof prayerArray !== 'undefined' && prayerArray.length > 0;
        var wakeLock = typeof wakeLockStatus !== 'undefined' ? wakeLockStatus : 'unknown (script.js not running)';

        panel.innerHTML =
            row('Browser', getBrowserVersion()) +
            row('User agent', navigator.userAgent) +
            row('Script', scriptRunning ? 'running, prayer times loaded' : 'NOT running', !scriptRunning) +
            row('Device time', formatDateTime(new Date()) + ' (' + getUtcOffset() + ')') +
            row('Time zone', timeZone, timeZone !== 'Europe/Amsterdam') +
            row('Page loaded', formatDateTime(loadedAt)) +
            row('Connection', navigator.onLine ? 'online' : 'offline') +
            row('HTTPS', window.isSecureContext ? 'yes' : 'no (offline support disabled)', !window.isSecureContext) +
            row('Service worker', serviceWorkerState, serviceWorkerState.indexOf('activated') !== 0) +
            row('Cache', cachedFiles) +
            row('Wake lock', wakeLock, wakeLock !== 'active') +
            row('Screen', window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x') +
            row('Errors', errors.length ? errors.slice(-5).join('<br>') : 'none', errors.length > 0);
    }

    window.addEventListener('load', function () {
        render();
        refreshAsyncInfo();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(refreshAsyncInfo);
        }
        setInterval(render, 1000);
        setInterval(refreshAsyncInfo, 5000);
    });
})();
