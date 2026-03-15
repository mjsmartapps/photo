import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, writeBatch, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyB5jaPVkCwxXiMYhSn0uuW9QSMc-B5C9YY",
    authDomain: "mjsmartapps.firebaseapp.com",
    projectId: "mjsmartapps",
    storageBucket: "mjsmartapps.firebasestorage.app",
    messagingSenderId: "1033240518010",
    appId: "1:1033240518010:web:930921011dda1bd56e0ac3",
    measurementId: "G-959VLQSHH2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentStudioName = "MJ SMART STUDIO";
let rawData = {};
let groupedData = {};
let batchTarget = { monthKey: null, status: null, clientIds: [] };
let lockTarget = { monthKey: null, isLocked: false, clientIds: [] };
let currentBatchTotalCost = 0; 
let currentBatchAlreadyPaid = 0; 
let batchConfirmModal = null;
let lockConfirmModal = null;
let profileModal = null;
let userSelectModal = null;

// New: Store the specifically selected user ID and Unsubscribe functions
let targetUserId = null;
let unsubClients = null;
let unsubSettings = null;

document.addEventListener('DOMContentLoaded', () => {
    batchConfirmModal = new bootstrap.Modal(document.getElementById('batchConfirmModal'));
    lockConfirmModal = new bootstrap.Modal(document.getElementById('lockConfirmModal'));
    profileModal = new bootstrap.Modal(document.getElementById('profileModal'));
    
    const now = new Date();
    const monthStr = now.toISOString().slice(0, 7); 
    document.getElementById('monthFilter').value = monthStr;
    
    document.getElementById('monthFilter').addEventListener('change', () => {
        processAndRender(rawData);
    });
});

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    let icon = type === 'success' ? 'bi-check-circle-fill text-success' : 'bi-info-circle-fill text-primary';
    if(type === 'error') icon = 'bi-x-circle-fill text-danger';
    const toastEl = document.createElement('div');
    toastEl.className = 'toast show align-items-center';
    toastEl.innerHTML = `<div class="d-flex"><div class="toast-body d-flex align-items-center gap-2"><i class="bi ${icon}"></i> ${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest('.toast').remove()"></button></div>`;
    toastContainer.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 3000);
}

