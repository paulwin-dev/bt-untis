import * as untis from "../untis.js"
import * as storage from "./storage.js"
import * as notifications from "./notifications.js"

const PREFETCH_BEFORE_WEEKS = 3
const PREFETCH_AFTER_WEEKS = 5

const CUSTOM_DATA_ICON = `<svg class="note-indicator" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`
const TEACHER_NOTE_ICON = `<svg class="note-indicator" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>`
const HOMEWORK_ICON = `<svg class="note-indicator" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`

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

function intToMinutes(t) {
    const h = Math.floor(t / 100)
    const m = t % 100
    return h * 60 + m
}

function getWeekKey(weekOffset) {
    const monday = untis.addDays(untis.getMonday(), weekOffset * 7)
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`
}

function offlineCacheWeek(weekOffset, week) {
    const weekKey = getWeekKey(weekOffset)
    storage.saveWeekCache(weekKey, week)
}

function inMemoryCacheWeek(weekOffset, week) {
    weekCache.set(weekOffset, week)
}

async function prefetchWeeks(start, before, after) {
	for (let i = (start - before); i < (start + after); i++) {
		if (weekCache.has(i)) continue;

		const { periods, dayStatuses } = await untis.getTimetable(session, i)
        const data = { periods, dayStatuses }
		weekCache.set(i, data)
        offlineCacheWeek(i, data)
	}
}

function getDateKey(dayDate) {
	return `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
}

//attempts to remove levels such as "AP", "GK", "Grunndkurs", etc from course names
function removeLevelFromCourseName(courseName) {
	return courseName.replace("GK", "").replace("AP", "").replace("Grundkurs", "").replace("Leistungskurs", "")
}

function createHomeworkItem(text, completed, apiId, fromTeacher) {
    const item = detailsHwTemplate.content.cloneNode(true).firstElementChild
    item.dataset.apiId = apiId ?? ""

    const label = item.querySelector("p")
    label.textContent = text
    if (completed) label.style.textDecoration = "line-through"

    const completeBtn = item.querySelector(".complete-homework-button")
    if (completed) completeBtn.classList.add("completed")
    completeBtn.addEventListener("click", async () => {
        const isCompleted = completeBtn.classList.toggle("completed")
        label.style.textDecoration = isCompleted ? "line-through" : ""
        if (apiId) {
            await storage.setHomeworkCompleted(apiId, isCompleted)
        }
    })

    const deleteBtn = item.querySelector(".delete-button")

    if (fromTeacher) {
        deleteBtn.remove()
    } else {
        const deleteBtn = item.querySelector(".delete-button")
        deleteBtn.addEventListener("click", () => item.remove())
    }

    return item
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

    //homework
    const hwList = details.querySelector("#schedule-details-hw-list")
    hwList.textContent = ""

    const completedHomework = await storage.getCompletedHomework()
    let homeworks

    if (session && navigator.onLine) {
        ({ homeworks } = await untis.getPeriodDetails(session, period) ?? [])
        storage.saveHomeworkCache(period.date, period.startTime, homeworks)
    } else {
        homeworks = await storage.loadHomeworkCache(period.date, period.startTime)
        if (!homeworks) {
            notifications.notify("Unable to load homework — check your internet connection.")
        }
        homeworks = homeworks ?? []
    }

    for (const hw of homeworks) {
        hwList.appendChild(createHomeworkItem(hw.text, completedHomework[hw.id] ?? hw.completed, hw.id, true))
    }
}

async function closeDetailsPanel() {
    details.hidden = true

    if (!curDetailsData) return;

    const { period, dateKey, customData } = curDetailsData
    const notesText = details.querySelector("#schedule-details-own-notes").value
    if (notesText === customData.note) return
    if (notesText === "" && !customData?.note) return;

    await storage.putCustomPeriodData(curDetailsData.homework, notesText, dateKey, period.startTime)
    notifications.notify("Saved new note.", "info")
}

async function updateStudentName() {
    let studentName = null
    if (session) {
        studentName = untis.getNameFromToken(session)
        if (studentName) await storage.saveStudentName(studentName)
    } else {
        studentName = await storage.loadStudentName()
    }
    document.querySelector("#schedule-user").textContent = studentName ?? "?"
}

async function attemptLoadScheduleDefinition() {
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
}

