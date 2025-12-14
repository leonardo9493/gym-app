// ========================================
// GymTracker Application - Multi-Day Routines
// ========================================

// ========================================
// Utility Functions
// ========================================
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Format date to YYYY-MM-DD without timezone issues
function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return date.toLocaleDateString('es-ES', options);
}

function formatDateShort(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString('es-ES');
}

// ========================================
// Data Manager
// ========================================
class DataManager {
    constructor() {
        this.storageKey = 'gymTrackerData';
        this.data = this.loadData();
        this.migrateOldData(); // Migrate old single-day routines
    }

    loadData() {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error parsing stored data:', e);
            }
        }
        return this.getDefaultData();
    }

    getDefaultData() {
        return {
            routines: [],
            routineHistory: [],
            workouts: [],
            settings: {
                lastSync: null,
                deviceId: generateUUID(),
                currentRoutineId: null
            }
        };
    }

    // Migrate old data structure to new multi-day structure
    migrateOldData() {
        let needsSave = false;

        this.data.routines.forEach(routine => {
            if (routine.exercises && !routine.days) {
                // Old format detected, convert to new format
                routine.days = [{
                    id: generateUUID(),
                    name: 'Día 1',
                    order: 0,
                    exercises: routine.exercises
                }];
                delete routine.exercises;
                routine.isCurrent = false;
                needsSave = true;
            }
        });

        if (needsSave) {
            this.saveData();
            console.log('✅ Data migrated to multi-day format');
        }
    }

    saveData() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));

        // Sync to Firebase if user is logged in
        if (typeof syncToFirebase === 'function' && typeof currentUser !== 'undefined' && currentUser) {
            syncToFirebase(this.data);
        }
    }

    // Routines
    createRoutine(name, days) {
        const routine = {
            id: generateUUID(),
            name: name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 0,
            isActive: true,
            isCurrent: false,
            days: days.map((day, dayIndex) => ({
                id: generateUUID(),
                name: day.name,
                order: dayIndex,
                exercises: day.exercises.map((ex, exIndex) => ({
                    id: generateUUID(),
                    name: typeof ex === 'string' ? ex : ex.name,
                    sets: typeof ex === 'object' ? (ex.sets || '') : '',
                    reps: typeof ex === 'object' ? (ex.reps || '') : '',
                    order: exIndex
                }))
            }))
        };
        this.data.routines.push(routine);
        this.saveData();
        return routine;
    }

    updateRoutine(routineId, name, days) {
        const routine = this.data.routines.find(r => r.id === routineId);
        if (!routine) return null;

        // Save current version to history
        const historyCopy = JSON.parse(JSON.stringify(routine));
        historyCopy.isActive = false;
        this.data.routineHistory.push(historyCopy);

        // Update routine
        routine.name = name;
        routine.updatedAt = new Date().toISOString();
        routine.version += 1;
        routine.days = days.map((day, dayIndex) => ({
            id: generateUUID(),
            name: day.name,
            order: dayIndex,
            exercises: day.exercises.map((ex, exIndex) => ({
                id: generateUUID(),
                name: typeof ex === 'string' ? ex : ex.name,
                sets: typeof ex === 'object' ? (ex.sets || '') : '',
                reps: typeof ex === 'object' ? (ex.reps || '') : '',
                order: exIndex
            }))
        }));

        this.saveData();
        return routine;
    }

    deleteRoutine(routineId) {
        this.data.routines = this.data.routines.filter(r => r.id !== routineId);
        // If deleted routine was current, clear current
        if (this.data.settings.currentRoutineId === routineId) {
            this.data.settings.currentRoutineId = null;
        }
        this.saveData();
    }

    getRoutines() {
        return this.data.routines.filter(r => r.isActive);
    }

    getRoutine(routineId) {
        return this.data.routines.find(r => r.id === routineId);
    }

    cloneRoutine(routineId) {
        const original = this.getRoutine(routineId);
        if (!original) return null;

        const cloned = JSON.parse(JSON.stringify(original));
        cloned.id = generateUUID();
        cloned.name = `${original.name} (Copia)`;
        cloned.createdAt = new Date().toISOString();
        cloned.updatedAt = new Date().toISOString();
        cloned.version = 0;
        cloned.isCurrent = false;

        // Regenerate all IDs
        cloned.days = cloned.days.map(day => ({
            ...day,
            id: generateUUID(),
            exercises: day.exercises.map(ex => ({
                ...ex,
                id: generateUUID()
            }))
        }));

        this.data.routines.push(cloned);
        this.saveData();
        return cloned;
    }

    // Active Routine
    setCurrentRoutine(routineId) {
        // Clear previous current routine
        this.data.routines.forEach(r => r.isCurrent = false);

        if (routineId) {
            const routine = this.getRoutine(routineId);
            if (routine) {
                routine.isCurrent = true;
                this.data.settings.currentRoutineId = routineId;
            }
        } else {
            this.data.settings.currentRoutineId = null;
        }

        this.saveData();
    }

    getCurrentRoutine() {
        return this.data.routines.find(r => r.isCurrent) || null;
    }

    // Workouts
    createWorkout(routineId, dayId, dayName, exercisesData, isProvisional = false) {
        const routine = this.getRoutine(routineId);
        if (!routine) return null;

        const workout = {
            id: generateUUID(),
            date: new Date().toISOString(),
            routineId: routine.id,
            routineVersion: routine.version,
            routineName: routine.name,
            dayId: dayId,
            dayName: dayName,
            exercises: exercisesData,
            isProvisional: isProvisional
        };

        this.data.workouts.push(workout);
        this.saveData();
        return workout;
    }

    updateWorkout(workoutId, exercisesData, isProvisional = false) {
        const workout = this.data.workouts.find(w => w.id === workoutId);
        if (!workout) return null;

        workout.exercises = exercisesData;
        workout.isProvisional = isProvisional;
        workout.date = new Date().toISOString(); // Update date on each save

        this.saveData();
        return workout;
    }

    getWorkouts(routineId = null) {
        if (routineId) {
            return this.data.workouts.filter(w => w.routineId === routineId);
        }
        return this.data.workouts;
    }

    getWorkout(workoutId) {
        return this.data.workouts.find(w => w.id === workoutId);
    }

    getLastWorkoutForDay(routineId, dayId, dayName = null) {
        // Find the most recent workout for this specific routine day
        // Search by dayId first, then fall back to dayName for backwards compatibility
        let workouts = this.data.workouts
            .filter(w => w.routineId === routineId && w.dayId === dayId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // If no workouts found by dayId, try by dayName (for when routine is updated and IDs change)
        if (workouts.length === 0 && dayName) {
            const dayNameNormalized = dayName.toLowerCase().trim();
            workouts = this.data.workouts
                .filter(w => w.routineId === routineId && w.dayName && w.dayName.toLowerCase().trim() === dayNameNormalized)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        return workouts.length > 0 ? workouts[0] : null;
    }

    // Export/Import
    exportData() {
        return JSON.stringify(this.data, null, 2);
    }

    importData(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            // Validate structure
            if (imported.routines && imported.workouts) {
                this.data = imported;
                this.saveData();
                return true;
            }
            return false;
        } catch (e) {
            console.error('Error importing data:', e);
            return false;
        }
    }

    // Statistics
    getStats() {
        const totalWorkouts = this.data.workouts.length;
        const totalRoutines = this.getRoutines().length;
        const allExercises = new Set();
        this.data.routines.forEach(r => {
            if (r.days) {
                r.days.forEach(day => {
                    day.exercises.forEach(ex => allExercises.add(ex.name));
                });
            }
        });

        return {
            workouts: totalWorkouts,
            routines: totalRoutines,
            exercises: allExercises.size
        };
    }

    // Weight Tracking
    addWeightEntry(date, weight) {
        if (!this.data.weightEntries) {
            this.data.weightEntries = [];
        }
        const entry = {
            id: generateUUID(),
            date: date,
            weight: parseFloat(weight)
        };
        this.data.weightEntries.push(entry);
        this.saveData();
        return entry;
    }

    getWeightEntries() {
        const entries = this.data.weightEntries || [];
        return entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // Process weight data with imputation and SMA calculation
    processWeightData() {
        const rawEntries = this.getWeightEntries();
        if (rawEntries.length === 0) return [];

        // Create a map of real data by date string
        const realDataMap = {};
        rawEntries.forEach(e => {
            // Handle both YYYY-MM-DD and ISO format
            const dateStr = e.date.includes('T') ? e.date.split('T')[0] : e.date;
            realDataMap[dateStr] = e.weight;
        });

        // Get date range from first entry to today
        // Parse date safely (handle both formats)
        const firstDateStr = rawEntries[0].date.includes('T')
            ? rawEntries[0].date.split('T')[0]
            : rawEntries[0].date;
        const [year, month, day] = firstDateStr.split('-').map(Number);
        const firstDate = new Date(year, month - 1, day);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        firstDate.setHours(0, 0, 0, 0);

        // Generate all dates in range
        const allDates = [];
        const currentDate = new Date(firstDate);
        while (currentDate <= today) {
            allDates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Build processed data array with imputation
        const processedData = [];

        allDates.forEach((date, index) => {
            const dateStr = formatDateLocal(date);
            const isReal = realDataMap.hasOwnProperty(dateStr);

            let weight = isReal ? realDataMap[dateStr] : null;
            let isImputed = false;
            let imputationType = null;

            if (!isReal) {
                // Find the gap size: distance to previous and next real values
                let prevRealIndex = null;
                let nextRealIndex = null;

                // Find previous real value index
                for (let i = index - 1; i >= 0; i--) {
                    if (realDataMap.hasOwnProperty(formatDateLocal(allDates[i]))) {
                        prevRealIndex = i;
                        break;
                    }
                }

                // Find next real value index
                for (let i = index + 1; i < allDates.length; i++) {
                    if (realDataMap.hasOwnProperty(formatDateLocal(allDates[i]))) {
                        nextRealIndex = i;
                        break;
                    }
                }

                // Calculate gap size (days between the two adjacent real values)
                let gapSize = 0;
                if (prevRealIndex !== null && nextRealIndex !== null) {
                    gapSize = nextRealIndex - prevRealIndex - 1; // Days missing between them
                } else if (prevRealIndex !== null) {
                    // No next value, count from prev to current
                    gapSize = index - prevRealIndex;
                }

                // Apply imputation based on rules
                const isToday = dateStr === formatDateLocal(today);

                // Gap rule: only impute if gap is <= 2 days
                if (gapSize <= 2) {
                    if (isToday && prevRealIndex !== null) {
                        // LOCF for today: use last known value
                        const prevDateStr = formatDateLocal(allDates[prevRealIndex]);
                        weight = realDataMap[prevDateStr];
                        isImputed = true;
                        imputationType = 'LOCF';
                    } else if (prevRealIndex !== null && nextRealIndex !== null) {
                        // Interpolation for past dates with both endpoints
                        const prevDateStr = formatDateLocal(allDates[prevRealIndex]);
                        const nextDateStr = formatDateLocal(allDates[nextRealIndex]);
                        const prevValue = realDataMap[prevDateStr];
                        const nextValue = realDataMap[nextDateStr];

                        const ratio = (index - prevRealIndex) / (nextRealIndex - prevRealIndex);
                        weight = prevValue + (nextValue - prevValue) * ratio;
                        weight = Math.round(weight * 10) / 10;
                        isImputed = true;
                        imputationType = 'interpolated';
                    } else if (prevRealIndex !== null && !isToday) {
                        // LOCF if no next value (but not today rule)
                        const prevDateStr = formatDateLocal(allDates[prevRealIndex]);
                        weight = realDataMap[prevDateStr];
                        isImputed = true;
                        imputationType = 'LOCF';
                    }
                }
                // If gapSize > 2, weight stays null (gap too large)
            }

            processedData.push({
                date: dateStr,
                weight: weight,
                isReal: isReal,
                isImputed: isImputed,
                imputationType: imputationType,
                sma7: null // Will be calculated next
            });
        });

        // Calculate SMA7 with 5/7 density rule
        processedData.forEach((entry, index) => {
            if (index < 6) return; // Need at least 7 days

            // Get window of 7 days
            const window = processedData.slice(index - 6, index + 1);
            const realCount = window.filter(e => e.isReal).length;

            // 5/7 density rule
            if (realCount >= 5) {
                const validWeights = window
                    .filter(e => e.weight !== null)
                    .map(e => e.weight);

                if (validWeights.length >= 5) {
                    const sum = validWeights.reduce((a, b) => a + b, 0);
                    entry.sma7 = Math.round((sum / validWeights.length) * 10) / 10;
                }
            }
        });

        return processedData;
    }

    deleteWeightEntry(entryId) {
        if (!this.data.weightEntries) return;
        this.data.weightEntries = this.data.weightEntries.filter(e => e.id !== entryId);
        this.saveData();
    }

    updateWeightEntry(entryId, date, weight) {
        if (!this.data.weightEntries) return;
        const entry = this.data.weightEntries.find(e => e.id === entryId);
        if (entry) {
            entry.date = date;
            entry.weight = parseFloat(weight);
            this.saveData();
        }
    }
}

// ========================================
// UI Manager
// ========================================
class UIManager {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.currentView = 'menu';
        this.currentRoutineEdit = null;
        this.currentRoutineData = { name: '', days: [] }; // New: holds routine being edited
        this.currentWorkoutData = {};
        this.initializeElements();
        this.attachEventListeners();
        this.updateStats();
    }

    initializeElements() {
        // Views
        this.menuView = document.getElementById('menu-view');
        this.routineView = document.getElementById('routine-view');
        this.weightView = document.getElementById('weight-view');

        // Buttons
        this.btnRoutines = document.getElementById('btn-routines');
        this.btnWeight = document.getElementById('btn-weight');
        this.btnBackFromRoutines = document.getElementById('btn-back-from-routines');
        this.btnNewRoutine = document.getElementById('btn-new-routine');

        // Current Routine Preview
        this.currentRoutinePreview = document.getElementById('current-routine-preview');
        this.previewRoutineName = document.getElementById('preview-routine-name');
        this.previewDaysContainer = document.getElementById('preview-days-container');

        // Tabs
        this.tabs = document.querySelectorAll('.tab');
        this.tabContents = document.querySelectorAll('.tab-content');

        // Routine Modal
        this.routineModal = document.getElementById('routine-modal');
        this.routineModalTitle = document.getElementById('routine-modal-title');
        this.routineNameInput = document.getElementById('routine-name');
        this.modalExercisesList = document.getElementById('modal-exercises-list');
        this.newExerciseNameInput = document.getElementById('new-exercise-name');
        this.newExerciseSetsInput = document.getElementById('new-exercise-sets');
        this.newExerciseRepsInput = document.getElementById('new-exercise-reps');
        this.btnAddExercise = document.getElementById('btn-add-exercise');
        this.btnSaveRoutine = document.getElementById('btn-save-routine');
        this.btnCancelRoutine = document.getElementById('btn-cancel-routine');
        this.btnCloseRoutineModal = document.getElementById('btn-close-routine-modal');

        // Workout
        this.selectRoutine = document.getElementById('select-routine');
        this.workoutExercisesContainer = document.getElementById('workout-exercises-container');
        this.workoutActions = document.getElementById('workout-actions');
        this.btnSaveProvisional = document.getElementById('btn-save-provisional');
        this.btnSaveWorkout = document.getElementById('btn-save-workout');

        // History
        this.filterRoutine = document.getElementById('filter-routine');
        this.historyList = document.getElementById('history-list');
        this.btnExportCsv = document.getElementById('btn-export-csv');

        // Lists
        this.routinesList = document.getElementById('routines-list');

        // Workout Detail Modal
        this.workoutDetailModal = document.getElementById('workout-detail-modal');
        this.workoutDetailBody = document.getElementById('workout-detail-body');
        this.btnCloseWorkoutDetail = document.getElementById('btn-close-workout-detail');

        // Import file input
        this.importFileInput = document.getElementById('import-file-input');

        // Weight Elements
        this.btnBackFromWeight = document.getElementById('btn-back-from-weight');
        this.btnAddWeight = document.getElementById('btn-add-weight');
        this.weightHistoryList = document.getElementById('weight-history-list');
        this.weightChart = document.getElementById('weight-chart');
        this.weightModal = document.getElementById('weight-modal');
        this.weightDateInput = document.getElementById('weight-date');
        this.weightValueInput = document.getElementById('weight-value');
        this.btnCloseWeightModal = document.getElementById('btn-close-weight-modal');
        this.btnCancelWeight = document.getElementById('btn-cancel-weight');
        this.btnSaveWeight = document.getElementById('btn-save-weight');
        this.btnExportWeightCsv = document.getElementById('btn-export-weight-csv');
        this.chartInstance = null;
    }

    attachEventListeners() {
        // Navigation
        this.btnRoutines.addEventListener('click', () => this.showView('routine'));
        this.btnBackFromRoutines.addEventListener('click', () => this.showView('menu'));

        // Tabs
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Routine Modal
        this.btnNewRoutine.addEventListener('click', () => this.openRoutineModal());
        this.btnAddExercise.addEventListener('click', () => this.addExerciseToCurrentDay());
        this.newExerciseNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addExerciseToCurrentDay();
        });
        this.btnSaveRoutine.addEventListener('click', () => this.saveRoutine());
        this.btnCancelRoutine.addEventListener('click', () => this.closeRoutineModal());
        this.btnCloseRoutineModal.addEventListener('click', () => this.closeRoutineModal());

        // Workout
        this.selectRoutine.addEventListener('change', () => this.loadWorkoutExercises());
        this.btnSaveProvisional.addEventListener('click', () => this.saveWorkout(true));
        this.btnSaveWorkout.addEventListener('click', () => this.saveWorkout(false));

        // History
        this.filterRoutine.addEventListener('change', () => this.renderHistory());
        this.btnExportCsv.addEventListener('click', () => this.exportHistoryCsv());

        // Import data (via file input)
        this.importFileInput.addEventListener('change', (e) => this.importData(e));

        // Workout Detail Modal
        this.btnCloseWorkoutDetail.addEventListener('click', () => this.closeWorkoutDetailModal());

        // Close modals on background click (only for non-editable modals)
        // Note: Routine modal does NOT close on background click to prevent data loss
        this.workoutDetailModal.addEventListener('click', (e) => {
            if (e.target === this.workoutDetailModal) this.closeWorkoutDetailModal();
        });

        // Weight Tracking
        this.btnWeight.addEventListener('click', () => this.showView('weight'));
        this.btnBackFromWeight.addEventListener('click', () => this.showView('menu'));
        this.btnAddWeight.addEventListener('click', () => this.openWeightModal());
        this.btnCloseWeightModal.addEventListener('click', () => this.closeWeightModal());
        this.btnCancelWeight.addEventListener('click', () => this.closeWeightModal());
        this.btnSaveWeight.addEventListener('click', () => this.saveWeight());
        this.weightModal.addEventListener('click', (e) => {
            if (e.target === this.weightModal) this.closeWeightModal();
        });
        this.btnExportWeightCsv.addEventListener('click', () => this.exportWeightCsv());

        // Chart filter buttons
        this.currentChartRange = '14'; // Default: 14 days
        document.querySelectorAll('.chart-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.chart-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentChartRange = btn.dataset.range;
                this.renderWeightChart();
            });
        });

        // Handle browser back button for mobile
        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.view) {
                this.showView(event.state.view, false);
            } else {
                this.showView('menu', false);
            }
        });

        // Set initial state
        history.replaceState({ view: 'menu' }, '', window.location.pathname);
    }

    // View Management
    showView(viewName, addToHistory = true) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        if (viewName === 'menu') {
            this.menuView.classList.add('active');
            this.updateStats();
        } else if (viewName === 'routine') {
            this.routineView.classList.add('active');
            this.renderRoutines();
            this.renderCurrentRoutinePreview();
            this.updateRoutineSelects();
        } else if (viewName === 'weight') {
            this.weightView.classList.add('active');
            this.renderWeightHistory();
            this.renderWeightChart();
        }

        this.currentView = viewName;

        // Add to browser history for back button support
        if (addToHistory && viewName !== 'menu') {
            history.pushState({ view: viewName }, '', `#${viewName}`);
        } else if (addToHistory && viewName === 'menu') {
            // Replace state for menu to avoid going back to empty state
            history.replaceState({ view: 'menu' }, '', window.location.pathname);
        }
    }

    // Tab Management
    switchTab(tabId) {
        // Update tab buttons
        this.tabs.forEach(tab => {
            if (tab.dataset.tab === tabId) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update tab contents
        this.tabContents.forEach(content => {
            if (content.id === tabId) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // Load content based on tab
        if (tabId === 'routines-tab') {
            this.renderRoutines();
        } else if (tabId === 'workout-tab') {
            this.updateRoutineSelects();
            // Only preselect and reload if no workout in progress
            if (!this.currentWorkoutData.workoutId) {
                this.preselectCurrentRoutine();
            }
        } else if (tabId === 'history-tab') {
            this.preselectCurrentRoutineForHistory();
            this.renderHistory();
        }
    }

    // Stats (removed from menu, keeping function for compatibility)
    updateStats() {
        // Stats section was removed from menu UI
    }

    // Current Routine Preview
    renderCurrentRoutinePreview() {
        const currentRoutine = this.dataManager.getCurrentRoutine();

        if (!currentRoutine) {
            this.currentRoutinePreview.classList.add('hidden');
            return;
        }

        this.currentRoutinePreview.classList.remove('hidden');
        this.previewRoutineName.textContent = currentRoutine.name;

        this.previewDaysContainer.innerHTML = currentRoutine.days.map(day => `
            <div class="preview-day-card">
                <div class="preview-day-name">${day.name}</div>
                <div class="preview-exercises-list">
                    ${day.exercises.map(ex => `
                        <div class="preview-exercise-item">
                            <span class="preview-exercise-name">${ex.name || ex}</span>
                            ${ex.sets ? `<span class="preview-exercise-sets">${ex.sets}×${ex.reps}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    // Routines Rendering
    renderRoutines() {
        const routines = this.dataManager.getRoutines();

        if (routines.length === 0) {
            this.routinesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <h3>No tienes rutinas creadas</h3>
                    <p>Crea tu primera rutina para empezar a entrenar</p>
                </div>
            `;
            return;
        }

        this.routinesList.innerHTML = routines.map(routine => {
            return `
            <div class="routine-card ${routine.isCurrent ? 'is-current' : ''}" data-routine-id="${routine.id}">
                <div class="routine-card-header">
                    <h3 class="routine-card-title">
                        ${routine.isCurrent ? '⭐ ' : ''}${routine.name}
                    </h3>
                    <div class="routine-card-actions">
                        <button class="btn-icon" data-action="set-current" title="${routine.isCurrent ? 'Quitar como actual' : 'Marcar como actual'}">${routine.isCurrent ? '⭐' : '☆'}</button>
                        <button class="btn-icon" data-action="edit" title="Editar rutina">✏️</button>
                        <button class="btn-icon" data-action="clone" title="Clonar rutina">📋</button>
                        <button class="btn-icon btn-danger" data-action="delete" title="Eliminar rutina">🗑️</button>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        // Attach event listeners
        this.routinesList.querySelectorAll('.routine-card').forEach(card => {
            const routineId = card.dataset.routineId;

            card.querySelector('[data-action="set-current"]').addEventListener('click', () => {
                this.toggleCurrentRoutine(routineId);
            });

            card.querySelector('[data-action="edit"]').addEventListener('click', () => {
                this.openRoutineModal(routineId);
            });

            card.querySelector('[data-action="clone"]').addEventListener('click', () => {
                this.cloneRoutine(routineId);
            });

            card.querySelector('[data-action="delete"]').addEventListener('click', () => {
                this.deleteRoutine(routineId);
            });
        });
    }

    toggleCurrentRoutine(routineId) {
        const routine = this.dataManager.getRoutine(routineId);
        if (routine.isCurrent) {
            this.dataManager.setCurrentRoutine(null);
        } else {
            this.dataManager.setCurrentRoutine(routineId);
        }
        this.renderRoutines();
        this.renderCurrentRoutinePreview();
    }

    // Routine Modal - Multi-Day Support
    openRoutineModal(routineId = null) {
        this.currentRoutineEdit = routineId;

        if (routineId) {
            const routine = this.dataManager.getRoutine(routineId);
            this.routineModalTitle.textContent = 'Editar Rutina';
            this.routineNameInput.value = routine.name;
            this.currentRoutineData = {
                name: routine.name,
                days: JSON.parse(JSON.stringify(routine.days)) // Deep copy
            };
        } else {
            this.routineModalTitle.textContent = 'Nueva Rutina';
            this.routineNameInput.value = '';
            this.currentRoutineData = {
                name: '',
                days: [{
                    name: 'Día 1',
                    exercises: []
                }]
            };
        }

        this.renderRoutineModal();
        this.routineModal.classList.add('active');
        this.routineNameInput.focus();
    }

    closeRoutineModal() {
        this.routineModal.classList.remove('active');
        this.currentRoutineEdit = null;
        this.currentRoutineData = { name: '', days: [] };
    }

    renderRoutineModal() {
        const days = this.currentRoutineData.days;

        let html = `
            <div class="days-tabs">
                ${days.map((day, index) => `
                    <div class="day-tab ${index === 0 ? 'active' : ''}" data-day-index="${index}">
                        <input type="text" class="day-name-input" value="${day.name}" data-day-index="${index}" placeholder="Nombre del día">
                        ${days.length > 1 ? `<span class="day-tab-remove" data-day-index="${index}">×</span>` : ''}
                    </div>
                `).join('')}
                <button class="day-tab-add" id="btn-add-day">+ Añadir Día</button>
            </div>
        `;

        days.forEach((day, dayIndex) => {
            html += `
                <div class="day-content ${dayIndex === 0 ? 'active' : ''}" data-day-index="${dayIndex}">
                    <div class="exercises-list-container" data-day-index="${dayIndex}">
                        ${this.renderDayExercises(day.exercises, dayIndex)}
                    </div>
                </div>
            `;
        });

        this.modalExercisesList.innerHTML = html;

        // Attach event listeners
        this.modalExercisesList.querySelectorAll('.day-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('day-tab-remove')) return;
                const dayIndex = parseInt(tab.dataset.dayIndex);
                this.switchDayTab(dayIndex);
            });
        });

        this.modalExercisesList.querySelectorAll('.day-tab-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dayIndex = parseInt(btn.dataset.dayIndex);
                this.removeDay(dayIndex);
            });
        });

        const btnAddDay = document.getElementById('btn-add-day');
        if (btnAddDay) {
            btnAddDay.addEventListener('click', () => this.addDay());
        }

        // Attach day name change listeners
        this.modalExercisesList.querySelectorAll('.day-name-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const dayIndex = parseInt(input.dataset.dayIndex);
                this.currentRoutineData.days[dayIndex].name = e.target.value.trim() || `Día ${dayIndex + 1}`;
            });
            // Prevent tab switching when clicking on input
            input.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        // Attach exercise action listeners (move up, move down, remove)
        this.attachDayExerciseListeners();
    }

    renderDayExercises(exercises, dayIndex) {
        if (exercises.length === 0) {
            return `
                <div class="empty-state-small">
                    <p>Añade ejercicios a este día</p>
                </div>
            `;
        }

        return exercises.map((ex, exIndex) => {
            // Handle both object format and legacy string format
            const exerciseName = typeof ex === 'string' ? ex : (ex.name || ex);
            const sets = typeof ex === 'object' ? (ex.sets || '') : '';
            const reps = typeof ex === 'object' ? (ex.reps || '') : '';

            return `
            <div class="exercise-item" data-day-index="${dayIndex}" data-ex-index="${exIndex}">
                <input type="text" class="exercise-edit-name" value="${exerciseName}" data-day-index="${dayIndex}" data-ex-index="${exIndex}" placeholder="Nombre">
                <input type="text" class="exercise-edit-sets" value="${sets}" data-day-index="${dayIndex}" data-ex-index="${exIndex}" placeholder="Series">
                <input type="text" class="exercise-edit-reps" value="${reps}" data-day-index="${dayIndex}" data-ex-index="${exIndex}" placeholder="Reps">
                <div class="exercise-item-actions">
                    ${exIndex > 0 ? `<button class="btn-icon" data-action="move-up" data-day-index="${dayIndex}" data-ex-index="${exIndex}">⬆️</button>` : ''}
                    ${exIndex < exercises.length - 1 ? `<button class="btn-icon" data-action="move-down" data-day-index="${dayIndex}" data-ex-index="${exIndex}">⬇️</button>` : ''}
                    <button class="btn-icon btn-danger" data-action="remove" data-day-index="${dayIndex}" data-ex-index="${exIndex}">×</button>
                </div>
            </div>
        `}).join('');
    }

    switchDayTab(dayIndex) {
        this.modalExercisesList.querySelectorAll('.day-tab').forEach((tab, idx) => {
            tab.classList.toggle('active', idx === dayIndex);
        });
        this.modalExercisesList.querySelectorAll('.day-content').forEach((content, idx) => {
            content.classList.toggle('active', idx === dayIndex);
        });

        // Update active day for exercise adding
        this.currentActiveDayIndex = dayIndex;
    }

    addDay() {
        const newDayIndex = this.currentRoutineData.days.length;
        this.currentRoutineData.days.push({
            name: `Día ${newDayIndex + 1}`,
            exercises: []
        });
        this.renderRoutineModal();
        this.switchDayTab(newDayIndex);
    }

    removeDay(dayIndex) {
        if (this.currentRoutineData.days.length <= 1) {
            alert('Debe haber al menos un día en la rutina');
            return;
        }
        this.currentRoutineData.days.splice(dayIndex, 1);
        this.renderRoutineModal();
    }

    addExerciseToCurrentDay() {
        const exerciseName = this.newExerciseNameInput.value.trim();
        if (!exerciseName) return;

        const exerciseSets = this.newExerciseSetsInput.value.trim() || '';
        const exerciseReps = this.newExerciseRepsInput.value.trim() || '';

        const activeDayIndex = this.currentActiveDayIndex || 0;

        // Store as object with name, sets, and reps
        this.currentRoutineData.days[activeDayIndex].exercises.push({
            name: exerciseName,
            sets: exerciseSets,
            reps: exerciseReps
        });

        // Clear inputs
        this.newExerciseNameInput.value = '';
        this.newExerciseSetsInput.value = '';
        this.newExerciseRepsInput.value = '';
        this.newExerciseNameInput.focus();

        // Re-render only the active day's exercises
        const exerciseContainer = this.modalExercisesList.querySelector(`.exercises-list-container[data-day-index="${activeDayIndex}"]`);
        if (exerciseContainer) {
            exerciseContainer.innerHTML = this.renderDayExercises(this.currentRoutineData.days[activeDayIndex].exercises, activeDayIndex);
            this.attachDayExerciseListeners();
        }
    }

    attachDayExerciseListeners() {
        this.modalExercisesList.querySelectorAll('[data-action="move-up"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dayIndex = parseInt(btn.dataset.dayIndex);
                const exIndex = parseInt(btn.dataset.exIndex);
                const exercises = this.currentRoutineData.days[dayIndex].exercises;
                const temp = exercises[exIndex];
                exercises[exIndex] = exercises[exIndex - 1];
                exercises[exIndex - 1] = temp;

                const container = this.modalExercisesList.querySelector(`.exercises-list-container[data-day-index="${dayIndex}"]`);
                container.innerHTML = this.renderDayExercises(exercises, dayIndex);
                this.attachDayExerciseListeners();
            });
        });

        this.modalExercisesList.querySelectorAll('[data-action="move-down"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dayIndex = parseInt(btn.dataset.dayIndex);
                const exIndex = parseInt(btn.dataset.exIndex);
                const exercises = this.currentRoutineData.days[dayIndex].exercises;
                const temp = exercises[exIndex];
                exercises[exIndex] = exercises[exIndex + 1];
                exercises[exIndex + 1] = temp;

                const container = this.modalExercisesList.querySelector(`.exercises-list-container[data-day-index="${dayIndex}"]`);
                container.innerHTML = this.renderDayExercises(exercises, dayIndex);
                this.attachDayExerciseListeners();
            });
        });

        this.modalExercisesList.querySelectorAll('[data-action="remove"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dayIndex = parseInt(btn.dataset.dayIndex);
                const exIndex = parseInt(btn.dataset.exIndex);
                this.currentRoutineData.days[dayIndex].exercises.splice(exIndex, 1);

                const container = this.modalExercisesList.querySelector(`.exercises-list-container[data-day-index="${dayIndex}"]`);
                container.innerHTML = this.renderDayExercises(this.currentRoutineData.days[dayIndex].exercises, dayIndex);
                this.attachDayExerciseListeners();
            });
        });

        // Attach listeners for inline editing of exercise properties
        this.modalExercisesList.querySelectorAll('.exercise-edit-name').forEach(input => {
            input.addEventListener('change', (e) => {
                const dayIndex = parseInt(input.dataset.dayIndex);
                const exIndex = parseInt(input.dataset.exIndex);
                const exercise = this.currentRoutineData.days[dayIndex].exercises[exIndex];
                if (typeof exercise === 'object') {
                    exercise.name = e.target.value.trim();
                } else {
                    this.currentRoutineData.days[dayIndex].exercises[exIndex] = { name: e.target.value.trim(), sets: '', reps: '' };
                }
            });
        });

        this.modalExercisesList.querySelectorAll('.exercise-edit-sets').forEach(input => {
            input.addEventListener('change', (e) => {
                const dayIndex = parseInt(input.dataset.dayIndex);
                const exIndex = parseInt(input.dataset.exIndex);
                const exercise = this.currentRoutineData.days[dayIndex].exercises[exIndex];
                if (typeof exercise === 'object') {
                    exercise.sets = e.target.value.trim();
                }
            });
        });

        this.modalExercisesList.querySelectorAll('.exercise-edit-reps').forEach(input => {
            input.addEventListener('change', (e) => {
                const dayIndex = parseInt(input.dataset.dayIndex);
                const exIndex = parseInt(input.dataset.exIndex);
                const exercise = this.currentRoutineData.days[dayIndex].exercises[exIndex];
                if (typeof exercise === 'object') {
                    exercise.reps = e.target.value.trim();
                }
            });
        });
    }

    saveRoutine() {
        const name = this.routineNameInput.value.trim();
        if (!name) {
            alert('Por favor, ingresa un nombre para la rutina');
            return;
        }

        const days = this.currentRoutineData.days.map(day => ({
            name: day.name || 'Día sin nombre',
            exercises: (day.exercises || []).map(ex => {
                // Handle both string format (legacy) and object format
                if (typeof ex === 'string') {
                    return { name: ex, sets: '', reps: '' };
                }
                return {
                    name: ex.name || '',
                    sets: ex.sets || '',
                    reps: ex.reps || ''
                };
            }).filter(ex => ex.name)
        }));

        const hasExercises = days.some(day => day.exercises.length > 0);
        if (!hasExercises) {
            alert('Añade al menos un ejercicio a algún día de la rutina');
            return;
        }

        if (this.currentRoutineEdit) {
            this.dataManager.updateRoutine(this.currentRoutineEdit, name, days);
        } else {
            this.dataManager.createRoutine(name, days);
        }

        this.closeRoutineModal();
        this.renderRoutines();
        this.renderCurrentRoutinePreview();
        this.updateStats();
        this.updateRoutineSelects();
    }

    cloneRoutine(routineId) {
        this.dataManager.cloneRoutine(routineId);
        this.renderRoutines();
        this.renderCurrentRoutinePreview();
        this.updateStats();
    }

    deleteRoutine(routineId) {
        if (confirm('¿Estás seguro de que quieres eliminar esta rutina?')) {
            this.dataManager.deleteRoutine(routineId);
            this.renderRoutines();
            this.renderCurrentRoutinePreview();
            this.updateStats();
            this.updateRoutineSelects();
        }
    }

    // Workout
    updateRoutineSelects() {
        const routines = this.dataManager.getRoutines();

        //Update workout select
        this.selectRoutine.innerHTML = '<option value="">-- Elige tu rutina --</option>' +
            routines.map(r => `<option value="${r.id}">${r.name}${r.isCurrent ? ' ⭐' : ''}</option>`).join('');

        // Update history filter
        this.filterRoutine.innerHTML = '<option value="">Todas las rutinas</option>' +
            routines.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    }

    preselectCurrentRoutine() {
        const currentRoutine = this.dataManager.getCurrentRoutine();
        if (currentRoutine) {
            this.selectRoutine.value = currentRoutine.id;
            this.loadWorkoutExercises();
        }
    }

    preselectCurrentRoutineForHistory() {
        const currentRoutine = this.dataManager.getCurrentRoutine();
        if (currentRoutine) {
            this.filterRoutine.value = currentRoutine.id;
        }
    }

    loadWorkoutExercises() {
        const routineId = this.selectRoutine.value;
        if (!routineId) {
            this.workoutExercisesContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏋️</div>
                    <h3>Selecciona una rutina</h3>
                    <p>Elige la rutina que vas a realizar hoy</p>
                </div>
            `;
            this.workoutActions.classList.add('hidden');
            return;
        }

        const routine = this.dataManager.getRoutine(routineId);

        // Show day selection
        let html = `
            <div class="workout-day-selection">
                <label for="select-day">Selecciona el día:</label>
                <select id="select-day" class="select-input">
                    ${routine.days.map((day, index) => `
                        <option value="${index}">${day.name} (${day.exercises.length} ejercicios)</option>
                    `).join('')}
                </select>
            </div>
            <div id="workout-day-exercises"></div>
        `;

        this.workoutExercisesContainer.innerHTML = html;

        const selectDay = document.getElementById('select-day');
        selectDay.addEventListener('change', () => this.loadDayExercises(routineId, parseInt(selectDay.value)));

        // Load first day by default
        this.loadDayExercises(routineId, 0);
        this.workoutActions.classList.remove('hidden');
    }

    loadDayExercises(routineId, dayIndex) {
        const routine = this.dataManager.getRoutine(routineId);
        const day = routine.days[dayIndex];

        this.currentWorkoutData = {
            routineId: routineId,
            dayId: day.id,
            dayName: day.name
        };

        // Get last workout for this day (search by dayId first, then by dayName if not found)
        const lastWorkout = this.dataManager.getLastWorkoutForDay(routineId, day.id, day.name);

        const container = document.getElementById('workout-day-exercises');

        // Build previous session summary if exists
        let previousSessionHtml = '';
        if (lastWorkout) {
            const lastDate = new Date(lastWorkout.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            previousSessionHtml = `
                <div class="previous-session-card">
                    <div class="previous-session-header">
                        <span>📊 Sesión anterior (${lastDate})</span>
                    </div>
                    <div class="previous-session-exercises">
                        ${lastWorkout.exercises.map(ex => `
                            <div class="previous-exercise">
                                <span class="prev-ex-name">${ex.exerciseName}</span>
                                <span class="prev-ex-sets">${ex.sets.map(s => `${s.weight}kg${s.rpe ? ` RPE ${s.rpe}` : ''} - ${s.reps}`).join(' | ')}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Build exercise cards with previous data hints
        const exercisesHtml = day.exercises.map(exercise => {
            // Parse sets from exercise config (e.g., "3" or "3-5")
            let numSets = 1;
            if (exercise.sets) {
                const setsStr = exercise.sets.toString();
                // If it's a range like "3-5", take the first number (minimum)
                const match = setsStr.match(/^(\d+)/);
                if (match) {
                    numSets = parseInt(match[1]) || 1;
                }
            }

            // Find previous data for this exercise (flexible comparison for legacy data)
            let prevExerciseData = null;
            if (lastWorkout) {
                const exerciseNameNormalized = exercise.name.toLowerCase().trim();
                prevExerciseData = lastWorkout.exercises.find(e => {
                    const prevName = e.exerciseName.toLowerCase().trim();
                    // Check exact match, or if one name includes the other (for legacy data with sets/reps in name)
                    return prevName === exerciseNameNormalized ||
                        prevName.includes(exerciseNameNormalized) ||
                        exerciseNameNormalized.includes(prevName);
                });
            }

            // Generate the required number of set rows
            let setRowsHtml = '';
            for (let i = 0; i < numSets; i++) {
                // Get previous set data for placeholder hints
                const prevSet = prevExerciseData && prevExerciseData.sets[i];
                setRowsHtml += this.renderSetRow(exercise.id, i, prevSet);
            }

            return `
            <div class="exercise-workout-card" data-exercise-id="${exercise.id}" data-exercise-name="${exercise.name}">
                <div class="exercise-workout-header">${exercise.name}${exercise.sets ? ` <span style="font-weight: normal; font-size: 0.875rem; color: var(--text-tertiary);">(${exercise.sets}×${exercise.reps || '?'})</span>` : ''}</div>
                <div class="sets-container" data-exercise-id="${exercise.id}">
                    ${setRowsHtml}
                </div>
                <button class="btn-secondary add-set-btn" data-exercise-id="${exercise.id}">+ Añadir Serie</button>
            </div>
        `}).join('');

        container.innerHTML = previousSessionHtml + exercisesHtml;

        // Attach event listeners
        container.querySelectorAll('.add-set-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const exerciseId = btn.dataset.exerciseId;
                this.addSet(exerciseId);
            });
        });

        // Attach remove listeners for all pre-loaded set rows
        container.querySelectorAll('.sets-container').forEach(setsContainer => {
            const exerciseId = setsContainer.dataset.exerciseId;
            setsContainer.querySelectorAll('[data-action="remove-set"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.closest('.set-row').remove();
                    this.renumberSets(exerciseId);
                });
            });
        });
    }

    renderSetRow(exerciseId, setNumber, prevSet = null) {
        const weightPlaceholder = prevSet ? `${prevSet.weight}` : 'Peso';
        const repsPlaceholder = prevSet ? `${prevSet.reps}` : 'Reps';
        const rpePlaceholder = prevSet?.rpe ? `${prevSet.rpe}` : 'RPE';

        return `
            <div class="set-row" data-set="${setNumber}">
                <div class="set-number">#${setNumber + 1}</div>
                <input type="number" class="input-number" placeholder="${weightPlaceholder}" step="0.5" min="0" data-field="weight">
                <input type="number" class="input-number" placeholder="${repsPlaceholder}" step="1" min="0" data-field="reps">
                <input type="number" class="input-number" placeholder="${rpePlaceholder}" step="0.5" min="0" max="10" data-field="rpe">
                <button class="btn-icon btn-danger" data-action="remove-set">×</button>
            </div>
        `;
    }

    addSet(exerciseId) {
        const container = this.workoutExercisesContainer.querySelector(`.sets-container[data-exercise-id="${exerciseId}"]`);
        const currentSets = container.querySelectorAll('.set-row').length;

        const newSetHTML = this.renderSetRow(exerciseId, currentSets);
        container.insertAdjacentHTML('beforeend', newSetHTML);

        // Attach remove listener
        const newSetRow = container.querySelector(`.set-row[data-set="${currentSets}"]`);
        newSetRow.querySelector('[data-action="remove-set"]').addEventListener('click', () => {
            newSetRow.remove();
            this.renumberSets(exerciseId);
        });
    }

    renumberSets(exerciseId) {
        const container = this.workoutExercisesContainer.querySelector(`.sets-container[data-exercise-id="${exerciseId}"]`);
        container.querySelectorAll('.set-row').forEach((row, index) => {
            row.dataset.set = index;
            row.querySelector('.set-number').textContent = `#${index + 1}`;
        });
    }

    saveWorkout(isProvisional = false) {
        if (!this.currentWorkoutData.routineId) return;

        const exercisesData = [];
        const dayContainer = document.getElementById('workout-day-exercises');

        dayContainer.querySelectorAll('.exercise-workout-card').forEach(card => {
            const exerciseId = card.dataset.exerciseId;
            const exerciseName = card.dataset.exerciseName || card.querySelector('.exercise-workout-header').textContent;
            const sets = [];

            card.querySelectorAll('.set-row').forEach((row, index) => {
                const weight = parseFloat(row.querySelector('[data-field="weight"]').value) || 0;
                const reps = parseInt(row.querySelector('[data-field="reps"]').value) || 0;
                const rpe = parseFloat(row.querySelector('[data-field="rpe"]').value) || 0;

                if (weight > 0 || reps > 0) {
                    sets.push({
                        setNumber: index + 1,
                        weight,
                        reps,
                        rpe
                    });
                }
            });

            if (sets.length > 0) {
                exercisesData.push({
                    exerciseId,
                    exerciseName,
                    sets
                });
            }
        });

        if (exercisesData.length === 0) {
            alert('Registra al menos un ejercicio con series antes de guardar');
            return;
        }

        // Check if we have an existing provisional workout to update
        if (this.currentWorkoutData.workoutId) {
            // Update existing workout
            this.dataManager.updateWorkout(
                this.currentWorkoutData.workoutId,
                exercisesData,
                isProvisional
            );
        } else {
            // Create new workout
            const workout = this.dataManager.createWorkout(
                this.currentWorkoutData.routineId,
                this.currentWorkoutData.dayId,
                this.currentWorkoutData.dayName,
                exercisesData,
                isProvisional
            );
            // Store the workout ID for future updates
            this.currentWorkoutData.workoutId = workout.id;
        }

        if (isProvisional) {
            // Update input values so they show as real values (not placeholders)
            const dayContainer = document.getElementById('workout-day-exercises');
            dayContainer.querySelectorAll('.exercise-workout-card').forEach(card => {
                card.querySelectorAll('.set-row').forEach(row => {
                    const weightInput = row.querySelector('[data-field="weight"]');
                    const repsInput = row.querySelector('[data-field="reps"]');
                    const rpeInput = row.querySelector('[data-field="rpe"]');

                    // If input has a value, ensure it's set as value (not just typed)
                    if (weightInput.value) weightInput.setAttribute('value', weightInput.value);
                    if (repsInput.value) repsInput.setAttribute('value', repsInput.value);
                    if (rpeInput.value) rpeInput.setAttribute('value', rpeInput.value);
                });
            });
            alert('💾 Guardado provisional - puedes seguir añadiendo datos');
        } else {
            alert('✅ Entrenamiento finalizado y guardado');
            // Reset only on final save
            this.currentWorkoutData.workoutId = null;
            this.selectRoutine.value = '';
            this.loadWorkoutExercises();
        }
        this.updateStats();
    }

    // History
    renderHistory() {
        const filterRoutineId = this.filterRoutine.value;

        if (!filterRoutineId) {
            this.historyList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <h3>Selecciona una rutina</h3>
                    <p>Elige una rutina para ver el historial de entrenamientos</p>
                </div>
            `;
            return;
        }

        let workouts = this.dataManager.getWorkouts(filterRoutineId);

        // Sort by date descending
        workouts.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (workouts.length === 0) {
            this.historyList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <h3>No hay entrenamientos registrados</h3>
                    <p>Tus entrenamientos aparecerán aquí</p>
                </div>
            `;
            return;
        }

        // Group workouts by day name
        const workoutsByDay = {};
        workouts.forEach(w => {
            const dayName = w.dayName || 'Sin día';
            if (!workoutsByDay[dayName]) {
                workoutsByDay[dayName] = [];
            }
            workoutsByDay[dayName].push(w);
        });

        let html = '';

        // For each day, create a table
        Object.keys(workoutsByDay).forEach(dayName => {
            const dayWorkouts = workoutsByDay[dayName];

            // Get all unique exercise names for this day
            const exerciseNames = new Set();
            dayWorkouts.forEach(w => {
                w.exercises.forEach(ex => {
                    exerciseNames.add(ex.exerciseName);
                });
            });

            // Show all workouts, reversed so oldest on left and newest on right
            const recentWorkouts = dayWorkouts.slice().reverse();

            html += `
                <div class="history-day-section">
                    <h3 class="history-day-title">${dayName}</h3>
                    <div class="history-table-wrapper">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th class="exercise-col">Ejercicio</th>
                                    ${recentWorkouts.map(w => {
                const date = new Date(w.date);
                return `<th class="date-col">${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</th>`;
            }).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${Array.from(exerciseNames).map(exName => {
                return `
                                        <tr>
                                            <td class="exercise-name-cell">${exName}</td>
                                            ${recentWorkouts.map((w, wIndex) => {
                    const exercise = w.exercises.find(e => e.exerciseName === exName);
                    if (exercise) {
                        // Get max weight in this workout
                        const maxWeight = Math.max(...exercise.sets.map(s => s.weight || 0));

                        // Compare with previous workout (previous in array since now sorted asc)
                        let isImproved = false;
                        if (wIndex > 0) {
                            const prevWorkout = recentWorkouts[wIndex - 1];
                            const prevExercise = prevWorkout.exercises.find(e => e.exerciseName === exName);
                            if (prevExercise) {
                                const prevMaxWeight = Math.max(...prevExercise.sets.map(s => s.weight || 0));
                                isImproved = maxWeight > prevMaxWeight;
                            }
                        }

                        const setsDisplay = exercise.sets.map(s =>
                            `${s.weight}kg${s.rpe ? ` RPE ${s.rpe}` : ''} - ${s.reps}`
                        ).join('; ');
                        return `<td class="sets-cell${isImproved ? ' weight-improved' : ''}">${setsDisplay}</td>`;
                    }
                    return `<td class="sets-cell empty-cell">-</td>`;
                }).join('')}
                                        </tr>
                                    `;
            }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        this.historyList.innerHTML = html;
    }

    exportHistoryCsv() {
        const filterRoutineId = this.filterRoutine.value;

        if (!filterRoutineId) {
            alert('Por favor, selecciona una rutina para exportar');
            return;
        }

        let workouts = this.dataManager.getWorkouts(filterRoutineId);
        workouts.sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort ascending

        if (workouts.length === 0) {
            alert('No hay entrenamientos para exportar');
            return;
        }

        // Group workouts by day name
        const workoutsByDay = {};
        workouts.forEach(w => {
            const dayName = w.dayName || 'Sin día';
            if (!workoutsByDay[dayName]) {
                workoutsByDay[dayName] = [];
            }
            workoutsByDay[dayName].push(w);
        });

        // Build CSV content
        let csvContent = '';

        Object.keys(workoutsByDay).forEach(dayName => {
            const dayWorkouts = workoutsByDay[dayName];

            // Get all unique exercise names for this day
            const exerciseNames = new Set();
            dayWorkouts.forEach(w => {
                w.exercises.forEach(ex => {
                    exerciseNames.add(ex.exerciseName);
                });
            });

            // Add day header
            csvContent += `\n${dayName}\n`;

            // Add date headers
            const dateHeaders = ['Ejercicio', ...dayWorkouts.map(w => {
                const date = new Date(w.date);
                return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            })];
            csvContent += dateHeaders.join(';') + '\n';

            // Add exercise rows
            Array.from(exerciseNames).forEach(exName => {
                const row = [exName];
                dayWorkouts.forEach(w => {
                    const exercise = w.exercises.find(e => e.exerciseName === exName);
                    if (exercise) {
                        const setsDisplay = exercise.sets.map(s =>
                            `${s.weight}kg${s.rpe ? ` RPE ${s.rpe}` : ''} - ${s.reps}`
                        ).join('; ');
                        row.push(`"${setsDisplay}"`);
                    } else {
                        row.push('-');
                    }
                });
                csvContent += row.join(';') + '\n';
            });
        });

        // Download CSV
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const routine = this.dataManager.getRoutine(filterRoutineId);
        const filename = `historial-${routine?.name || 'rutina'}-${new Date().toISOString().split('T')[0]}.csv`;

        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    showWorkoutDetail(workoutId) {
        const workout = this.dataManager.getWorkout(workoutId);
        if (!workout) return;

        let html = `
            <div style="margin-bottom: 1rem;">
                <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">${workout.routineName}</h3>
                <p style="color: var(--text-secondary); font-size: 0.9375rem; margin-bottom: 0.25rem;">${workout.dayName || ''}</p>
                <p style="color: var(--text-tertiary); font-size: 0.875rem;">${formatDate(workout.date)}</p>
            </div>
        `;

        workout.exercises.forEach(exercise => {
            html += `
                <div style="margin-bottom: 1.5rem;">
                    <h4 style="font-size: 1.125rem; font-weight: 700; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                        ${exercise.exerciseName}
                    </h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="color: var(--text-tertiary); font-size: 0.875rem;">
                                <th style="text-align: left; padding: 0.5rem;">Serie</th>
                                <th style="text-align: center; padding: 0.5rem;">Peso (kg)</th>
                                <th style="text-align: center; padding: 0.5rem;">Reps</th>
                                <th style="text-align: center; padding: 0.5rem;">RPE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${exercise.sets.map(set => `
                                <tr style="border-top: 1px solid var(--border-color);">
                                    <td style="padding: 0.5rem;">#${set.setNumber}</td>
                                    <td style="text-align: center; padding: 0.5rem;">${set.weight}</td>
                                    <td style="text-align: center; padding: 0.5rem;">${set.reps}</td>
                                    <td style="text-align: center; padding: 0.5rem;">${set.rpe}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        this.workoutDetailBody.innerHTML = html;
        this.workoutDetailModal.classList.add('active');
    }

    closeWorkoutDetailModal() {
        this.workoutDetailModal.classList.remove('active');
    }

    // Export/Import
    exportData() {
        const data = this.dataManager.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gymtracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const success = this.dataManager.importData(e.target.result);
            if (success) {
                alert('✅ Datos importados correctamente');
                this.renderRoutines();
                this.updateStats();
                this.updateRoutineSelects();
            } else {
                alert('❌ Error al importar datos. Verifica el archivo.');
            }
        };
        reader.readAsText(file);

        // Reset input
        event.target.value = '';
    }

    // Weight Tracking Functions
    openWeightModal(entryToEdit = null) {
        if (entryToEdit) {
            // Edit mode
            this.editingWeightId = entryToEdit.id;
            this.weightDateInput.value = entryToEdit.date.includes('T')
                ? entryToEdit.date.split('T')[0]
                : entryToEdit.date;
            this.weightValueInput.value = entryToEdit.weight;
        } else {
            // Add mode
            this.editingWeightId = null;
            this.weightDateInput.value = new Date().toISOString().split('T')[0];
            this.weightValueInput.value = '';
        }
        this.weightModal.classList.add('active');
        this.weightValueInput.focus();
    }

    closeWeightModal() {
        this.weightModal.classList.remove('active');
        this.editingWeightId = null;
    }

    saveWeight() {
        const date = this.weightDateInput.value;
        const weight = parseFloat(this.weightValueInput.value);

        if (!date || !weight || weight <= 0) {
            alert('Por favor, introduce una fecha y un peso válido');
            return;
        }

        if (this.editingWeightId) {
            // Update existing entry
            this.dataManager.updateWeightEntry(this.editingWeightId, date, weight);
            alert('✅ Peso actualizado correctamente');
        } else {
            // Add new entry
            this.dataManager.addWeightEntry(date, weight);
            alert('✅ Peso registrado correctamente');
        }

        this.closeWeightModal();
        this.renderWeightHistory();
        this.renderWeightChart();
    }

    exportWeightCsv() {
        const rawEntries = this.dataManager.getWeightEntries();

        if (rawEntries.length === 0) {
            alert('No hay datos de peso para exportar');
            return;
        }

        // Get processed data with imputations and SMA
        const processedData = this.dataManager.processWeightData();

        // Build CSV content
        let csvContent = 'Fecha;Peso (kg);Tipo;SMA7\n';

        processedData.forEach(entry => {
            const date = new Date(entry.date);
            const formattedDate = date.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const weight = entry.weight !== null ? entry.weight.toFixed(1) : '';
            const tipo = entry.isReal ? 'Real' : (entry.isImputed ? 'Estimado' : '');
            const sma7 = entry.sma7 !== null ? entry.sma7.toFixed(1) : '';

            csvContent += `${formattedDate};${weight};${tipo};${sma7}\n`;
        });

        // Download CSV
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const filename = `peso-${new Date().toISOString().split('T')[0]}.csv`;

        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    renderWeightHistory() {
        const rawEntries = this.dataManager.getWeightEntries();

        if (rawEntries.length === 0) {
            this.weightHistoryList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <p>No hay registros de peso todavía</p>
                </div>
            `;
            return;
        }

        // Get processed data with imputations and SMA
        const processedData = this.dataManager.processWeightData();

        // Create ID map for delete functionality
        const entryIdMap = {};
        rawEntries.forEach(e => {
            const dateStr = e.date.split('T')[0];
            entryIdMap[dateStr] = e.id;
        });

        // Show entries in reverse order (newest first)
        const sortedEntries = [...processedData].reverse();

        this.weightHistoryList.innerHTML = `
            <table class="weight-table">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Peso</th>
                        <th>SMA₇</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedEntries.map((entry) => {
            const date = new Date(entry.date);
            const formattedDate = date.toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'short'
            });

            // Weight display
            let weightDisplay = '—';
            let weightClass = 'weight-missing';
            if (entry.isReal) {
                weightDisplay = `<strong>${entry.weight.toFixed(1)}</strong>`;
                weightClass = '';
            } else if (entry.isImputed && entry.weight !== null) {
                weightDisplay = `<span class="imputed-value">${entry.weight.toFixed(1)}*</span>`;
                weightClass = 'weight-imputed';
            }

            // SMA display
            let smaDisplay = '—';
            if (entry.sma7 !== null) {
                smaDisplay = entry.sma7.toFixed(1);
            }

            // Action buttons - edit/delete for real entries, add for empty entries
            const entryId = entryIdMap[entry.date];
            let actionBtns = '';
            if (entry.isReal && entryId) {
                actionBtns = `<button class="btn-icon btn-edit-weight" data-entry-id="${entryId}" data-date="${entry.date}" data-weight="${entry.weight}">✏️</button>
                   <button class="btn-icon btn-danger btn-delete-weight" data-entry-id="${entryId}">🗑️</button>`;
            } else {
                // Add button for empty/imputed days
                actionBtns = `<button class="btn-icon btn-add-weight" data-date="${entry.date}" title="Añadir peso">➕</button>`;
            }

            return `
                            <tr class="${weightClass}">
                                <td>${formattedDate}</td>
                                <td>${weightDisplay} kg</td>
                                <td class="sma-cell">${smaDisplay}</td>
                                <td class="action-btns">${actionBtns}</td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
            <div class="weight-legend">
                <span><strong>*</strong> = Valor estimado (imputado)</span>
                <span><strong>SMA₇</strong> = Media móvil 7 días (mín. 5 datos reales)</span>
            </div>
        `;

        // Attach edit listeners
        this.weightHistoryList.querySelectorAll('.btn-edit-weight').forEach(btn => {
            btn.addEventListener('click', () => {
                const entryToEdit = {
                    id: btn.dataset.entryId,
                    date: btn.dataset.date,
                    weight: parseFloat(btn.dataset.weight)
                };
                this.openWeightModal(entryToEdit);
            });
        });

        // Attach delete listeners
        this.weightHistoryList.querySelectorAll('.btn-delete-weight').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('¿Eliminar este registro de peso?')) {
                    this.dataManager.deleteWeightEntry(btn.dataset.entryId);
                    this.renderWeightHistory();
                    this.renderWeightChart();
                }
            });
        });

        // Attach add listeners for empty/imputed days
        this.weightHistoryList.querySelectorAll('.btn-add-weight').forEach(btn => {
            btn.addEventListener('click', () => {
                // Open modal with pre-filled date
                this.editingWeightId = null;
                this.weightDateInput.value = btn.dataset.date;
                this.weightValueInput.value = '';
                this.weightModal.classList.add('active');
                this.weightValueInput.focus();
            });
        });
    }

    renderWeightChart() {
        const rawEntries = this.dataManager.getWeightEntries();

        // Destroy existing chart if any
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        if (rawEntries.length === 0) {
            return;
        }

        // Get processed data
        let processedData = this.dataManager.processWeightData();

        // Filter by date range
        const range = this.currentChartRange || '14';
        if (range !== 'all') {
            const daysAgo = parseInt(range);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
            processedData = processedData.filter(e => new Date(e.date) >= cutoffDate);
        }

        if (processedData.length === 0) {
            return;
        }

        const ctx = this.weightChart.getContext('2d');

        const labels = processedData.map(e => {
            const date = new Date(e.date);
            return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        });

        // Weight data (real + imputed)
        const weightData = processedData.map(e => e.weight);

        // SMA data (null where not calculated)
        const smaData = processedData.map(e => e.sma7);

        // Point colors: real = solid, imputed = transparent
        const pointColors = processedData.map(e =>
            e.isReal ? '#6366f1' : 'rgba(99, 102, 241, 0.4)'
        );

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

        this.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Peso',
                        data: weightData,
                        borderColor: '#6366f1',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointBackgroundColor: pointColors,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        spanGaps: false
                    },
                    {
                        label: 'SMA₇',
                        data: smaData,
                        borderColor: '#f59e0b',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#94a3b8',
                            font: { size: 11 },
                            boxWidth: 20
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            maxRotation: 45,
                            font: { size: 10 }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            callback: function (value) {
                                return value + ' kg';
                            }
                        }
                    }
                }
            }
        });
    }
}

// ========================================
// Application Initialization
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    const dataManager = new DataManager();
    const uiManager = new UIManager(dataManager);

    // Expose uiManager globally for Firebase sync
    window.uiManager = uiManager;

    console.log('🏋️ GymTracker Multi-Day initialized!');
});