function formatBytes(bytes) {
    if (!+bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

// Dynamically create and render the user selection modal using detailed profile fetching
window.renderUserSelectModal = async () => {
    let modalEl = document.getElementById('userSelectModal');
    if (!modalEl) {
        const html = `
        <div class="modal fade" id="userSelectModal" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content glass-panel" style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1);">
                    <div class="modal-header border-bottom border-secondary border-opacity-25">
                        <h5 class="modal-title fw-bold text-white"><i class="bi bi-people-fill me-2 text-primary"></i>Select User Studio</h5>
                    </div>
                    <div class="modal-body p-4" style="max-height: 70vh; overflow-y: auto;">
                        <div id="userListContainer" class="d-grid gap-3">
                            <div class="text-center text-secondary py-3">
                                <span class="spinner-border spinner-border-sm me-2"></span>Loading users...
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-top border-secondary border-opacity-25">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modalEl = document.getElementById('userSelectModal');
        userSelectModal = new bootstrap.Modal(modalEl);
    }
    
    userSelectModal.show();
    
    document.getElementById('userListContainer').innerHTML = `
        <div class="text-center text-secondary py-3">
            <span class="spinner-border spinner-border-sm me-2"></span>Loading users...
        </div>`;

    try {
        const uniqueUsers = new Set();

        // 1. Direct fetch from users collection
        try {
            const usersSnap = await getDocs(collection(db, 'users'));
            usersSnap.forEach(doc => uniqueUsers.add(doc.id));
        } catch (e) { }

        // 2. Fetch via CollectionGroup 'clients'
        try {
            const clientsSnap = await getDocs(collectionGroup(db, 'clients'));
            clientsSnap.forEach(doc => {
                const parts = doc.ref.path.split('/');
                if (parts.length >= 3 && parts[0] === 'users') {
                    uniqueUsers.add(parts[1]);
                }
            });
        } catch (e) { }

        // 3. Fetch via CollectionGroup 'settings'
        try {
            const settingsSnap = await getDocs(collectionGroup(db, 'settings'));
            settingsSnap.forEach(doc => {
                const parts = doc.ref.path.split('/');
                if (parts.length >= 3 && parts[0] === 'users') {
                    uniqueUsers.add(parts[1]);
                }
            });
        } catch (e) { }

        // Fetch detailed profile for each identified UID
        const profilePromises = Array.from(uniqueUsers).map(async (uid) => {
            try {
                const snap = await getDoc(doc(db, 'users', uid, 'profile', 'info'));
                const data = snap.exists() ? snap.data() : {};
                return { uid, ...data };
            } catch(e) {
                return { uid };
            }
        });
        
        const profiles = await Promise.all(profilePromises);
        
        function formatDateTime(timestamp) {
            if (!timestamp) return 'N/A';
            const d = new Date(timestamp);
            const pad = (n) => n.toString().padStart(2, '0');
            return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} & ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
        
        let listHtml = '';
        
        if (profiles.length === 0) {
            listHtml = '<p class="text-secondary text-center">No users found.</p>';
        } else {
            profiles.forEach(p => {
                const isActive = (p.uid === targetUserId);
                const btnClass = isActive ? 'border-primary bg-primary bg-opacity-10' : 'border-secondary border-opacity-25 bg-dark bg-opacity-50';
                
                // Use available timestamps or 'N/A'
                const dateStr = formatDateTime(p.updatedAt || p.createdAt);
                
                const sName = p.studioName || 'Unknown Studio';
                const uName = p.name || 'N/A';
                const uPhone = p.phone || 'N/A';
                const uEmail = p.email || 'N/A';

                listHtml += `
                    <div class="user-card p-3 rounded border ${btnClass} cursor-pointer" onclick="window.selectUser('${p.uid}', '${sName.replace(/'/g, "\\'")}')">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="fw-bold text-white mb-0"><i class="bi bi-shop me-2 text-primary"></i>${sName}</h6>
                            <span class="badge bg-secondary bg-opacity-25 text-light font-monospace" style="font-size: 0.75rem;">${dateStr}</span>
                        </div>
                        <div class="row g-2">
                            <div class="col-md-4 text-secondary small"><i class="bi bi-person me-2"></i>${uName}</div>
                            <div class="col-md-4 text-secondary small"><i class="bi bi-telephone me-2"></i>${uPhone}</div>
                            <div class="col-md-4 text-secondary small text-truncate" title="${uEmail}"><i class="bi bi-envelope me-2"></i>${uEmail}</div>
                        </div>
                        <div class="text-secondary mt-2 font-monospace" style="font-size:0.65rem;">UID: ${p.uid}</div>
                    </div>
                `;
            });
        }
        document.getElementById('userListContainer').innerHTML = listHtml;
    } catch (e) {
        document.getElementById('userListContainer').innerHTML = `<p class="text-danger text-center small">Error loading users: ${e.message}</p>`;
        showToast("Error fetching users", 'error');
    }
};

window.selectUser = (uid, studioName) => {
    targetUserId = uid;
    currentStudioName = studioName || 'Unknown Studio';
    userSelectModal.hide();
    document.getElementById('dashboardView').classList.remove('hidden');
    
    // Update dashboard visual label
    document.getElementById('currentUserDisplay').innerHTML = `<i class="bi bi-shop me-1"></i>Studio: <span class="text-white">${currentStudioName}</span> <span class="text-secondary ms-2 small font-monospace">(${uid})</span>`;
    
    // Initialize data uniquely mapped to the selected user
    initData();
    initGlobalSettings();
    showToast(`Managing data for: ${currentStudioName}`, 'success');
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('loginView').classList.add('hidden');
        await window.renderUserSelectModal();
    } else {
        targetUserId = null;
        if (unsubClients) { unsubClients(); unsubClients = null; }
        if (unsubSettings) { unsubSettings(); unsubSettings = null; }

        if(userSelectModal) userSelectModal.hide();
        document.getElementById('dashboardView').classList.add('hidden');
        document.getElementById('loginView').classList.remove('hidden');
    }
});

document.getElementById('btnLogin').addEventListener('click', () => {
    const btn = document.getElementById('btnLogin');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Signing In...';
    signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passInput').value).catch(err => { showToast(err.message, 'error'); btn.innerHTML = 'Sign In'; });
});

document.getElementById('btnLogout').addEventListener('click', () => signOut(auth));

function initData() {
    if (!targetUserId) return;
    
    // Cleanup previous listener if switching users
    if (unsubClients) unsubClients();
    
    // Firestore: Listen to specific user's 'clients' collection
    unsubClients = onSnapshot(collection(db, 'users', targetUserId, 'clients'), (snapshot) => {
        rawData = {}; // Reset container
        
        if (!snapshot.empty) {
            snapshot.forEach(doc => {
                rawData[doc.id] = doc.data();
            });
            processAndRender(rawData);
        } else {
            rawData = {};
            document.getElementById('monthlyCardGrid').innerHTML = '<div class="col-12 text-center py-5 text-secondary">No data available for this user.</div>';
            document.getElementById('globalTotalRevenue').innerText = "₹0.00";
            document.getElementById('globalPendingRevenue').innerText = "₹0.00";
        }
    });
}

function initGlobalSettings() {
    if (!targetUserId) return;

    // Cleanup previous listener if switching users
    if (unsubSettings) unsubSettings();

    // Firestore: Listen to specific user's 'settings/config' document
    unsubSettings = onSnapshot(doc(db, 'users', targetUserId, 'settings', 'config'), (snapshot) => {
        const isLocked = snapshot.exists() ? (snapshot.data().creationLocked === true) : false;
        
        const toggle = document.getElementById('creationLockToggle');
        const label = document.getElementById('creationLockLabel');
        toggle.checked = isLocked;
        if (isLocked) {
            label.innerText = "RESTRICTED";
            label.className = "fs-3 fw-bold text-danger";
        } else {
            label.innerText = "ALLOWED";
            label.className = "fs-3 fw-bold text-success";
        }
    });
}

window.toggleCreationLock = async (checkbox) => {
    if (!targetUserId) return;
    const isLocked = checkbox.checked;
    
    try {
        await setDoc(doc(db, 'users', targetUserId, 'settings', 'config'), { creationLocked: isLocked }, { merge: true });
        
        const msg = isLocked ? "New Client Creation RESTRICTED" : "New Client Creation ENABLED";
        showToast(msg, isLocked ? 'error' : 'success'); 
    } catch (err) {
        checkbox.checked = !isLocked;
        showToast("Update failed: " + err.message, 'error');
    }
};

// PROFILE SETTINGS LOGIC
window.openProfileSettings = async () => {
    if (!targetUserId) return;

    try {
        // Firestore: Get document for specific user's profile
        const snap = await getDoc(doc(db, 'users', targetUserId, 'settings', 'profile'));
        if (snap.exists()) {
            const data = snap.val ? snap.val() : snap.data(); // Safety check
            document.getElementById('profLogoUrl').value = data.logoUrl || '';
            document.getElementById('profContact').value = data.contactPhone || '';
            document.getElementById('profAddress').value = data.address || '';
            document.getElementById('profMap').value = data.mapLink || '';
        } else {
            // clear out previous values if document doesn't exist
            document.getElementById('profLogoUrl').value = '';
            document.getElementById('profContact').value = '';
            document.getElementById('profAddress').value = '';
            document.getElementById('profMap').value = '';
        }
        document.getElementById('logoUploadStatus').innerText = '';
        profileModal.show();
    } catch (error) {
        showToast("Failed to load profile: " + error.message, "error");
    }
};

window.saveProfile = async () => {
    if (!targetUserId) return;

    const profileData = {
        logoUrl: document.getElementById('profLogoUrl').value,
        contactPhone: document.getElementById('profContact').value,
        address: document.getElementById('profAddress').value,
        mapLink: document.getElementById('profMap').value,
        updatedAt: Date.now()
    };

    try {
        // Firestore: Set document for specific user's profile
        await setDoc(doc(db, 'users', targetUserId, 'settings', 'profile'), profileData);
        showToast("Profile settings updated successfully!", "success");
        profileModal.hide();
    } catch (error) {
        showToast("Error saving profile: " + error.message, "error");
    }
};

// R2 Logo Upload
window.handleLogoUpload = async (input) => {
    if (!input.files || !input.files[0] || !targetUserId) return;
    const file = input.files[0];
    const statusLabel = document.getElementById('logoUploadStatus');
    
    statusLabel.innerText = "Uploading logo...";
    statusLabel.className = "text-info small mt-1";

    const formData = new FormData();
    const ext = file.name.split('.').pop();
    const path = `studio_assets/${targetUserId}/logo_${Date.now()}.${ext}`;
    
    formData.append("file", file);
    formData.append("path", path);
    const WORKER_URL = "https://cool-rice-5599.mjappkdl.workers.dev"; 

    try {
        const res = await fetch(WORKER_URL, { method: "POST", body: formData });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = await res.json();
        
        document.getElementById('profLogoUrl').value = data.url;
        statusLabel.innerText = "Upload complete!";
        statusLabel.className = "text-success small mt-1";
    } catch (error) {
        console.error("Logo Upload Error:", error);
        statusLabel.innerText = "Upload failed.";
        statusLabel.className = "text-danger small mt-1";
    }
};

function processAndRender(data) {
    groupedData = {};
    const filterValue = document.getElementById('monthFilter').value; 

    // 1. Group Data by Month First
    Object.entries(data).forEach(([key, client]) => {
        const date = new Date(client.date || Date.now());
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!groupedData[monthKey]) {
            groupedData[monthKey] = {
                monthKey: monthKey,
                monthLabel: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
                clientIds: [],
                totalClients: 0,
                totalStorage: 0,
                totalCost: 0,
                isLocked: false,
                status: 'unpaid',
                meta: null 
            };
        }

        const size = client.totalSize || 0;
        const cost = (size / (1024 ** 3)) * 15;

        groupedData[monthKey].clientIds.push(key);
        groupedData[monthKey].totalClients++;
        groupedData[monthKey].totalStorage += size;
        groupedData[monthKey].totalCost += cost;
        
        if (client.paymentStatus === 'paid') {
            groupedData[monthKey].status = 'paid';
        }
        if (client.paymentMeta && !groupedData[monthKey].meta) {
            groupedData[monthKey].meta = client.paymentMeta;
        }
        
        if (client.isLocked) groupedData[monthKey].isLocked = true;
    });

    // 2. Calculate Globals & Balances
    let globalPaid = 0;
    let globalPending = 0;

    Object.values(groupedData).forEach(month => {
        let monthPaid = 0;
        let monthBalance = month.totalCost;

        if (month.status === 'paid') {
            if (month.meta && month.meta.batchPaidAmount) {
                monthPaid = parseFloat(month.meta.batchPaidAmount);
                monthBalance = Math.max(0, month.totalCost - monthPaid);
            } else {
                monthPaid = month.totalCost;
                monthBalance = 0;
            }
        } 
        
        globalPaid += monthPaid;
        globalPending += monthBalance;

        month.displayBalance = monthBalance;
        month.displayPaid = monthPaid;
        month.isPaid = (month.status === 'paid');
    });

    let displayKeys = Object.keys(groupedData).sort().reverse();
    if (filterValue) {
        displayKeys = displayKeys.filter(key => key === filterValue);
    }

    renderGrid(displayKeys, globalPaid, globalPending);
}

function renderGrid(keys, gPaid, gPending) {
    const container = document.getElementById('monthlyCardGrid');
    container.innerHTML = '';

    if (keys.length === 0) {
        container.innerHTML = '<div class="col-12 text-center py-5 text-secondary">No records found for the selected month.</div>';
        return;
    }

    keys.forEach(monthKey => {
        const data = groupedData[monthKey];
        
        const checkedAttr = data.isLocked ? 'checked' : '';
        const lockLabel = data.isLocked ? 'LOCKED' : 'ACTIVE';
        const lockColor = data.isLocked ? 'text-danger' : 'text-success';

        let paymentStatusHtml;
        if(data.isPaid) {
            if(data.displayBalance > 0.01) { 
                paymentStatusHtml = `<span class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 rounded-pill px-3"><i class="bi bi-pie-chart-fill me-1"></i> PARTIAL</span>`;
            } else {
                paymentStatusHtml = `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 rounded-pill px-3"><i class="bi bi-check-circle-fill me-1"></i> PAID</span>`;
            }
        } else {
            paymentStatusHtml = `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 rounded-pill px-3"><i class="bi bi-clock-history me-1"></i> UNPAID</span>`;
        }
        
        let costLabel = "Est. Cost";
        let costClass = "text-warning";
        let costValueDisplay = data.totalCost;

        if (data.isPaid) {
            if (data.displayBalance > 0.01) {
                costLabel = "Balance Due";
                costClass = "text-danger";
                costValueDisplay = data.displayBalance;
            } else {
                costLabel = "Settled";
                costClass = "text-success";
                costValueDisplay = 0; 
            }
        }

        const html = `
            <div class="col">
                <div class="glass-panel h-100 d-flex flex-column">
                    <div class="p-4 flex-grow-1">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h4 class="month-header mb-0">${data.monthLabel}</h4>
                            
                            <div class="d-flex align-items-center">
                                <span class="lock-label ${lockColor}">${lockLabel}</span>
                                <label class="lock-switch" title="Toggle Service Lock">
                                    <input type="checkbox" ${checkedAttr} onclick="window.handleLockToggle(event, '${monthKey}')">
                                    <span class="lock-slider"></span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="d-flex justify-content-between align-items-start mb-4">
                            <div>
                                <div class="card-label">Studio Name</div>
                                <div class="fs-5 text-white fw-bold"><i class="bi bi-building me-2 text-primary"></i>${currentStudioName}</div>
                            </div>
                            <div class="text-end">
                                <div class="card-label">Status</div>
                                ${paymentStatusHtml}
                            </div>
                        </div>

                        <div class="row g-3">
                            <div class="col-4">
                                <div class="card-label">Events</div>
                                <div class="card-value text-white">${data.totalClients}</div>
                            </div>
                            <div class="col-4">
                                <div class="card-label">Storage</div>
                                <div class="card-value text-info">${formatBytes(data.totalStorage)}</div>
                            </div>
                            <div class="col-4">
                                <div class="card-label">${costLabel}</div>
                                <div class="card-value ${costClass}">₹${costValueDisplay.toFixed(2)}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="p-3 border-top border-white border-opacity-10 bg-black bg-opacity-25 rounded-bottom-4">
                        <div class="d-flex gap-2">
                            <button class="btn-soft btn-soft-success" onclick="window.askBatchConfirm('${monthKey}', 'paid')">MARK PAID</button>
                            <button class="btn-soft btn-soft-danger" onclick="window.askBatchConfirm('${monthKey}', 'unpaid')">MARK UNPAID</button>
                            <button class="btn-soft btn-soft-warning" onclick="window.askBatchConfirm('${monthKey}', 'calculating')">RE-CALC</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });

    animateValue(document.getElementById('globalTotalRevenue'), gPaid);
    animateValue(document.getElementById('globalPendingRevenue'), gPending);
}

function animateValue(obj, end) {
    let startTimestamp = null;
    const duration = 800;
    const start = parseFloat(obj.innerText.replace('₹', '')) || 0;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const val = (progress * (end - start) + start).toFixed(2);
        obj.innerText = `₹${val}`;
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

window.handleLockToggle = (event, monthKey) => {
    event.preventDefault(); 
    const isLocking = event.target.checked;
    const data = groupedData[monthKey];
    
    lockTarget = {
        monthKey: monthKey,
        isLocked: isLocking,
        clientIds: data.clientIds
    };

    document.getElementById('lockModalTitle').innerText = isLocking ? "Lock Services?" : "Unlock Services?";
    document.getElementById('lockActionText').innerText = isLocking ? "LOCK" : "UNLOCK";
    document.getElementById('lockActionText').className = isLocking ? "text-danger" : "text-success";
    document.getElementById('lockMonthName').innerText = data.monthLabel;

    lockConfirmModal.show();
};

window.performLockUpdate = async () => {
    if(!lockTarget.clientIds.length || !targetUserId) return;
    
    try {
        // Firestore: Batch Update targeting specific user's clients
        const batch = writeBatch(db);
        
        lockTarget.clientIds.forEach(id => {
            const docRef = doc(db, 'users', targetUserId, 'clients', id);
            batch.update(docRef, { isLocked: lockTarget.isLocked });
        });

        await batch.commit();
        
        showToast(`Services ${lockTarget.isLocked ? 'LOCKED' : 'UNLOCKED'} successfully`, 'success');
        lockConfirmModal.hide();
    } catch(err) {
        showToast("Lock action failed: " + err.message, 'error');
        lockConfirmModal.hide();
    }
};

window.askBatchConfirm = (monthKey, status) => {
    const data = groupedData[monthKey];
    if(!data) return;

    batchTarget = { monthKey: monthKey, status: status, clientIds: data.clientIds };
    currentBatchTotalCost = data.totalCost; 

    document.getElementById('confirmMonthName').innerText = data.monthLabel;
    document.getElementById('confirmClientCount').innerText = data.totalClients;
    document.getElementById('confirmStatusName').innerText = status;
    
    const paymentDiv = document.getElementById('paymentDetailsInput');
    const estCostLabel = document.getElementById('modalEstCost');
    const alreadyPaidLabel = document.getElementById('modalAlreadyPaid');
    const receivedInput = document.getElementById('modalReceivedInput');
    const paidInput = document.getElementById('modalPaidInput');

    if (status === 'paid') {
        paymentDiv.classList.remove('hidden');
        estCostLabel.innerText = `₹${currentBatchTotalCost.toFixed(2)}`;
        
        // Populate Already Paid
        const prevPaid = data.displayPaid || 0;
        currentBatchAlreadyPaid = prevPaid; 
        alreadyPaidLabel.innerText = `₹${prevPaid.toFixed(2)}`;
        
        // Set default Received Amount to Remaining Balance (Total - Already Paid)
        const pendingBalance = currentBatchTotalCost - prevPaid;
        receivedInput.value = pendingBalance.toFixed(2);
        
        // Update Total Paid Input (Read Only)
        paidInput.value = (prevPaid + pendingBalance).toFixed(2);
        
        // Update Balance Label
        window.calculateTotal();

    } else {
        paymentDiv.classList.add('hidden');
    }
    
    batchConfirmModal.show();
};

// Real-time calculation based on Received Amount
window.calculateTotal = () => {
    const receivedInput = document.getElementById('modalReceivedInput');
    const paidInput = document.getElementById('modalPaidInput');
    const balanceLabel = document.getElementById('modalBalance');
    
    const receivedAmount = parseFloat(receivedInput.value) || 0;
    
    // Total Paid = Already Paid + Newly Received Amount
    const totalPaid = currentBatchAlreadyPaid + receivedAmount;
    paidInput.value = totalPaid.toFixed(2);

    // Balance Due display logic (Total - Already Paid)
    const balance = currentBatchTotalCost - currentBatchAlreadyPaid;
    balanceLabel.innerText = `₹${balance.toFixed(2)}`;
    
    if (balance > 0.01) {
        balanceLabel.classList.add('text-danger');
        balanceLabel.classList.remove('text-success');
    } else {
        balanceLabel.classList.remove('text-danger');
        balanceLabel.classList.add('text-success');
    }
};

window.performBatchUpdate = async () => {
    if(!batchTarget.clientIds.length || !targetUserId) return;
    
    const timestamp = Date.now();
    const paidAmountStr = document.getElementById('modalPaidInput').value;
    const balanceStr = document.getElementById('modalBalance').innerText.replace('₹', '');

    try {
        // Firestore: Batch Update targeting specific user's clients
        const batch = writeBatch(db);

        batchTarget.clientIds.forEach(id => {
            const docRef = doc(db, 'users', targetUserId, 'clients', id);
            const updateData = { paymentStatus: batchTarget.status };
            
            if(batchTarget.status === 'paid') {
                updateData.paymentMeta = {
                    lastPaidDate: timestamp,
                    batchPaidAmount: paidAmountStr, 
                    batchBalanceDue: balanceStr
                };
            } else {
                updateData.paymentMeta = null;
            }
            
            batch.update(docRef, updateData);
        });

        await batch.commit();

        showToast(`Updated ${batchTarget.clientIds.length} clients to ${batchTarget.status.toUpperCase()}`, 'success');
        batchConfirmModal.hide();
    } catch(err) {
        showToast("Batch update failed: " + err.message, 'error');
        batchConfirmModal.hide();
    }
};