async function attemptLoadWeek(weekOffset) {
    if (weekCache.has(weekOffset)) {
        return weekCache.get(weekOffset)
    }

    const weekKey = getWeekKey(weekOffset)

    if (!session || !navigator.onLine) {
        const saved = await storage.loadWeekCache(weekKey)
        inMemoryCacheWeek(weekOffset, saved)

        return saved
    }

    //we have both a session and we're online -> fetch new data
    try {
        const { periods, dayStatuses } = await untis.getTimetable(session, weekOffset)
        inMemoryCacheWeek(weekOffset, { periods, dayStatuses })
        offlineCacheWeek(weekOffset, { periods, dayStatuses })

        return { periods, dayStatuses }
    } catch (error) {
        console.log(error)
        return {}
    }
}

function updateTimeIndicator() {
    const indicator = document.getElementById('schedule-time-indicator')
    const grid = document.getElementById('schedule-grid')
    if (!scheduleDefinition || currentWeek !== 0) {
        indicator.hidden = true
        return
    }

    const now = new Date()
    const nowM = now.getHours() * 60 + now.getMinutes()
    const slots = scheduleDefinition.slots
    const first = intToMinutes(slots[0].startInt)
    const last  = intToMinutes(slots[slots.length - 1].endInt)

    if (nowM < first || nowM > last) {
        indicator.hidden = true
        return
    }

    // find which slot we're currently in
    const slotIndex = slots.findIndex(s =>
        nowM >= intToMinutes(s.startInt) && nowM <= intToMinutes(s.endInt)
    )

    // if between slots, snap to next slot start
    const targetIndex = slotIndex === -1
        ? slots.findIndex(s => intToMinutes(s.startInt) > nowM)
        : slotIndex

    // get the actual DOM cell for this slot (first column, row = targetIndex + 1)
    const cells = grid.querySelectorAll('.schedule-cell, .free')
    // cells are laid out row by row, so nth cell in first column = targetIndex * 5
    // easier: use getBoundingClientRect on the grid itself and calculate from slot position
    const rowHeight = 65 // match your grid-auto-rows
    const gap = 4        // match your gap

    let top = 0
    for (let i = 0; i < targetIndex; i++) {
        top += rowHeight + gap
    }

    if (slotIndex !== -1) {
        // interpolate within the slot
        const slotStart = intToMinutes(slots[slotIndex].startInt)
        const slotEnd   = intToMinutes(slots[slotIndex].endInt)
        const withinSlot = (nowM - slotStart) / (slotEnd - slotStart)
        top += withinSlot * rowHeight
    }

    indicator.hidden = false
    indicator.style.top = `${grid.offsetTop + top}px`
}

async function loadWeek(weekOffset, direction = 0) {
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

    function errorOut(errMessage) {
        notifications.notify("No offline data available", "error")
        finishAnimation()
        throw new Error(errMessage)
    }

    const definition = scheduleDefinition
    if (!definition) {
        errorOut("No definition found!")
    }

    let { periods, dayStatuses } = await attemptLoadWeek(weekOffset)
    
    if (!periods || !dayStatuses) {
        errorOut("Unable to load week.")
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

            const now = new Date()
            const currentTimeInt = now.getHours() * 100 + now.getMinutes()
            const isPast = (dayDate < now && !isToday(dayDate)) ||
               (isToday(dayDate) && period && period.endTime < currentTimeInt)

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
                const hasHomework = customData?.homework?.length > 0 || period.hasHomework
                if (hasHomework) cell.classList.add("homework")

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
                        ${hasHomework ? HOMEWORK_ICON : ''}
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

    updateTimeIndicator()
}

function doSwipeDetection() {
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

        loadWeek(weekOffset, diff).catch(() => {
            weekOffset = prevOffset
        })
    })
}

export async function load(_session) {
    session = _session

    updateStudentName()
    await attemptLoadScheduleDefinition()

    await loadWeek(0)

    updateTimeIndicator()
    setInterval(updateTimeIndicator, 60000)

    doSwipeDetection()
}

details.querySelector(".close-button").addEventListener("click", () => {
    history.back() // triggers popstate which closes details panel
})

window.addEventListener('popstate', e => {
    if (!details.hidden) {
        closeDetailsPanel()
    }
})