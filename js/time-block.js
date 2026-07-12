/** 时间块排程：任务池复制、桌面/触摸拖拽、45/15 原地番茄钟。 */
(function () {
    'use strict';

    var START_HOUR = 7;
    var END_HOUR = 23;
    var WORK_SECONDS = 45 * 60;
    var REST_SECONDS = 15 * 60;
    var timeBlocks = {};
    var timers = {};
    var dragData = null;
    var touchDrag = null;
    var tickHandle = null;

    function activeDate() {
        if (typeof selectedDate !== 'undefined' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return selectedDate;
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function storageKey() {
        var uid = typeof currentUserId !== 'undefined' ? currentUserId : 'default';
        return 'timeBlocks_v2_' + uid;
    }
    function timerKey() {
        var uid = typeof currentUserId !== 'undefined' ? currentUserId : 'default';
        return 'timeBlockTimers_v2_' + uid;
    }
    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (e) { return fallback; }
    }
    function load() {
        timeBlocks = readJson(storageKey(), {});
        timers = readJson(timerKey(), {});
        Object.keys(timers).forEach(function (id) {
            timers[id].isRunning = false;
            timers[id].endAt = null;
        });
    }
    function save() {
        localStorage.setItem(storageKey(), JSON.stringify(timeBlocks));
        var safeTimers = {};
        Object.keys(timers).forEach(function (id) {
            var t = Object.assign({}, timers[id]);
            t.isRunning = false;
            t.endAt = null;
            safeTimers[id] = t;
        });
        localStorage.setItem(timerKey(), JSON.stringify(safeTimers));
    }
    function newSlots(date) {
        var result = [];
        for (var h = START_HOUR; h <= END_HOUR; h++) {
            var hour = String(h).padStart(2, '0') + ':00';
            result.push({ id: 'tb_' + date + '_' + String(h).padStart(2, '0'), hour: hour, taskId: null, taskSnapshot: null, status: 'empty' });
        }
        return result;
    }
    function slots() {
        var date = activeDate();
        if (!Array.isArray(timeBlocks[date])) timeBlocks[date] = newSlots(date);
        return timeBlocks[date];
    }
    function esc(value) {
        var el = document.createElement('span');
        el.textContent = value == null ? '' : String(value);
        return el.innerHTML;
    }
    function taskById(id) {
        if (typeof tasks === 'undefined') return null;
        return tasks.find(function (task) { return String(task.id) === String(id); }) || null;
    }
    function slotById(id) { return slots().find(function (slot) { return slot.id === id; }) || null; }
    function snapshot(task) {
        return {
            id: task.id, name: task.name, subject: task.subject || '', description: task.description || '',
            plannedDuration: task.plannedDuration || 45, coins: task.coins || 0,
            date: task.date || activeDate(), externalSource: task.externalSource || '', externalTaskId: task.externalTaskId || ''
        };
    }
    function scheduledIds() {
        return slots().filter(function (slot) { return slot.taskId; }).map(function (slot) { return String(slot.taskId); });
    }

    function render() {
        var grid = document.getElementById('timeBlockGrid');
        if (!grid) return;
        grid.innerHTML = '';
        slots().forEach(function (slot) { grid.appendChild(slotElement(slot)); });
        updateTaskPool();
    }
    function slotElement(slot) {
        var el = document.createElement('div');
        el.className = 'time-slot' + (slot.taskId ? ' filled' : '') + (slot.status === 'completed' ? ' completed' : '');
        el.dataset.slotId = slot.id;
        el.dataset.hour = slot.hour;
        if (slot.taskId) {
            el.draggable = true;
            el.addEventListener('dragstart', slotDragStart);
            el.addEventListener('dragend', dragEnd);
        }
        el.addEventListener('dragover', dragOver);
        el.addEventListener('dragleave', dragLeave);
        el.addEventListener('drop', dropOnSlot);
        var color = slot.taskSnapshot && typeof SUBJECT_COLORS !== 'undefined' ? (SUBJECT_COLORS[slot.taskSnapshot.subject] || '#4CAF50') : '#4CAF50';
        var content = '<div class="time-slot-content"><span class="time-slot-empty-text">拖拽任务到此处</span></div>';
        if (slot.taskId && slot.taskSnapshot) {
            var timer = timers[slot.id];
            content = '<div class="time-slot-content">' +
                '<div class="time-block-head"><label class="time-block-check"><input type="checkbox" data-action="complete" data-slot-id="' + slot.id + '" ' + (slot.status === 'completed' ? 'checked' : '') + '><span></span></label>' +
                '<div class="time-block-copy"><strong>' + esc(slot.taskSnapshot.name) + '</strong><small>' + esc(slot.taskSnapshot.subject) + ' · ' + (slot.taskSnapshot.plannedDuration || 45) + '分钟</small></div>' +
                '<button class="time-block-remove" data-action="remove" data-slot-id="' + slot.id + '" title="移回任务池">×</button></div>' +
                (timer ? timerHtml(slot.id, timer) : '<button class="mini-pomo-open" data-action="timer-open" data-slot-id="' + slot.id + '">🍅 45 分钟专注</button>') + '</div>';
        }
        el.innerHTML = (slot.taskId ? '<i class="time-block-color" style="background:' + color + '"></i>' : '') + '<span class="time-slot-label">' + slot.hour + '</span>' + content;
        return el;
    }
    function timerHtml(slotId, timer) {
        syncRemaining(timer);
        var label = timer.phase === 'work' ? '专注' : '休息';
        var primary = timer.isRunning ? '暂停' : (timer.phase === 'rest' && timer.ready ? '开始休息' : '继续');
        return '<div class="mini-timer ' + timer.phase + '">' +
            '<div><span class="mini-timer-phase">' + (timer.phase === 'work' ? '⚡' : '☕') + ' ' + label + '</span><strong class="mini-timer-value">' + formatSeconds(timer.remainingSec) + '</strong></div>' +
            '<div class="mini-timer-actions"><button data-action="timer-toggle" data-slot-id="' + slotId + '">' + primary + '</button><button data-action="timer-reset" data-slot-id="' + slotId + '">重置</button></div></div>';
    }
    function updateTaskPool() {
        var assigned = scheduledIds();
        document.querySelectorAll('#taskList [data-task-id]').forEach(function (card) {
            if (!card.classList.contains('card-hover')) return;
            var isAssigned = assigned.indexOf(String(card.dataset.taskId)) >= 0;
            card.classList.toggle('task-scheduled', isAssigned);
            var badge = card.querySelector('.time-block-assigned-badge');
            if (isAssigned && !badge) {
                badge = document.createElement('span');
                badge.className = 'time-block-assigned-badge';
                badge.textContent = '已安排';
                var title = card.querySelector('h4');
                if (title) title.appendChild(badge);
            } else if (!isAssigned && badge) badge.remove();
        });
    }

    function bindTaskDragEvents() {
        document.querySelectorAll('#taskList .card-hover[data-task-id]').forEach(function (card) {
            card.draggable = true;
            card.removeEventListener('dragstart', poolDragStart);
            card.removeEventListener('dragend', dragEnd);
            card.addEventListener('dragstart', poolDragStart);
            card.addEventListener('dragend', dragEnd);
        });
        var pool = document.getElementById('taskList');
        if (pool && !pool.dataset.timeBlockDropBound) {
            pool.dataset.timeBlockDropBound = '1';
            pool.addEventListener('dragover', function (e) { if (dragData && dragData.source === 'slot') { e.preventDefault(); pool.classList.add('task-pool-drop'); } });
            pool.addEventListener('dragleave', function () { pool.classList.remove('task-pool-drop'); });
            pool.addEventListener('drop', function (e) {
                if (!dragData || dragData.source !== 'slot') return;
                e.preventDefault(); pool.classList.remove('task-pool-drop'); removeSlot(dragData.slotId); dragData = null;
            });
        }
        updateTaskPool();
    }
    function poolDragStart(e) {
        var card = e.currentTarget;
        var task = taskById(card.dataset.taskId);
        if (!task) return;
        dragData = { source: 'pool', task: task };
        card.classList.add('task-card-dragging');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', String(task.id));
    }
    function slotDragStart(e) {
        if (e.target.closest('button,input')) { e.preventDefault(); return; }
        var slot = slotById(e.currentTarget.dataset.slotId);
        if (!slot || !slot.taskId) return;
        dragData = { source: 'slot', slotId: slot.id };
        e.currentTarget.classList.add('task-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', slot.id);
    }
    function dragEnd(e) {
        e.currentTarget.classList.remove('task-card-dragging');
        clearDragUi(); dragData = null;
    }
    function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); e.dataTransfer.dropEffect = dragData && dragData.source === 'slot' ? 'move' : 'copy'; }
    function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
    function dropOnSlot(e) {
        e.preventDefault();
        var targetId = e.currentTarget.dataset.slotId;
        e.currentTarget.classList.remove('drag-over');
        if (!dragData) return;
        if (dragData.source === 'pool') placeTask(dragData.task, targetId);
        else moveSlot(dragData.slotId, targetId);
        dragData = null;
    }
    function clearDragUi() {
        document.querySelectorAll('.drag-over,.task-pool-drop').forEach(function (el) { el.classList.remove('drag-over', 'task-pool-drop'); });
    }
    function placeTask(task, targetId) {
        var target = slotById(targetId);
        if (!target) return;
        target.taskId = String(task.id); target.taskSnapshot = snapshot(task); target.status = task.status === 'completed' ? 'completed' : 'planned';
        delete timers[target.id]; save(); render(); flash(targetId);
    }
    function moveSlot(sourceId, targetId) {
        if (sourceId === targetId) return;
        var source = slotById(sourceId), target = slotById(targetId);
        if (!source || !target) return;
        var sourceData = { taskId: source.taskId, taskSnapshot: source.taskSnapshot, status: source.status };
        var targetData = { taskId: target.taskId, taskSnapshot: target.taskSnapshot, status: target.status };
        Object.assign(target, sourceData); Object.assign(source, targetData);
        var timer = timers[sourceId]; timers[sourceId] = timers[targetId]; timers[targetId] = timer;
        if (!timers[sourceId]) delete timers[sourceId]; if (!timers[targetId]) delete timers[targetId];
        save(); render(); flash(targetId);
    }
    function removeSlot(id) {
        var slot = slotById(id); if (!slot) return;
        if (timers[id] && timers[id].remoteSessionId && window.LifeFocusSync) LifeFocusSync.finishPomodoro(timers[id].remoteSessionId, 'cancel');
        delete timers[id]; slot.taskId = null; slot.taskSnapshot = null; slot.status = 'empty'; save(); render();
    }
    function flash(id) {
        requestAnimationFrame(function () { var el = document.querySelector('[data-slot-id="' + id + '"]'); if (el) { el.classList.add('just-dropped'); setTimeout(function () { el.classList.remove('just-dropped'); }, 700); } });
    }

    function formatSeconds(sec) { sec = Math.max(0, Math.ceil(sec || 0)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
    function syncRemaining(timer) { if (timer.isRunning && timer.endAt) timer.remainingSec = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)); }
    function openTimer(id) {
        var slot = slotById(id); if (!slot) return;
        timers[id] = { phase: 'work', remainingSec: WORK_SECONDS, isRunning: false, endAt: null, ready: false, remoteSessionId: null, focusRecorded: false };
        save(); render();
    }
    function toggleTimer(id) {
        var timer = timers[id], slot = slotById(id); if (!timer || !slot) return;
        if (timer.isRunning) { syncRemaining(timer); timer.isRunning = false; timer.endAt = null; }
        else {
            pauseOtherTimers(id);
            timer.isRunning = true; timer.ready = false; timer.endAt = Date.now() + timer.remainingSec * 1000;
            if (timer.phase === 'work' && !timer.remoteSessionId && window.LifeFocusSync) {
                LifeFocusSync.startPomodoro(slot.taskSnapshot, 45).then(function (session) { if (session && timers[id]) { timers[id].remoteSessionId = session.id; save(); } });
            }
        }
        save(); render(); ensureTicker();
    }
    function pauseOtherTimers(exceptId) {
        Object.keys(timers).forEach(function (id) { if (id !== exceptId && timers[id].isRunning) { syncRemaining(timers[id]); timers[id].isRunning = false; timers[id].endAt = null; } });
    }
    function resetTimer(id) {
        var timer = timers[id]; if (!timer) return;
        if (timer.remoteSessionId && window.LifeFocusSync) LifeFocusSync.finishPomodoro(timer.remoteSessionId, 'cancel');
        timers[id] = { phase: 'work', remainingSec: WORK_SECONDS, isRunning: false, endAt: null, ready: false, remoteSessionId: null, focusRecorded: false };
        save(); render();
    }
    function tick() {
        var changed = false;
        Object.keys(timers).forEach(function (id) {
            var timer = timers[id]; if (!timer.isRunning) return;
            syncRemaining(timer);
            var value = document.querySelector('[data-slot-id="' + id + '"] .mini-timer-value'); if (value) value.textContent = formatSeconds(timer.remainingSec);
            if (timer.remainingSec <= 0) { completePhase(id); changed = true; }
        });
        if (changed) { save(); render(); }
    }
    function completePhase(id) {
        var timer = timers[id], slot = slotById(id); if (!timer || !slot) return;
        timer.isRunning = false; timer.endAt = null; alarm();
        if (timer.phase === 'work') {
            if (!timer.focusRecorded) {
                var task = taskById(slot.taskId); if (task) { task.actualDuration = (task.actualDuration || 0) + 45; if (typeof saveData === 'function') saveData(); }
                timer.focusRecorded = true;
            }
            if (timer.remoteSessionId && window.LifeFocusSync) LifeFocusSync.finishPomodoro(timer.remoteSessionId, 'complete');
            timer.phase = 'rest'; timer.remainingSec = REST_SECONDS; timer.ready = true; toast('🔔 45 分钟专注完成，点击“开始休息”进入 15 分钟休息。');
        } else {
            delete timers[id]; setCompleted(id, true); toast('✅ 休息结束，时间块和任务已完成。');
        }
    }
    function setCompleted(id, completed) {
        var slot = slotById(id); if (!slot) return;
        slot.status = completed ? 'completed' : 'planned';
        var task = taskById(slot.taskId);
        if (task && task.status !== (completed ? 'completed' : 'pending')) {
            task.status = completed ? 'completed' : 'pending';
            if (typeof saveData === 'function') saveData();
            if (typeof renderTaskList === 'function') renderTaskList();
        }
        save();
    }
    function ensureTicker() { if (!tickHandle) tickHandle = setInterval(tick, 500); }
    function alarm() {
        try { var ctx = new (window.AudioContext || window.webkitAudioContext)(); [0, 260].forEach(function (delay, i) { setTimeout(function () { var osc = ctx.createOscillator(), gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = i ? 1000 : 800; gain.gain.value = 0.2; osc.start(); setTimeout(function () { osc.stop(); }, 180); }, delay); }); } catch (e) {}
    }
    function toast(message) {
        if (typeof window.showNotification === 'function') { window.showNotification(message, 'info'); return; }
        var el = document.createElement('div'); el.className = 'time-block-toast'; el.textContent = message; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500);
    }

    function gridClick(e) {
        var action = e.target.dataset.action; if (!action) return;
        var id = e.target.dataset.slotId;
        if (action === 'timer-open') openTimer(id);
        else if (action === 'timer-toggle') toggleTimer(id);
        else if (action === 'timer-reset') resetTimer(id);
        else if (action === 'remove') removeSlot(id);
        else if (action === 'complete') { setCompleted(id, e.target.checked); render(); }
    }

    function touchStart(e) {
        var source = e.target.closest('#taskList .card-hover[data-task-id], .time-slot.filled');
        if (!source || e.target.closest('button,input')) return;
        var touch = e.touches[0];
        if (source.classList.contains('time-slot')) touchDrag = { source: 'slot', slotId: source.dataset.slotId, sourceEl: source, startX: touch.clientX, startY: touch.clientY };
        else { var task = taskById(source.dataset.taskId); if (!task) return; touchDrag = { source: 'pool', task: task, sourceEl: source, startX: touch.clientX, startY: touch.clientY }; }
        touchDrag.moved = false; touchDrag.preview = null;
    }
    function touchMove(e) {
        if (!touchDrag) return;
        var touch = e.touches[0], dx = touch.clientX - touchDrag.startX, dy = touch.clientY - touchDrag.startY;
        if (!touchDrag.moved && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        e.preventDefault(); touchDrag.moved = true;
        if (!touchDrag.preview) { touchDrag.preview = touchDrag.sourceEl.cloneNode(true); touchDrag.preview.className = 'drag-preview'; document.body.appendChild(touchDrag.preview); touchDrag.sourceEl.classList.add('task-card-dragging'); }
        touchDrag.preview.style.left = (touch.clientX + 12) + 'px'; touchDrag.preview.style.top = (touch.clientY + 12) + 'px';
        clearDragUi(); var below = document.elementFromPoint(touch.clientX, touch.clientY); if (!below) return;
        var slot = below.closest('.time-slot'); if (slot) slot.classList.add('drag-over');
        else if (touchDrag.source === 'slot' && below.closest('#taskList')) document.getElementById('taskList').classList.add('task-pool-drop');
    }
    function touchEnd(e) {
        if (!touchDrag) return;
        if (touchDrag.preview) touchDrag.preview.remove(); touchDrag.sourceEl.classList.remove('task-card-dragging'); clearDragUi();
        if (touchDrag.moved && e.changedTouches[0]) {
            var touch = e.changedTouches[0], below = document.elementFromPoint(touch.clientX, touch.clientY), target = below && below.closest('.time-slot');
            if (target) { if (touchDrag.source === 'pool') placeTask(touchDrag.task, target.dataset.slotId); else moveSlot(touchDrag.slotId, target.dataset.slotId); }
            else if (touchDrag.source === 'slot' && below && below.closest('#taskList')) removeSlot(touchDrag.slotId);
        }
        touchDrag = null;
    }

    window.TimeBlock = { bindTaskDragEvents: bindTaskDragEvents, render: render, refresh: function () { render(); bindTaskDragEvents(); }, scheduledTaskIds: scheduledIds };
    function init() {
        load(); render(); bindTaskDragEvents(); ensureTicker();
        var grid = document.getElementById('timeBlockGrid'); if (grid) grid.addEventListener('click', gridClick);
        document.addEventListener('touchstart', touchStart, { passive: true });
        document.addEventListener('touchmove', touchMove, { passive: false });
        document.addEventListener('touchend', touchEnd); document.addEventListener('touchcancel', touchEnd);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 500); }); else setTimeout(init, 500);
})();
