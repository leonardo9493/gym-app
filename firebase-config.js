// ========================================
// Firebase Configuration & Auth
// ========================================

const firebaseConfig = {
    apiKey: "AIzaSyCHsM3Ej-TyynXGJusmqxTjcKb87TkbD3k",
    authDomain: "gym-tracker-41975.firebaseapp.com",
    projectId: "gym-tracker-41975",
    storageBucket: "gym-tracker-41975.firebasestorage.app",
    messagingSenderId: "559209331630",
    appId: "1:559209331630:web:d65138e4461ab86ae3263f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Current user reference
let currentUser = null;

// ========================================
// Auth Functions
// ========================================

function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            console.log('✅ Logged in:', result.user.displayName);
        })
        .catch((error) => {
            console.error('❌ Login error:', error);
            alert('Error al iniciar sesión: ' + error.message);
        });
}

function signOut() {
    auth.signOut()
        .then(() => {
            console.log('✅ Logged out');
        })
        .catch((error) => {
            console.error('❌ Logout error:', error);
        });
}

// Auth state observer
auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateAuthUI(user);

    if (user) {
        // User is signed in - show menu and sync data
        showAppView('menu');
        syncFromFirebase();
    } else {
        // User is signed out - show login screen
        showAppView('login');
    }
});

function showAppView(viewName) {
    const loginView = document.getElementById('login-view');
    const menuView = document.getElementById('menu-view');

    if (viewName === 'login') {
        if (loginView) loginView.classList.add('active');
        if (menuView) menuView.classList.remove('active');
    } else if (viewName === 'menu') {
        if (loginView) loginView.classList.remove('active');
        if (menuView) menuView.classList.add('active');
    }
}

function updateAuthUI(user) {
    const loggedOutSection = document.getElementById('auth-logged-out');
    const loggedInSection = document.getElementById('auth-logged-in');
    const userPhoto = document.getElementById('user-photo');
    const userName = document.getElementById('user-name');

    if (user) {
        if (loggedOutSection) loggedOutSection.classList.add('hidden');
        if (loggedInSection) loggedInSection.classList.remove('hidden');
        if (userPhoto) userPhoto.src = user.photoURL || 'https://via.placeholder.com/48';
        if (userName) userName.textContent = user.displayName || user.email;
    } else {
        if (loggedOutSection) loggedOutSection.classList.remove('hidden');
        if (loggedInSection) loggedInSection.classList.add('hidden');
    }
}

// ========================================
// Firebase Sync Functions
// ========================================

async function syncToFirebase(data) {
    if (!currentUser) return;

    try {
        await db.collection('users').doc(currentUser.uid).set({
            gymTrackerData: data,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('✅ Data synced to Firebase');
    } catch (error) {
        console.error('❌ Sync error:', error);
    }
}

async function syncFromFirebase() {
    if (!currentUser) return null;

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists && doc.data().gymTrackerData) {
            const cloudData = doc.data().gymTrackerData;

            // Compare timestamps to decide which data is newer
            const localData = JSON.parse(localStorage.getItem('gymTrackerData') || '{}');

            // If cloud data exists and is valid, merge with local
            if (cloudData.routines || cloudData.workouts || cloudData.weightEntries) {
                // Merge strategy: cloud data takes precedence, but preserve local if cloud is empty
                const mergedData = {
                    routines: cloudData.routines?.length ? cloudData.routines : (localData.routines || []),
                    workouts: cloudData.workouts?.length ? cloudData.workouts : (localData.workouts || []),
                    weightEntries: cloudData.weightEntries?.length ? cloudData.weightEntries : (localData.weightEntries || []),
                    currentRoutineId: cloudData.currentRoutineId || localData.currentRoutineId || null
                };

                // Save merged data to localStorage
                localStorage.setItem('gymTrackerData', JSON.stringify(mergedData));
                console.log('✅ Data synced from Firebase');

                // Refresh UI
                if (window.uiManager) {
                    window.uiManager.dataManager.loadData();
                    window.uiManager.renderRoutines();
                    window.uiManager.updateStats();
                    window.uiManager.renderWeightHistory();
                    window.uiManager.renderWeightChart();
                }
            }

            return cloudData;
        }
        return null;
    } catch (error) {
        console.error('❌ Fetch error:', error);
        return null;
    }
}

// ========================================
// Event Listeners for Auth Buttons
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Main login button (on login screen)
    const btnGoogleLoginMain = document.getElementById('btn-google-login-main');
    if (btnGoogleLoginMain) {
        btnGoogleLoginMain.addEventListener('click', signInWithGoogle);
    }

    // Secondary login button (on menu screen)
    const btnGoogleLogin = document.getElementById('btn-google-login');
    if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', signInWithGoogle);
    }

    // Logout button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', signOut);
    }
});
