// ===== SETTINGS =====
const SETTINGS = {
    SABAH_OFFSET_MINUTES: 25,
    SABAH_IN_RAMADAN_OFFSET_MINUTES: 20,
    CURRENT_PRAYER_THRESHOLD_MINUTES: 3,
    SOON_COUNTDOWN_THRESHOLD_MINUTES: 10,
    CURRENT_PRAYER_THRESHOLD_EXTRA_MINUTES: {
        'ogle': 1,
        'ikindi': 1,
        'yatsi': 1
    },
    CHECK_DAY: 'Cuma',
    PRAYER_TRANSLATIONS: {
        'imsak': { nl: 'Dageraad', tr: 'İmsak', ar: 'الإمساك' },
        'sabah': { nl: 'Ochtend', tr: 'Sabah', ar: 'الفجر' },
        'gunes': { nl: 'Zonsopg.', tr: 'Güneş', ar: 'الشروق' },
        'ogle': { nl: 'Middag', tr: 'Öğle', ar: 'الظهر' },
        'ikindi': { nl: 'Namiddag', tr: 'İkindi', ar: 'العصر' },
        'aksam': { nl: 'Avond', tr: 'Akşam', ar: 'المغرب' },
        'yatsi': { nl: 'Nacht', tr: 'Yatsı', ar: 'العشاء' }
    }
};

// ===== STATE =====
let prayerTimes = {};
let prayerArray = [];
const searchParams = new URLSearchParams(window.location.search);
const isTestMode = searchParams.has('test');
const currentDateOverride = parseCurrentDateOverride(searchParams.get('cd'));
let testMinutes = 0;
let lastDate = null;
let sabahWillBeAdjusted = false;
let sabahTimeTomorrow = null;
let imsakTimeTomorrow = null;
let lastPrayerListHtml = null;
let wakeLockStatus = 'not requested'; // shown in ?debug mode

// ===== DOM CACHE =====
const domElements = {
    prayerTimes: null,
    date: null,
    currentTime: null
};

function cacheDOMElements() {
    domElements.prayerTimes = document.getElementById('prayer-times');
    domElements.date = document.getElementById('date');
    domElements.currentTime = document.getElementById('current-time');
}

// ===== FUNCTIONS =====
/**
 * Converts a time string (HH:MM) to total minutes
 * @param {string} timeStr - Time in format 'HH:MM'
 * @returns {number} Total minutes, or 0 if invalid input
 */
function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        console.warn('Invalid time string:', timeStr);
        return 0;
    }
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) {
        console.warn('Invalid time format:', timeStr);
        return 0;
    }
    return h * 60 + m;
}

/**
 * Returns the current-prayer highlight window for a prayer.
 * @param {string} prayerKey - Prayer key from prayerArray
 * @returns {number} Threshold in minutes
 */
function getCurrentPrayerThresholdMinutes(prayerKey) {
    return SETTINGS.CURRENT_PRAYER_THRESHOLD_MINUTES +
        (SETTINGS.CURRENT_PRAYER_THRESHOLD_EXTRA_MINUTES[prayerKey] || 0);
}

/**
 * Updates the prayer list DOM only when the rendered output changes.
 * @param {string} html - Prayer list HTML
 * @returns {void}
 */
function renderPrayerListHtml(html) {
    if (html === lastPrayerListHtml) {
        return;
    }

    domElements.prayerTimes.innerHTML = html;
    lastPrayerListHtml = html;
}

/**
 * Dims the display after Aksam's current-prayer window until Güneş.
 * @param {number} currentMinutes - Current time in minutes since midnight
 * @returns {void}
 */
function updateNightMode(currentMinutes) {
    const aksam = prayerTimes.aksam ? timeToMinutes(prayerTimes.aksam.time) : null;
    const gunes = prayerTimes.gunes ? timeToMinutes(prayerTimes.gunes.time) : null;

    if (aksam === null || gunes === null) {
        document.body.classList.remove('night-mode');
        return;
    }

    const nightStartMinutes = aksam + getCurrentPrayerThresholdMinutes('aksam');
    const nightModeIsActive = currentMinutes >= nightStartMinutes || currentMinutes < gunes;

    document.body.classList.toggle('night-mode', nightModeIsActive);
}

