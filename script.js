// ===== SETTINGS =====
const SETTINGS = {
    SABAH_OFFSET_MINUTES: 30,
    SABAH_IN_RAMADAN_OFFSET_MINUTES: 20,
    CURRENT_PRAYER_THRESHOLD_MINUTES: 3,
    CHECK_DAY: 'Cuma',
    PRAYER_TRANSLATIONS: {
        'imsak': { nl: 'Dageraad', tr: 'İmsak', ar: 'الإمساك' },
        'sabah': { nl: 'Ochtend', tr: 'Sabah', ar: 'الفجر' },
        'gunes': { nl: 'Zonsopgang', tr: 'Güneş', ar: 'الشروق' },
        'ogle': { nl: 'Middag', tr: 'Öğle', ar: 'الظهر' },
        'ikindi': { nl: 'Namiddag', tr: 'İkindi', ar: 'العصر' },
        'aksam': { nl: 'Avond', tr: 'Akşam', ar: 'المغرب' },
        'yatsi': { nl: 'Nacht', tr: 'Yatsı', ar: 'العشاء' }
    }
};

// ===== STATE =====
let prayerTimes = {};
let prayerArray = [];
const isTestMode = window.location.search.includes('test');
let testMinutes = 0;
let lastDate = null;
let sabahWillBeAdjusted = false;
let sabahTimeTomorrow = null;
let imsakTimeTomorrow = null;

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
 * Calculates the day of the year (1-365/366)
 * @param {Date} date - The date to calculate for
 * @returns {number} Day of year (0-based index)
 */
function getDayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
}

/**
 * Gets the current time or test time if in test mode
 * @returns {Date} Current or test time
 */
function getTestTime() {
    if (!isTestMode)
        return new Date();

    const now = new Date().getTime();
    let startOfDay = new Date(now - (now % 86400000));
    startOfDay.setMinutes(startOfDay.getMinutes() + testMinutes);
    return startOfDay;
}

/**
 * Finds the minimum sunrise time in the week starting from a given day
 * @param {string[]} lines - Array of prayer data lines
 * @param {number} dayOfYear - Day of year (1-based index)
 * @returns {string|null} Minimum sunrise time in format 'HH:MM'
 */
function getMinimumSunriseOfTheWeek(lines, dayOfYear) {
    let minSunrise = null;

    // Find the Saturday at or before the given day
    let index = Math.min(dayOfYear, lines.length - 1);
    while (index > 0) {
        const parts = lines[index].split(',');
        if (parts[0].endsWith("Cumartesi")) {
            //previous Friday found, go one step forward to get Saturday
            //index++;
            break;
        }
        index--;
    }

    // Iterate through the week starting from Saturday
    for (let i = 0; i < 7; i++) {
        if (index >= lines.length) break;

        const gunes = lines[index].split(',')[3]; // Güneş time

        if (minSunrise === null || gunes < minSunrise) {
            minSunrise = gunes;
        }
        index++;
    }
    return minSunrise;
}

/**
 * Calculates Sabah (dawn) prayer time minutes based on sunrise
 * @param {number} gunesH - Sunrise hour
 * @param {number} gunesM - Sunrise minute
 * @returns {number} Sabah time in minutes
 */
function calculateSabahMinutes(gunesH, gunesM) {
    const gunesMinutes = gunesH * 60 + gunesM;
    let sabahMinutes = gunesMinutes - SETTINGS.SABAH_OFFSET_MINUTES;
    sabahMinutes = Math.floor(sabahMinutes / 15) * 15;

    // Max 07:30
    if (sabahMinutes > 450) {
        sabahMinutes = 450;
    }
    return sabahMinutes;
}

/**
 * Fetches and processes prayer times for the current day
 * Calculates Sabah time based on sunrise or Ramadan Imsak
 * @returns {Promise<void>}
 */
