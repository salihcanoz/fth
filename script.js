// ===== SETTINGS =====
const SETTINGS = {
    MONTHS: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
    SABAH_OFFSET_MINUTES: 40,
    CURRENT_PRAYER_THRESHOLD_MINUTES: 3,
    PRAYER_TRANSLATIONS: {
        'imsak': {nl: 'Dageraad', tr: 'İmsak', ar: 'الإمساك'},
        'sabah': {nl: 'Ochtend', tr: 'Sabah', ar: 'الفجر'},
        'gunes': {nl: 'Zonsopgang', tr: 'Güneş', ar: 'الشروق'},
        'ogle': {nl: 'Middag', tr: 'Öğle', ar: 'الظهر'},
        'ikindi': {nl: 'Namiddag', tr: 'İkindi', ar: 'العصر'},
        'aksam': {nl: 'Avond', tr: 'Akşam', ar: 'المغرب'},
        'yatsi': {nl: 'Nacht', tr: 'Yatsı', ar: 'العشاء'}
    }
};

// ===== STATE =====
let prayerTimes = {};
const isTestMode = window.location.search.includes('test');
const rotateLeft = window.location.search.includes('l');
const rotateRight = window.location.search.includes('r');
let testMinutes = 0;
let lastDate = null;

if (rotateLeft) {
    document.body.classList.add('rotate-left');
}
else if (rotateRight) {
    document.body.classList.add('rotate-right');
}

function getTestTime() {
    if (!isTestMode)
        return new Date();

    let now = new Date();
    now.setMinutes(now.getMinutes() + testMinutes);
    return now;
}

async function getPrayerTimes() {
    try {
        const today = new Date();
        const lines = prayerData.split('\n');
        const todayStr = `${today.getDate().toString().padStart(2, '0')} ${SETTINGS.MONTHS[today.getMonth()]} ${today.getFullYear()}`;
        let hicriDate = '';

        for (let i = 1; i < lines.length; i++) {
            if (lines[i].includes(todayStr)) {
                const parts = lines[i].split(',');

                // Calculate Sabah: offset minutes (15) before Güneş, rounded down to specified minutes
                const [gunesH, gunesM] = parts[3].split(':').map(Number);
                let sabahMinutes = gunesH * 60 + gunesM - SETTINGS.SABAH_OFFSET_MINUTES;
                sabahMinutes = Math.floor(sabahMinutes / 15) * 15;

                // Max 07:30
                if (sabahMinutes > 450) {
                    sabahMinutes = 450;
                }

                const sabahH = Math.floor(sabahMinutes / 60);
                const sabahM = sabahMinutes % 60;
                const sabahTime = `${sabahH.toString().padStart(2, '0')}:${sabahM.toString().padStart(2, '0')}`;
                hicriDate = parts[1];

                prayerTimes = {
                    'imsak': {time: parts[2], ...SETTINGS.PRAYER_TRANSLATIONS.imsak},
                    'sabah': {time: sabahTime, ...SETTINGS.PRAYER_TRANSLATIONS.sabah},
                    'gunes': {time: parts[3], ...SETTINGS.PRAYER_TRANSLATIONS.gunes},
                    'ogle': {time: parts[4], ...SETTINGS.PRAYER_TRANSLATIONS.ogle},
                    'ikindi': {time: parts[5], ...SETTINGS.PRAYER_TRANSLATIONS.ikindi},
                    'aksam': {time: parts[6], ...SETTINGS.PRAYER_TRANSLATIONS.aksam},
                    'yatsi': {time: parts[7], ...SETTINGS.PRAYER_TRANSLATIONS.yatsi}
                };
                break;
            }
        }

        const dateStr = today.toLocaleDateString('nl-NL', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        document.getElementById('date').innerHTML = `<p>${dateStr} - ${hicriDate}</p>`;
        updatePrayerList();
    }
    catch (error) {
        document.getElementById('prayer-times').innerHTML = '<p class="error">Fout bij het laden van gebedstijden</p>';
    }
}

function getNextPrayer() {
    const now = getTestTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const [key, prayer] of Object.entries(prayerTimes)) {
        const [hours, minutes] = prayer.time.split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        if (prayerMinutes > currentMinutes) {
            return {key, prayer, minutes: prayerMinutes - currentMinutes};
        }
    }
    return null;
}

function updatePrayerList() {
    const next = getNextPrayer();
    const now = getTestTime();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let isAnyCurrent = false;
    for (const [key, prayer] of Object.entries(prayerTimes)) {
        const [hours, minutes] = prayer.time.split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        const minutesSincePrayer = currentMinutes - prayerMinutes;
        if (minutesSincePrayer >= 0 && minutesSincePrayer < SETTINGS.CURRENT_PRAYER_THRESHOLD_MINUTES) {
            isAnyCurrent = true;
            break;
        }
    }

    let html = '<div class="prayer-list">';
    for (const [key, prayer] of Object.entries(prayerTimes)) {
        const [hours, minutes] = prayer.time.split(':').map(Number);
        const prayerMinutes = hours * 60 + minutes;
        const minutesSincePrayer = currentMinutes - prayerMinutes;

        const isCurrent = minutesSincePrayer >= 0 && minutesSincePrayer < SETTINGS.CURRENT_PRAYER_THRESHOLD_MINUTES;
        const isNext = !isAnyCurrent && next && next.key === key;
        let countdown = '';

        if (isNext) {
            // Compute the exact remaining seconds (no "60s", no +1 minute)
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

        html += `
          <div class="prayer-item ${isNext ? 'next' : ''} ${isCurrent ? 'current' : ''}">
            <span class="prayer-name-left">
              <span class="lang-nl">${prayer.nl}</span>
              <span class="lang-tr">${prayer.tr}</span>
            </span>
            <span class="prayer-time-wrapper">
              <span class="prayer-time">${prayer.time}</span>
              ${countdown}
            </span>
            <span class="prayer-name-right">
              <span class="lang-ar">${prayer.ar}</span>
            </span>
          </div>
        `;
    }
    html += '</div>';
    document.getElementById('prayer-times').innerHTML = html;
}

function updateTime() {
    const now = getTestTime();
    document.getElementById('current-time').textContent = now.toLocaleTimeString('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Check if the date has changed (midnight)
    const currentDate = now.getDate();
    if (lastDate !== null && lastDate !== currentDate) {
        getPrayerTimes();
    }
    lastDate = currentDate;

    updatePrayerList();
}

getPrayerTimes();
updateTime();
setInterval(updateTime, 1000);
if (isTestMode) setInterval(() => testMinutes++, 100);