/**
 * Calculates the day of the year (1-365/366)
 * @param {Date} date - The date to calculate for
 * @returns {number} Day of year (0-based index)
 */
function getDayOfYear(date) {
    // Use UTC calendar dates so DST changes do not shift the day index.
    const start = Date.UTC(date.getFullYear(), 0, 1);
    const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = current - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
}

/**
 * Parses the cd query parameter in YYYYMMDD format
 * @param {string|null} value - Query parameter value
 * @returns {Date|null} Parsed local date or null when absent/invalid
 */
function parseCurrentDateOverride(value) {
    if (!value) {
        return null;
    }

    const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) {
        console.warn('Invalid cd query parameter. Expected format YYYYMMDD:', value);
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsedDate = new Date(year, month - 1, day);

    if (
        parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() !== month - 1 ||
        parsedDate.getDate() !== day
    ) {
        console.warn('Invalid cd query parameter. Could not parse date:', value);
        return null;
    }

    return parsedDate;
}

/**
 * Returns the selected calendar day, falling back to the real current date
 * @returns {Date} Selected day
 */
function getSelectedDate() {
    if (currentDateOverride) {
        return new Date(
            currentDateOverride.getFullYear(),
            currentDateOverride.getMonth(),
            currentDateOverride.getDate()
        );
    }

    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Returns the current time, optionally projected onto the selected calendar day
 * @returns {Date} Current date/time
 */
function getCurrentDateTime() {
    const now = new Date();

    if (!currentDateOverride) {
        return now;
    }

    const selectedDate = getSelectedDate();
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return selectedDate;
}

/**
 * Returns a copy of a date shifted by a number of calendar days
 * @param {Date} date - Base date
 * @param {number} dayOffset - Number of days to shift
 * @returns {Date} Shifted date
 */
function shiftDate(date, dayOffset) {
    const shiftedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    shiftedDate.setDate(shiftedDate.getDate() + dayOffset);
    return shiftedDate;
}

/**
 * Checks whether a date is in daylight saving time for the local timezone
 * @param {Date} date - Date to check
 * @returns {boolean} True when the date is in DST
 */
function isDaylightSavingTime(date) {
    const januaryOffset = new Date(date.getFullYear(), 0, 1, 12, 0, 0, 0).getTimezoneOffset();
    const julyOffset = new Date(date.getFullYear(), 6, 1, 12, 0, 0, 0).getTimezoneOffset();
    const standardOffset = Math.max(januaryOffset, julyOffset);
    const middayDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    return middayDate.getTimezoneOffset() < standardOffset;
}

/**
 * Checks whether a Hijri date string belongs to Ramadan
 * @param {string|null} hijriDate - Hijri date string
 * @returns {boolean} True when the date is in Ramadan
 */
function isRamadanDate(hijriDate) {
    return Boolean(hijriDate && hijriDate.includes('Ramazan'));
}

/**
 * Gets the current time or test time if in test mode
 * @returns {Date} Current or test time
 */
function getTestTime() {
    if (!isTestMode)
        return getCurrentDateTime();

    const startOfDay = getSelectedDate();
    startOfDay.setMinutes(startOfDay.getMinutes() + testMinutes);
    return startOfDay;
}

/**
 * Finds the minimum sunrise time in the week starting from a given day
 * @param {string[]} lines - Array of prayer data lines
 * @param {number} weekIndex - Any line index in the target Saturday-Friday week
 * @param {number} referenceIndex - Line index that corresponds to referenceDate
 * @param {Date} referenceDate - The day we are calculating Sabah for
 * @param {Object} options - Calculation options
 * @param {boolean} options.excludeRamadanDays - Skip Ramadan days for non-Ramadan Sabah calculation
 * @returns {string|null} Minimum sunrise time in format 'HH:MM'
 */
function getMinimumSunriseOfTheWeek(lines, weekIndex, referenceIndex = weekIndex, referenceDate = null, options = {}) {
    const { excludeRamadanDays = false } = options;
    let minSunrise = null;
    let fallbackSunrise = null;
    let fallbackNonRamadanSunrise = null;
    const referenceIsDST = referenceDate ? isDaylightSavingTime(referenceDate) : null;

    // Find the Saturday at or before the given day, never stepping back onto the header line
    const firstDataIndex = lines[0].includes('Miladi Tarih') ? 1 : 0;
    let index = Math.min(weekIndex, lines.length - 1);
    while (index > firstDataIndex) {
        const parts = lines[index].split(',');
        if (parts[0].endsWith("Cumartesi")) {
            break;
        }
        index--;
    }

    // Iterate through the week starting from Saturday
    for (let i = 0; i < 7; i++) {
        if (index >= lines.length) break;

        const parts = lines[index].split(',');
        const hijriDate = parts[1];
        const gunes = parts[3]; // Güneş time

        // Skip malformed rows so they cannot produce a bogus minimum sunrise
        if (!/^\d{1,2}:\d{2}$/.test(gunes || '')) {
            console.warn('Skipping row with invalid Güneş time:', lines[index]);
            index++;
            continue;
        }
        const gunesMinutes = timeToMinutes(gunes);

        if (fallbackSunrise === null || gunesMinutes < timeToMinutes(fallbackSunrise)) {
            fallbackSunrise = gunes;
        }

        if (excludeRamadanDays && isRamadanDate(hijriDate)) {
            index++;
            continue;
        }

        if (fallbackNonRamadanSunrise === null || gunesMinutes < timeToMinutes(fallbackNonRamadanSunrise)) {
            fallbackNonRamadanSunrise = gunes;
        }

        if (referenceDate) {
            const candidateDate = shiftDate(referenceDate, index - referenceIndex);
            if (isDaylightSavingTime(candidateDate) !== referenceIsDST) {
                index++;
                continue;
            }
        }

        if (minSunrise === null || gunesMinutes < timeToMinutes(minSunrise)) {
            minSunrise = gunes;
        }
        index++;
    }
    return minSunrise || fallbackNonRamadanSunrise || fallbackSunrise;
}

/**
 * Formats minutes since midnight as 'HH:MM'
 * @param {number} totalMinutes - Minutes since midnight
 * @returns {string} Time in format 'HH:MM'
 */
function formatMinutes(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Calculates Sabah (dawn) prayer time minutes based on sunrise
 * @param {number} gunesMinutes - Sunrise in minutes since midnight
 * @returns {number} Sabah time in minutes
 */
function calculateSabahMinutes(gunesMinutes) {
    let sabahMinutes = gunesMinutes - SETTINGS.SABAH_OFFSET_MINUTES;
    sabahMinutes = Math.floor(sabahMinutes / 15) * 15;

    // Max 07:30
    if (sabahMinutes > 450) {
        sabahMinutes = 450;
    }
    return sabahMinutes;
}

/**
 * Calculates Sabah during Ramadan: Imsak + offset minutes
 * @param {string} imsakTime - Imsak time in format 'HH:MM'
 * @returns {number} Sabah time in minutes
 */
function calculateRamadanSabahMinutes(imsakTime) {
    return timeToMinutes(imsakTime) + SETTINGS.SABAH_IN_RAMADAN_OFFSET_MINUTES;
}

/**
 * Calculates Sabah from the earliest non-Ramadan sunrise of a Saturday-Friday week
 * @param {string[]} lines - Array of prayer data lines
 * @param {number} weekIndex - Any line index in the target week
 * @param {number} referenceIndex - Line index that corresponds to referenceDate
 * @param {Date} referenceDate - The day we are calculating Sabah for
 * @returns {number|null} Sabah time in minutes, or null when the week has no valid sunrise
 */
function calculateWeekSabahMinutes(lines, weekIndex, referenceIndex, referenceDate) {
    const minSunrise = getMinimumSunriseOfTheWeek(lines, weekIndex, referenceIndex, referenceDate, {
        excludeRamadanDays: true
    });
    return minSunrise ? calculateSabahMinutes(timeToMinutes(minSunrise)) : null;
}

/**
 * Loads and processes prayer times for the current day from the bundled data
 * Calculates Sabah time based on sunrise or Ramadan Imsak
 * @returns {void}
 */
function getPrayerTimes() {
    try {
        const today = getSelectedDate();
        const tomorrowDate = shiftDate(today, 1);
        const dayOfYear = getDayOfYear(today);
        const lines = prayerData.split('\n').filter(line => line.trim()); // Remove empty lines

        // Skip the header line if present
        const startIndex = lines[0].includes('Miladi Tarih') ? 1 : 0;
        const dataIndex = dayOfYear + startIndex;

        // Validate prayer data exists
        if (!lines[dataIndex]) {
            throw new Error(`Prayer data not available for day ${dayOfYear}`);
        }

        const [turkishDate, hijriDate, imsak, gunes, ogle, ikindi, aksam, yatsi] = lines[dataIndex].split(',');
        const tomorrow = lines[dataIndex + 1] ? lines[dataIndex + 1].split(',') : null;
        const todayIsRamadan = isRamadanDate(hijriDate);
        const tomorrowIsRamadan = isRamadanDate(tomorrow ? tomorrow[1] : null);
        const dstChangesTomorrow = Boolean(tomorrow) && isDaylightSavingTime(today) !== isDaylightSavingTime(tomorrowDate);

        const dateStr = today.toLocaleDateString('nl-NL', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        domElements.date.innerHTML = `<p>${dateStr} - ${hijriDate}</p>`;

        const sabahMinutes = todayIsRamadan
            ? calculateRamadanSabahMinutes(imsak)
            : calculateWeekSabahMinutes(lines, dataIndex, dataIndex, today);
        if (sabahMinutes === null) {
            throw new Error(`No valid sunrise data to calculate Sabah for day ${dayOfYear}`);
        }

        // Tomorrow's Ramadan Sabah is shown next to tomorrow's Imsak
        const ramadanSabahTomorrow = () => {
            imsakTimeTomorrow = tomorrow[2];
            return calculateRamadanSabahMinutes(tomorrow[2]);
        };

        let sabahMinutesTomorrow = null;
        let sabahCandidateTomorrow = null; // shown only when it differs from today
        sabahWillBeAdjusted = false;
        imsakTimeTomorrow = null;

        if (dstChangesTomorrow) {
            sabahMinutesTomorrow = tomorrowIsRamadan
                ? ramadanSabahTomorrow()
                : calculateWeekSabahMinutes(lines, dataIndex + 1, dataIndex + 1, tomorrowDate);
            sabahWillBeAdjusted = true;
        }
        else if (todayIsRamadan && tomorrowIsRamadan) {
            // Still in Ramadan tomorrow, no adjustment needed
            sabahMinutesTomorrow = ramadanSabahTomorrow();
        }
        else if (todayIsRamadan && tomorrow) {
            // Tomorrow is Ramadan ending, check adjustment
            sabahCandidateTomorrow = calculateWeekSabahMinutes(lines, dataIndex + 1, dataIndex + 1, tomorrowDate);
        }
        else if (!todayIsRamadan && tomorrowIsRamadan) {
            // Tomorrow is Ramadan starting, sabah will be adjusted (checked before Friday: Ramadan may start on a Saturday)
            sabahMinutesTomorrow = ramadanSabahTomorrow();
            sabahWillBeAdjusted = true;
        }
        else if (!todayIsRamadan && turkishDate.endsWith(SETTINGS.CHECK_DAY)) {
            // Friday: get the minimum sunrise of next week
            const nextWeekIndex = Math.min(dataIndex + 7, lines.length - 1);
            sabahCandidateTomorrow = calculateWeekSabahMinutes(lines, nextWeekIndex, dataIndex + 1, tomorrowDate);
        }

        if (sabahCandidateTomorrow !== null && sabahCandidateTomorrow !== sabahMinutes) {
            sabahMinutesTomorrow = sabahCandidateTomorrow;
            sabahWillBeAdjusted = true;
        }

        const sabahTime = formatMinutes(sabahMinutes);
        sabahTimeTomorrow = sabahMinutesTomorrow !== null ? formatMinutes(sabahMinutesTomorrow) : null;

        // Build prayer times object
        prayerTimes = {
            'imsak': { time: imsak, ...SETTINGS.PRAYER_TRANSLATIONS.imsak },
            'sabah': { time: sabahTime, ...SETTINGS.PRAYER_TRANSLATIONS.sabah },
            'gunes': { time: gunes, ...SETTINGS.PRAYER_TRANSLATIONS.gunes },
            'ogle': { time: ogle, ...SETTINGS.PRAYER_TRANSLATIONS.ogle },
            'ikindi': { time: ikindi, ...SETTINGS.PRAYER_TRANSLATIONS.ikindi },
            'aksam': { time: aksam, ...SETTINGS.PRAYER_TRANSLATIONS.aksam },
            'yatsi': { time: yatsi, ...SETTINGS.PRAYER_TRANSLATIONS.yatsi }
        };

        // Cache prayer array for efficient lookups
        prayerArray = Object.entries(prayerTimes);
        lastPrayerListHtml = null;
    }
    catch (error) {
        console.error('Error loading prayer times:', error);
        renderPrayerListHtml('<p class="error">Fout bij het laden van gebedstijden: ' + error.message + '</p>');
    }
}

/**
 * Determines which prayer is next
 * @returns {Object|null} Object with key, prayer, and minutes to prayer, or null if none upcoming
 */
function getNextPrayer() {
    const now = getTestTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const [key, prayer] of prayerArray) {
        const prayerMinutes = timeToMinutes(prayer.time);
        if (prayerMinutes > currentMinutes) {
            return { key, prayer, minutes: prayerMinutes - currentMinutes };
        }
    }
    return null;
}

/**
 * Updates the prayer times display with current status and countdowns
 * Highlights current and next prayer times
 * @returns {void}
 */
function updatePrayerList() {
    // Guard against empty prayer data
    if (!prayerArray || prayerArray.length === 0) {
        renderPrayerListHtml('<p class="info">Gebedstijden niet beschikbaar</p>');
        return;
    }

    const next = getNextPrayer();
    const now = getTestTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const isCurrentPrayer = (key, prayer) => {
        const minutesSincePrayer = currentMinutes - timeToMinutes(prayer.time);
        return minutesSincePrayer >= 0 && minutesSincePrayer < getCurrentPrayerThresholdMinutes(key);
    };
    const isAnyCurrent = prayerArray.some(([key, prayer]) => isCurrentPrayer(key, prayer));

    // Compute prayer display data (single pass)
    const prayerDisplayData = prayerArray.map(([key, prayer]) => {
        const [hours, minutes] = prayer.time.split(':').map(Number);
        const isCurrent = isCurrentPrayer(key, prayer);
        const isNext = !isAnyCurrent && next && next.key === key;

        let countdown = '';
        if (isNext) {
            const target = new Date(now);
            target.setHours(hours, minutes, 0, 0);
            let totalSeconds = Math.ceil((target.getTime() - now.getTime()) / 1000);
            if (totalSeconds < 0) totalSeconds = 0;

            const totalMinutes = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;

            const hh = Math.floor(totalMinutes / 60);
            const mm = totalMinutes % 60;

            let timerText;
            if (totalMinutes < 1) {
                timerText = `${secs}s`;
            }
            else if (totalMinutes < 10) {
                timerText = `${mm}m ${secs}s`;
            }
            else {
                timerText = hh > 0 ? `${hh}u ${mm}m` : `${mm}m`;
            }

            const countdownClass = totalMinutes < SETTINGS.SOON_COUNTDOWN_THRESHOLD_MINUTES ? ' soon' : '';
            countdown = `<span class="countdown-inline${countdownClass}">${timerText}</span>`;
        }

        return { key, prayer, isCurrent, isNext, countdown };
    });

    // Render prayer list
    let html = '<div class="prayer-list">';
    for (const { key, prayer, isCurrent, isNext, countdown } of prayerDisplayData) {
        html += `
          <div class="prayer-item ${isNext ? 'next' : ''} ${isCurrent ? 'current' : ''} ${key === 'sabah' && sabahWillBeAdjusted ? 'sabah-will-be-adjusted' : ''}">
            <span class="prayer-name-left">
              <span class="lang-nl">${prayer.nl}</span>
              <span class="lang-tr">${prayer.tr}</span>
            </span>
            <span class="prayer-time-wrapper">
              <span class="prayer-time">${prayer.time}</span>
              ${countdown}
            </span>
            <span class="prayer-name-right">
              <span class="tomorrow">${key === 'sabah' && sabahTimeTomorrow ? sabahTimeTomorrow : ''}
                ${key === 'imsak' && imsakTimeTomorrow ? imsakTimeTomorrow : ''}
              </span>
              <span class="lang-ar">${prayer.ar}</span>
            </span>
          </div>
        `;
    }
    html += '</div>';
    renderPrayerListHtml(html);
}

/**
 * Updates current time display and prayer list
 * At midnight, reloads the page (served from cache when offline) or recalculates for the new day
 * @returns {void}
 */
function updateTime() {
    const now = getTestTime();
    domElements.currentTime.textContent = now.toLocaleTimeString('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Check if the date has changed (midnight)
    const currentDate = now.getDate();
    if (lastDate !== null && lastDate !== currentDate) {
        // Reloading is safe when the service worker controls the page (it serves the cache if offline)
        if ((navigator.serviceWorker && navigator.serviceWorker.controller) || navigator.onLine) {
            window.location.reload();
        }
        else {
            // Prayer data is bundled locally, so recalculate for the new day without reloading
            getPrayerTimes();
        }
    }
    lastDate = currentDate;

    updateNightMode(now.getHours() * 60 + now.getMinutes());
    updatePrayerList();
}

/**
 * Runs updateTime right after each full second so the clock never drifts or skips a second
 * @returns {void}
 */
function scheduleUpdateTime() {
    setTimeout(() => {
        updateTime();
        scheduleUpdateTime();
    }, 1000 - (Date.now() % 1000) + 10);
}

/**
 * Keeps the screen from dimming or sleeping while the page is visible
 * @returns {Promise<void>}
 */
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        wakeLockStatus = 'not supported';
        return;
    }
    if (document.visibilityState !== 'visible') {
        return;
    }
    try {
        const wakeLock = await navigator.wakeLock.request('screen');
        wakeLockStatus = 'active';
        // The browser can also release the lock while the page stays visible (e.g. battery saver)
        wakeLock.addEventListener('release', () => {
            wakeLockStatus = 'released';
            setTimeout(requestWakeLock, 1000);
        });
    }
    catch (error) {
        wakeLockStatus = 'denied (' + error.name + ')';
        console.warn('Wake lock request failed:', error);
    }
}

// Initial load
cacheDOMElements();
if (!domElements.prayerTimes || !domElements.date || !domElements.currentTime) {
    console.error('Required DOM elements not found');
}
getPrayerTimes();
updateTime();
scheduleUpdateTime();

// The browser releases the wake lock when the page is hidden, so request it again when visible
requestWakeLock();
document.addEventListener('visibilitychange', requestWakeLock);
if (isTestMode) {
    setInterval(() => {
        testMinutes++;
    }, 100);
}


// Cache the app for offline use (requires https or localhost)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(error => {
        console.warn('Service worker registration failed:', error);
    });
}

// Apply rotation based on URL parameters
if (searchParams.has('l')) {
    document.body.classList.add('rotate-left');
}
else if (searchParams.has('r')) {
    document.body.classList.add('rotate-right');
}