async function getPrayerTimes() {
    try {
        const today = new Date();
        let dayOfYear = getDayOfYear(today);
        const lines = prayerData.split('\n').filter(line => line.trim()); // Remove empty lines

        // Skip the header line if present
        const startIndex = lines[0].includes('Miladi Tarih') ? 1 : 0;
        const dataIndex = dayOfYear + startIndex;

        // Validate prayer data exists
        if (!lines[dataIndex]) {
            throw new Error(`Prayer data not available for day ${dayOfYear}`);
        }

        const [turkishDate, hijriDate, imsak, gunes, ogle, ikindi, aksam, yatsi] = lines[dataIndex].split(',');
        const tomorrrow = lines[dataIndex + 1].split(',');

        const dateStr = today.toLocaleDateString('nl-NL', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        domElements.date.innerHTML = `<p>${dateStr} - ${hijriDate}</p>`;

        let sabahMinutes;
        let sabahMinutesTomorrow;
        sabahTimeTomorrow = null;

        if (hijriDate.includes('Ramazan')) {
            // Calculate Sabah in Ramadan: Imsak + offset minutes (20)
            sabahMinutes = timeToMinutes(imsak) + SETTINGS.SABAH_IN_RAMADAN_OFFSET_MINUTES;
            const tomorrowHijriDate = tomorrrow[1];
            if (tomorrowHijriDate.includes('Ramazan')) {
                // Still in Ramadan tomorrow, no adjustment needed
                sabahWillBeAdjusted = false;
                sabahMinutesTomorrow = timeToMinutes(tomorrrow[2]) + SETTINGS.SABAH_IN_RAMADAN_OFFSET_MINUTES;
                imsakTimeTomorrow = tomorrrow[2];
            }
            else {
                // Tomorrow is Ramadan ending, check adjustment
                const gunesMinutes = timeToMinutes(getMinimumSunriseOfTheWeek(lines, dataIndex + 1));
                const gunesH = Math.floor(gunesMinutes / 60);
                const gunesM = gunesMinutes % 60;
                const sabahMinutesN = calculateSabahMinutes(gunesH, gunesM);
                sabahWillBeAdjusted = sabahMinutes !== sabahMinutesN;
                if (sabahWillBeAdjusted) {
                    sabahMinutesTomorrow = sabahMinutesN;
                }
            }
        }
        else {
            const gunesMinutes = timeToMinutes(getMinimumSunriseOfTheWeek(lines, dataIndex));
            const gunesH = Math.floor(gunesMinutes / 60);
            const gunesM = gunesMinutes % 60;
            sabahMinutes = calculateSabahMinutes(gunesH, gunesM);

            // get the minimum sunrise of next week if today is Friday
            if (turkishDate.endsWith(SETTINGS.CHECK_DAY)) {
                const nextWeekIndex = Math.min(dataIndex + 7, lines.length - 1);
                const gunesNMinutes = timeToMinutes(getMinimumSunriseOfTheWeek(lines, nextWeekIndex));
                if (gunesNMinutes > 0) {
                    const gunesNH = Math.floor(gunesNMinutes / 60);
                    const gunesNM = gunesNMinutes % 60;
                    const sabahMinutesN = calculateSabahMinutes(gunesNH, gunesNM);
                    sabahWillBeAdjusted = sabahMinutes !== sabahMinutesN;
                    if (sabahWillBeAdjusted) {
                        sabahMinutesTomorrow = sabahMinutesN;
                    }
                }
                else {
                    sabahWillBeAdjusted = false;
                }
            }
            else if (tomorrrow[1].includes('Ramazan')) {
                // Tomorrow is Ramadan starting, sabah will be adjusted
                sabahWillBeAdjusted = true;
                sabahMinutesTomorrow = timeToMinutes(tomorrrow[2]) + SETTINGS.SABAH_IN_RAMADAN_OFFSET_MINUTES;
                imsakTimeTomorrow = tomorrrow[2];
            }
            else {
                sabahWillBeAdjusted = false;
            }
        }

        const sabahH = Math.floor(sabahMinutes / 60);
        const sabahM = sabahMinutes % 60;
        const sabahTime = `${sabahH.toString().padStart(2, '0')}:${sabahM.toString().padStart(2, '0')}`;

        if (sabahMinutesTomorrow !== undefined) {
            const sabahNH = Math.floor(sabahMinutesTomorrow / 60);
            const sabahNM = sabahMinutesTomorrow % 60;
            sabahTimeTomorrow = `${sabahNH.toString().padStart(2, '0')}:${sabahNM.toString().padStart(2, '0')}`;
        }

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
    }
    catch (error) {
        console.error('Error loading prayer times:', error);
        domElements.prayerTimes.innerHTML = '<p class="error">Fout bij het laden van gebedstijden: ' + error.message + '</p>';
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
        domElements.prayerTimes.innerHTML = '<p class="info">Gebedstijden niet beschikbaar</p>';
        return;
    }

    const next = getNextPrayer();
    const now = getTestTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // First pass: determine if any prayer is current
    let isAnyCurrent = false;
    for (const [key, prayer] of prayerArray) {
        const prayerMinutes = timeToMinutes(prayer.time);
        const minutesSincePrayer = currentMinutes - prayerMinutes;
        if (minutesSincePrayer >= 0 && minutesSincePrayer < SETTINGS.CURRENT_PRAYER_THRESHOLD_MINUTES) {
            isAnyCurrent = true;
            break;
        }
    }

    // Compute prayer display data (single pass)
    const prayerDisplayData = prayerArray.map(([key, prayer]) => {
        const prayerMinutes = timeToMinutes(prayer.time);
        const [hours, minutes] = prayer.time.split(':').map(Number);
        const minutesSincePrayer = currentMinutes - prayerMinutes;
        const isCurrent = minutesSincePrayer >= 0 && minutesSincePrayer < SETTINGS.CURRENT_PRAYER_THRESHOLD_MINUTES;
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

            countdown = `<span class="countdown-inline">${timerText}</span>`;
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
    domElements.prayerTimes.innerHTML = html;
}

/**
 * Updates current time display and prayer list
 * Reloads page at midnight if online
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
        if (navigator.onLine) {
            window.location.reload();
        }
        // else {
        //     getPrayerTimes();
        // }
    }
    lastDate = currentDate;

    updatePrayerList();
}

// Initial load
cacheDOMElements();
if (!domElements.prayerTimes || !domElements.date || !domElements.currentTime) {
    console.error('Required DOM elements not found');
}
getPrayerTimes();
updateTime();
setInterval(updateTime, 1000);
if (isTestMode) {
    setInterval(() => {
        testMinutes++;
    }, 100);
}


// Apply rotation based on URL parameters
if (window.location.search.includes('l')) {
    document.body.classList.add('rotate-left');
}
else if (window.location.search.includes('r')) {
    document.body.classList.add('rotate-right');
}
