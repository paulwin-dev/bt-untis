import * as untis from "../untis.js"
import * as storage from "./storage.js"
import * as notifications from "./notifications.js"

const PREFETCH_BEFORE_WEEKS = 3
const PREFETCH_AFTER_WEEKS = 5

let session;
let scheduleDefinition;
let curDetailsData;
let currentWeek = 0;

const grid = document.getElementById("schedule-grid")
const details = document.getElementById("schedule-details")
const detailsHwTemplate = document.getElementById("schedule-details-hw-temp")

const weekCache = new Map()

function isToday(date) {
    const t = new Date();
    return date.getFullYear() === t.getFullYear() &&
           date.getMonth()    === t.getMonth()    &&
           date.getDate()     === t.getDate();
}

async function prefetchWeeks(start, before, after) {
	for (let i = (start - before); i < (start + after); i++) {
		if (weekCache.has(i)) continue;

		const { periods, dayStatuses } = await untis.getTimetable(session, i)
		weekCache.set(i, { periods, dayStatuses })
	}
}

function getDateKey(dayDate) {
	return `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
}

//attempts to remove levels such as "AP", "GK", "Grunndkurs", etc from course names
function removeLevelFromCourseName(courseName) {
	return courseName.replace("GK", "").replace("AP", "").replace("Grundkurs", "").replace("Leistungskurs", "")
}

async function openDetailsPanel(period, dateKey) {
	const customData = await storage.getCustomPeriodData(dateKey, period.startTime) ?? {}
	curDetailsData = { period, dateKey, customData }

	history.pushState({ panel: 'details' }, '')

    details.hidden = false
    details.querySelector("#schedule-details-header").textContent = period.subject?.longname + " - " + period.subject?.name ?? "?"
	
	const note = period.notes?.length > 0 ? period.notes : null
	if (note) {
		details.querySelector("#schedule-details-nfs-header").hidden = false
		details.querySelector("#schedule-details-nfs").hidden = false
		details.querySelector("#schedule-details-nfs").textContent = period.notes
	} else {
		details.querySelector("#schedule-details-nfs-header").hidden = true
		details.querySelector("#schedule-details-nfs").hidden = true
	}

    const badge = details.querySelector("#schedule-details-status")
    badge.textContent = period.isExam ? "Klausur" : period.isChanged ? "Substitution" : ""
    badge.hidden = !period.isExam && !period.isChanged

	//note for self
	details.querySelector("#schedule-details-own-notes").value = customData.note?.length > 0 ? customData.note : ""
}


async function closeDetailsPanel() {
	history.back()
	details.hidden = true

	if (!curDetailsData) return;

	const { period, dateKey, customData } = curDetailsData
	const notesText = details.querySelector("#schedule-details-own-notes").value
	if (notesText === customData.note) return
	if (notesText === "" && !customData?.note) return;

	await storage.putCustomPeriodData(curDetailsData.homework, notesText, dateKey, period.startTime)
	notifications.notify("Saved new note.", "info")
}

async function loadWeek(session, weekOffset, direction = 0) {
    currentWeek = weekOffset

    if (direction !== 0) {
        grid.classList.add(direction > 0 ? 'slide-out-left' : 'slide-out-right')
        await new Promise(r => setTimeout(r, 200))
    }

    function finishAnimation() {
        if (direction !== 0) {
            grid.classList.remove('slide-out-left', 'slide-out-right')
            grid.classList.add(direction > 0 ? 'slide-in-left' : 'slide-in-right')
            grid.offsetHeight
            grid.classList.remove('slide-in-left', 'slide-in-right')
        }
    }

    const definition = scheduleDefinition
    if (!definition) {
        notifications.notify("No offline data available", "error")
        finishAnimation()
        throw new Error('no definition')
    }

    let periods
    let dayStatuses

    if (weekCache.has(weekOffset)) {
        ({ periods, dayStatuses } = weekCache.get(weekOffset));
    } else {
        // try IndexedDB first
        const cached = await storage.loadWeekCache(weekOffset)
        if (cached) {
            periods     = cached.periods
            dayStatuses = cached.dayStatuses
            weekCache.set(weekOffset, { periods, dayStatuses })
        }

        // fetch fresh data if online and have a session
        if (session && navigator.onLine) {
            try {
                ({ periods, dayStatuses } = await untis.getTimetable(session, weekOffset));
                weekCache.set(weekOffset, { periods, dayStatuses });
                await storage.saveWeekCache(weekOffset, { periods, dayStatuses })
            } catch (e) {
                if (!cached) {
                    notifications.notify("Failed to load timetable", "error")
                    finishAnimation()
                    throw new Error('failed to load')
                }
                // fall through using cached data
            }
        } else if (!cached) {
            notifications.notify("No offline data for this week", "error")
            finishAnimation()
            throw new Error('no cached data')
        }
    }

    const byDay = untis.groupByDay(periods)
    const timeslots = definition.slots
    const skip = new Set()

    const monday = untis.addDays(untis.getMonday(), weekOffset * 7);
    const headers = document.getElementById("schedule-day-headers");
    headers.textContent = "";
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const today = new Date();
    for (let day = 0; day < 5; day++) {
        const dayDate = untis.addDays(monday, day);
        const isToday = dayDate.toDateString() === today.toDateString();
        const el = document.createElement("div");
        el.className = "schedule-day-header" + (isToday ? " today" : "");
        el.innerHTML = `
            <span class="day-name">${dayNames[day]}</span>
            <span class="day-number">${dayDate.getDate()}</span>
        `;
        headers.appendChild(el);
    }

    grid.textContent = ""

    for (let slotIndex = 0; slotIndex < timeslots.length; slotIndex++) {
        const slot = timeslots[slotIndex];
        for (let day = 0; day < 5; day++) {
            if (skip.has(`${day}-${slot.startInt}`)) continue;

            const dayDate = untis.addDays(monday, day)
            const dateKey = getDateKey(dayDate)
            const dayMeta = dayStatuses[dateKey]
            const isPast = dayDate < new Date() && !isToday(dayDate)

            const isHoliday = dayMeta?.backEntries?.some(e => e.type == "HOLIDAY")
            if (isHoliday) {
                if (slotIndex != 0) continue;
                const cell = document.createElement("div")
                cell.className = "schedule-cell holiday"
                cell.style.gridColumn = `${day + 1}`
                cell.style.gridRow = `span ${timeslots.length}`
                cell.innerHTML = `<span class="subject-long">${dayMeta.backEntries[0].name ?? "Holiday"}</span>`
                grid.appendChild(cell)
                continue
            }

            const period = byDay[day].find(p => p.startTime === slot.startInt);

            let span = 1;
            if (period) {
                while (
                    slotIndex + span < timeslots.length &&
                    timeslots[slotIndex + span].startInt < period.endTime
                ) {
                    skip.add(`${day}-${timeslots[slotIndex + span].startInt}`);
                    span++;
                }
            }

            const cell = document.createElement("div");
            cell.className = "schedule-cell";
            cell.style.gridColumn = `${day + 1}`;
            cell.style.gridRow = `span ${span}`;

            if (period) {
                const customData = await storage.getCustomPeriodData(dateKey, period.startTime)
                if (customData?.homework?.length > 0) cell.classList.add("homework")

                const courseName = removeLevelFromCourseName(period.subject?.longname ?? "")
                cell.classList.add(period.status)
                if (period.isExam) cell.classList.add("exam")
                if (isPast) cell.classList.add("past")

                cell.innerHTML = `
                    <span class="subject-long">${courseName || "?"}</span>
                    <span class="subject-short">${period.subject?.name ?? "?"}</span>
                    <span class="room">${period.rooms[0]?.name ?? ""}</span>
                    <div class="cell-indicators">
                        ${customData?.note?.length > 0 ? CUSTOM_DATA_ICON : ''}
                        ${period.notes?.length > 0 ? TEACHER_NOTE_ICON : ''}
                    </div>
                `
                cell.addEventListener("click", () => openDetailsPanel(period, dateKey))
            } else {
                cell.classList.add("free")
            }

            grid.appendChild(cell)
        }
    }

    finishAnimation()
    prefetchWeeks(weekOffset, PREFETCH_BEFORE_WEEKS, PREFETCH_AFTER_WEEKS)
}

export async function load(_session) {
    session = _session

    // student name
    let studentName = null
    if (session) {
        studentName = untis.getNameFromToken(session)
        if (studentName) await storage.saveStudentName(studentName)
    } else {
        studentName = await storage.loadStudentName()
    }
    document.querySelector("#schedule-user").textContent = studentName ?? "?"

    // definition
    if (session && navigator.onLine) {
        try {
            scheduleDefinition = await untis.getTimetableDefinition(session)
            await storage.saveDefinition(scheduleDefinition)
        } catch {
            scheduleDefinition = await storage.loadDefinition()
        }
    } else {
        scheduleDefinition = await storage.loadDefinition()
    }

    await loadWeek(session, 0)
}

details.querySelector(".close-button").addEventListener("click", closeDetailsPanel)

//swipe to switch weeks
let touchStartX = 0
let weekOffset = 0

grid.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX
}, { passive: true })

grid.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX
    if (Math.abs(diff) < 50) return
    
    const prevOffset = weekOffset
    if (diff > 0) weekOffset++
    else weekOffset--
    
    loadWeek(session, weekOffset, diff).catch(() => {
        weekOffset = prevOffset  // revert to previous offset
    })
})

window.addEventListener('popstate', e => {
    //empty for now, adds support for back button
})

const CUSTOM_DATA_ICON = `<svg class="note-indicator" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`
const TEACHER_NOTE_ICON = `<svg class="note-indicator" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>`